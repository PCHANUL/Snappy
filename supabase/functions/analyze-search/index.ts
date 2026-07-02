import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { analyzeContentItem } from "../_analysis/content-analyzer.ts";
import {
  type AnalysisBatchPayload,
  enqueueAnalysisBatch,
  enqueueAnalysisJob,
} from "../_analysis/analysis-queue.ts";
import {
  claimAnalysisRows,
  completeAnalysisRows,
  getAnalysisJob,
  shouldContinueAnalysisJob,
} from "../_analysis/analysis-job.ts";
import { decryptNotionKey } from "../_core/crypto.ts";
import { getSupabase } from "../_core/db.ts";
import { env } from "../_core/env.ts";
import {
  AuthError,
  corsHeaders,
  errorToResponse,
  ValidationError,
} from "../_core/errors.ts";
import { logger } from "../_core/logger.ts";
import { NotionClient } from "../_notion/client.ts";
import type { CreatedRow } from "../_notion/client.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const ANALYSIS_BATCH_SIZE = 3;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    assertInternalRequest(req);
    const payload = validatePayload(await req.json());
    if ("jobId" in payload) {
      EdgeRuntime.waitUntil(processAnalysisJob(payload.jobId));
    } else {
      EdgeRuntime.waitUntil(processAnalysisBatch(payload));
    }

    return jsonResponse({
      status: "accepted",
      ...("jobId" in payload
        ? { jobId: payload.jobId }
        : {
          batchSize: Math.min(payload.rows.length, ANALYSIS_BATCH_SIZE),
          remaining: Math.max(
            payload.rows.length - ANALYSIS_BATCH_SIZE,
            0,
          ),
        }),
    }, 202);
  } catch (error) {
    logger.error("Analyze search request failed", error);
    return errorToResponse(error);
  }
});

async function processAnalysisJob(jobId: string): Promise<void> {
  try {
    const job = await getAnalysisJob(jobId);
    if (!job || job.status === "completed" || job.status === "cancelled") {
      return;
    }

    const claimed = await claimAnalysisRows(jobId, ANALYSIS_BATCH_SIZE);
    if (claimed.length === 0) {
      await shouldContinueAnalysisJob(jobId);
      return;
    }

    const notion = await createNotionClient(job.userId);
    const analysisProps = new Map(job.analysisProps);
    const results = await Promise.all(
      claimed.map(({ row }) =>
        analyzeRow(notion, row, job.keyword, analysisProps)
      ),
    );
    const progress = await completeAnalysisRows(
      jobId,
      claimed.map(({ itemId }) => itemId),
      results.filter((success) => !success).length,
    );
    const finished = progress.completed >= progress.total;

    if (progress.statusBlockId) {
      await notion.updateAnalysisStatusCallout(
        progress.statusBlockId,
        progress.completed,
        progress.total,
        finished,
      ).catch(() => {/* 진행률 표시는 분석 흐름을 막지 않는다. */});
    }

    const shouldContinue = await shouldContinueAnalysisJob(jobId);
    if (shouldContinue) await enqueueAnalysisJob(jobId);

    logger.info("Content analysis job batch completed", {
      jobId,
      completed: progress.completed,
      total: progress.total,
      failed: progress.failed,
      continued: shouldContinue,
    });
  } catch (error) {
    logger.error("Content analysis job failed", error, { jobId });
  }
}

async function processAnalysisBatch(
  payload: AnalysisBatchPayload,
): Promise<void> {
  const batch = payload.rows.slice(0, ANALYSIS_BATCH_SIZE);
  const remaining = payload.rows.slice(ANALYSIS_BATCH_SIZE);

  try {
    const notion = await createNotionClient(payload.userId);
    const analysisProps = new Map(payload.analysisProps);

    await Promise.allSettled(
      batch.map((row) =>
        analyzeRow(notion, row, payload.keyword, analysisProps)
      ),
    );

    const done = Math.min(payload.done + batch.length, payload.total);
    if (payload.statusBlockId) {
      await notion.updateAnalysisStatusCallout(
        payload.statusBlockId,
        done,
        payload.total,
        remaining.length === 0,
      ).catch(() => {/* 진행률 표시는 분석 흐름을 막지 않는다. */});
    }

    if (remaining.length > 0) {
      await enqueueAnalysisBatch({
        ...payload,
        rows: remaining,
        done,
      });
      return;
    }

    logger.info("Content analysis queue completed", {
      userId: payload.userId,
      total: payload.total,
    });
  } catch (error) {
    logger.error("Content analysis batch failed", error, {
      userId: payload.userId,
      done: payload.done,
      batchSize: batch.length,
      remaining: remaining.length,
    });
  }
}

async function analyzeRow(
  notion: NotionClient,
  row: CreatedRow,
  keyword: string,
  analysisProps: Map<string, string>,
): Promise<boolean> {
  try {
    const result = await analyzeContentItem({
      url: row.url,
      platform: row.platform,
      title: row.title,
      description: row.description,
      snippet: row.snippet,
      keyword,
    });
    await notion.updateRowAnalysis(row.rowId, result, analysisProps);
    await notion.appendRowAnalysisContent(row.rowId, result)
      .catch((error) => {
        logger.warn("Failed to append row analysis content (non-fatal)", {
          url: row.url,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return result.status === "done";
  } catch (error) {
    logger.warn("Row analysis failed", {
      url: row.url,
      error: error instanceof Error ? error.message : String(error),
    });
    await notion.updateRowAnalysis(row.rowId, {
      keywords: [],
      status: "failed",
    }, analysisProps).catch(() => {/* 실패 상태 기록 오류는 무시한다. */});
    return false;
  }
}

async function createNotionClient(userId: string): Promise<NotionClient> {
  const { data: user, error } = await getSupabase()
    .from("users")
    .select("notion_api_key_encrypted")
    .eq("id", userId)
    .single();

  if (error || !user?.notion_api_key_encrypted) {
    throw new AuthError("Notion not connected");
  }

  return new NotionClient(
    await decryptNotionKey(user.notion_api_key_encrypted),
  );
}

function assertInternalRequest(req: Request): void {
  const authorization = req.headers.get("Authorization");
  const queueSecret = req.headers.get("X-Analysis-Queue-Secret");
  if (
    authorization !== `Bearer ${env.supabase.serviceRoleKey}` &&
    queueSecret !== env.analysis.queueSecret
  ) {
    throw new AuthError("Internal analysis request required");
  }
}

function validatePayload(
  value: unknown,
): AnalysisBatchPayload | { jobId: string } {
  if (!value || typeof value !== "object") {
    throw new ValidationError("Invalid analysis payload");
  }

  const payload = value as Partial<AnalysisBatchPayload>;
  if (
    "jobId" in payload &&
    typeof (payload as { jobId?: unknown }).jobId === "string"
  ) {
    return { jobId: (payload as { jobId: string }).jobId };
  }
  if (!payload.userId || typeof payload.userId !== "string") {
    throw new ValidationError("userId required");
  }
  if (typeof payload.keyword !== "string") {
    throw new ValidationError("keyword required");
  }
  if (!Array.isArray(payload.rows) || payload.rows.length === 0) {
    throw new ValidationError("rows required");
  }
  if (!Array.isArray(payload.analysisProps)) {
    throw new ValidationError("analysisProps required");
  }
  if (
    typeof payload.done !== "number" ||
    typeof payload.total !== "number"
  ) {
    throw new ValidationError("analysis progress required");
  }

  return payload as AnalysisBatchPayload;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

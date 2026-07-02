import { env } from "../_core/env.ts";
import type { CreatedRow } from "../_notion/client.ts";

const ANALYSIS_FUNCTION_URL = `${env.supabase.url}/functions/v1/analyze-search`;
const QUEUE_REQUEST_TIMEOUT_MS = 10_000;
const QUEUE_RETRIES = 2;

export interface AnalysisBatchPayload {
  userId: string;
  keyword: string;
  rows: CreatedRow[];
  analysisProps: Array<[string, string]>;
  statusBlockId: string | null;
  done: number;
  total: number;
}

export async function enqueueAnalysisJob(jobId: string): Promise<void> {
  await postAnalysisRequest({ jobId });
}

export async function enqueueAnalysisBatch(
  payload: AnalysisBatchPayload,
  retries = QUEUE_RETRIES,
): Promise<void> {
  await postAnalysisRequest(payload, retries);
}

async function postAnalysisRequest(
  payload: AnalysisBatchPayload | { jobId: string },
  retries = QUEUE_RETRIES,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(ANALYSIS_FUNCTION_URL, {
      method: "POST",
      signal: AbortSignal.timeout(QUEUE_REQUEST_TIMEOUT_MS),
      headers: {
        "Authorization": `Bearer ${env.supabase.serviceRoleKey}`,
        "apikey": env.supabase.serviceRoleKey,
        "X-Analysis-Queue-Secret": env.analysis.queueSecret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (retries > 0) {
      await sleep(500);
      return await postAnalysisRequest(payload, retries - 1);
    }
    throw error;
  }

  if (!response.ok) {
    if (retries > 0 && (response.status === 429 || response.status >= 500)) {
      await sleep(response.status === 429 ? 1_500 : 800);
      return await postAnalysisRequest(payload, retries - 1);
    }
    const body = await response.text();
    throw new Error(
      `Analysis queue request failed: ${response.status} ${body.slice(0, 200)}`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

import { getSupabase } from "../_core/db.ts";
import type { CreatedRow } from "../_notion/client.ts";

export interface AnalysisJob {
  id: string;
  userId: string;
  keyword: string;
  analysisProps: Array<[string, string]>;
  statusBlockId: string | null;
  total: number;
  status: "pending" | "running" | "completed" | "cancelled";
}

export interface ClaimedAnalysisRow {
  itemId: number;
  row: CreatedRow;
}

export interface AnalysisJobProgress {
  completed: number;
  total: number;
  failed: number;
  statusBlockId: string | null;
}

export async function createAnalysisJob(input: {
  userId: string;
  keyword: string;
  analysisProps: Array<[string, string]>;
  statusBlockId: string | null;
  total: number;
}): Promise<string> {
  const { data, error } = await getSupabase()
    .from("content_analysis_jobs")
    .insert({
      user_id: input.userId,
      keyword: input.keyword,
      analysis_props: input.analysisProps,
      status_block_id: input.statusBlockId,
      total: input.total,
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new Error(`Failed to create analysis job: ${error?.message}`);
  }
  return data.id as string;
}

export async function enqueueAnalysisRows(
  jobId: string,
  rows: CreatedRow[],
  startPosition: number,
): Promise<boolean> {
  if (rows.length === 0) return false;
  const { data, error } = await getSupabase().rpc(
    "enqueue_content_analysis_rows",
    {
      p_job_id: jobId,
      p_rows: rows,
      p_start_position: startPosition,
    },
  );
  if (error) {
    throw new Error(`Failed to enqueue analysis rows: ${error.message}`);
  }
  return data === true;
}

export async function getAnalysisJob(
  jobId: string,
): Promise<AnalysisJob | null> {
  const { data, error } = await getSupabase()
    .from("content_analysis_jobs")
    .select(
      "id, user_id, keyword, analysis_props, status_block_id, total, status",
    )
    .eq("id", jobId)
    .maybeSingle();

  if (error) throw new Error(`Failed to read analysis job: ${error.message}`);
  if (!data) return null;

  return {
    id: data.id,
    userId: data.user_id,
    keyword: data.keyword,
    analysisProps: Array.isArray(data.analysis_props)
      ? data.analysis_props as Array<[string, string]>
      : [],
    statusBlockId: data.status_block_id,
    total: data.total,
    status: data.status,
  };
}

export async function claimAnalysisRows(
  jobId: string,
  limit = 3,
): Promise<ClaimedAnalysisRow[]> {
  const { data, error } = await getSupabase().rpc(
    "claim_content_analysis_rows",
    { p_job_id: jobId, p_limit: limit },
  );
  if (error) {
    throw new Error(`Failed to claim analysis rows: ${error.message}`);
  }
  return ((data ?? []) as Array<{ id: number; row_data: CreatedRow }>).map(
    (item) => ({ itemId: item.id, row: item.row_data }),
  );
}

export async function completeAnalysisRows(
  jobId: string,
  itemIds: number[],
  failed: number,
): Promise<AnalysisJobProgress> {
  const { data, error } = await getSupabase().rpc(
    "complete_content_analysis_rows",
    {
      p_job_id: jobId,
      p_item_ids: itemIds,
      p_failed: failed,
    },
  );
  const row = data?.[0];
  if (error || !row) {
    throw new Error(`Failed to complete analysis rows: ${error?.message}`);
  }
  return {
    completed: row.completed,
    total: row.total,
    failed: row.failed,
    statusBlockId: row.status_block_id,
  };
}

export async function shouldContinueAnalysisJob(
  jobId: string,
): Promise<boolean> {
  const { data, error } = await getSupabase().rpc(
    "continue_content_analysis_job",
    { p_job_id: jobId },
  );
  if (error) {
    throw new Error(`Failed to continue analysis job: ${error.message}`);
  }
  return data === true;
}

export async function cancelAnalysisJob(jobId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("content_analysis_jobs")
    .update({
      status: "cancelled",
      worker_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .in("status", ["pending", "running"]);
  if (error) throw new Error(`Failed to cancel analysis job: ${error.message}`);
}

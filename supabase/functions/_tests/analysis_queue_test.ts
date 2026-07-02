import "./setup.ts";
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  enqueueAnalysisBatch,
  enqueueAnalysisJob,
} from "../_analysis/analysis-queue.ts";

Deno.test("enqueueAnalysisBatch: 내부 분석 함수에 진행 상태와 행 전달", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  globalThis.fetch = (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    capturedUrl = String(input);
    capturedInit = init;
    return Promise.resolve(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );
  };

  try {
    await enqueueAnalysisBatch({
      userId: "user-1",
      keyword: "고양이",
      rows: [{
        rowId: "row-1",
        url: "https://example.com/1",
        platform: "tistory",
        title: "고양이 글",
      }],
      analysisProps: [["분석 상태", "select"]],
      statusBlockId: "block-1",
      done: 3,
      total: 10,
    });

    const headers = new Headers(capturedInit?.headers);
    const body = JSON.parse(String(capturedInit?.body));
    assertEquals(
      capturedUrl,
      "https://test.supabase.co/functions/v1/analyze-search",
    );
    assertEquals(headers.get("authorization"), "Bearer test-service-role-key");
    assertEquals(headers.get("apikey"), "test-service-role-key");
    assertEquals(
      headers.get("x-analysis-queue-secret"),
      "test-service-role-key",
    );
    assertEquals(body.done, 3);
    assertEquals(body.total, 10);
    assertEquals(body.rows[0].rowId, "row-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("enqueueAnalysisJob: FIFO 작업 ID를 분석 함수에 전달", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> = {};

  globalThis.fetch = (
    _input: string | URL | Request,
    init?: RequestInit,
  ) => {
    capturedBody = JSON.parse(String(init?.body));
    return Promise.resolve(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );
  };

  try {
    await enqueueAnalysisJob("11111111-1111-1111-1111-111111111111");
    assertEquals(capturedBody, {
      jobId: "11111111-1111-1111-1111-111111111111",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

import "./setup.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { parseContentAnalysisJson } from "../_analysis/anthropic.ts";

Deno.test("parseContentAnalysisJson: 요약과 키워드 JSON을 파싱하고 정리", () => {
  const result = parseContentAnalysisJson(`{
    "summary": "  비건 디저트 트렌드를 소개합니다.   카페 방문 의도가 뚜렷합니다. ",
    "keywords": ["비건 디저트", "카페,투어", "", "비건 디저트", "릴스"],
    "confidence": "82%"
  }`);

  assertEquals(
    result.summary,
    "비건 디저트 트렌드를 소개합니다. 카페 방문 의도가 뚜렷합니다.",
  );
  assertEquals(result.keywords, ["비건 디저트", "카페 투어", "릴스"]);
  assertEquals(result.confidence, 0.82);
});

Deno.test("parseContentAnalysisJson: 코드블록과 앞뒤 설명이 있어도 JSON만 추출", () => {
  const result = parseContentAnalysisJson(`
분석 결과입니다.
\`\`\`json
{"summary":"짧은 요약","keywords":["키워드1","키워드2"],"confidence":1.2}
\`\`\`
`);

  assertEquals(result.summary, "짧은 요약");
  assertEquals(result.keywords, ["키워드1", "키워드2"]);
  assertEquals(result.confidence, 1);
});

Deno.test("analyzeContentWithLLM: raw text 분석 프롬프트와 JSON 응답 처리", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedBody: Record<string, any> = {};
  let capturedHeaders: Record<string, string> = {};

  globalThis.fetch = async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    capturedUrl = url.toString();
    capturedBody = JSON.parse(String(init?.body ?? "{}"));
    capturedHeaders = Object.fromEntries(
      new Headers(init?.headers as HeadersInit).entries(),
    );
    return new Response(
      JSON.stringify({
        content: [{
          type: "text",
          text: JSON.stringify({
            summary: "비건 디저트 콘텐츠의 핵심을 요약했습니다.",
            keywords: ["비건 디저트", "카페 투어", "숏폼"],
            confidence: 0.74,
          }),
        }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const { analyzeContentWithLLM } = await import("../_analysis/anthropic.ts");
    const result = await analyzeContentWithLLM(
      "test-anthropic-key",
      "raw navigation text\n비건 디저트 카페를 소개하는 영상입니다.",
      "비건",
    );

    assertEquals(capturedUrl, "https://api.anthropic.com/v1/messages");
    assertEquals(capturedHeaders["x-api-key"], "test-anthropic-key");
    assertEquals(capturedBody.max_tokens, 500);
    const prompt = capturedBody.messages?.[0]?.content ?? "";
    assert(
      String(prompt).includes("raw text"),
      `raw text 분석 프롬프트 필요: ${prompt}`,
    );
    assert(
      String(prompt).includes('"비건"'),
      `검색 키워드 포함 필요: ${prompt}`,
    );
    assert(
      String(prompt).includes("confidence"),
      `신뢰도 출력 지시 필요: ${prompt}`,
    );
    assertEquals(result.summary, "비건 디저트 콘텐츠의 핵심을 요약했습니다.");
    assertEquals(result.keywords, ["비건 디저트", "카페 투어", "숏폼"]);
    assertEquals(result.confidence, 0.74);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

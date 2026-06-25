import "./setup.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

function parseBody(init?: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init?.body ?? "{}"));
}

Deno.test("extractUrlWithTavily: advanced depth와 text format으로 본문 추출", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedBody: Record<string, unknown> = {};
  let capturedHeaders: Record<string, string> = {};

  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    capturedUrl = url.toString();
    capturedBody = parseBody(init);
    capturedHeaders = Object.fromEntries(
      new Headers(init?.headers as HeadersInit).entries(),
    );
    return new Response(
      JSON.stringify({
        results: [{
          url: "https://example.com/post",
          raw_content: "첫 번째 줄\n\n\n두 번째 줄",
        }],
        usage: { credits: 2 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const { extractUrlWithTavily } = await import(
      "../_crawl/tavily-extract.ts"
    );
    const result = await extractUrlWithTavily("https://example.com/post");

    assertEquals(capturedUrl, "https://api.tavily.com/extract");
    assertEquals(capturedBody.urls, ["https://example.com/post"]);
    assertEquals(capturedBody.extract_depth, "advanced");
    assertEquals(capturedBody.format, "text");
    assertEquals(capturedBody.include_images, false);
    assertEquals(capturedBody.include_usage, true);
    assertEquals(capturedHeaders.authorization, "Bearer test-tavily-key");
    assertEquals(result.status, "done");
    assertEquals(result.full_text, "첫 번째 줄\n\n두 번째 줄");
    assertEquals(result.word_count, 6);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("extractUrlWithTavily: raw_content가 없으면 content 필드 사용", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        results: [{ url: "https://example.com/post", content: "콘텐츠 필드 텍스트입니다" }],
      }),
      { status: 200 },
    );

  try {
    const { extractUrlWithTavily } = await import(
      "../_crawl/tavily-extract.ts"
    );
    const result = await extractUrlWithTavily("https://example.com/post");

    assertEquals(result.status, "done");
    assertEquals(result.full_text, "콘텐츠 필드 텍스트입니다");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("extractUrlWithTavily: 추출 텍스트가 너무 짧으면 failed", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        results: [{ url: "https://example.com/post", raw_content: "짧음" }],
      }),
      { status: 200 },
    );

  try {
    const { extractUrlWithTavily } = await import(
      "../_crawl/tavily-extract.ts"
    );
    const result = await extractUrlWithTavily("https://example.com/post");

    assertEquals(result.status, "failed");
    assertEquals(result.full_text, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("extractUrlWithTavily: API 오류 시 Tavily Extract 에러", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response('{"error":"unauthorized"}', { status: 401 });

  try {
    const { extractUrlWithTavily } = await import(
      "../_crawl/tavily-extract.ts"
    );

    let threw = false;
    try {
      await extractUrlWithTavily("https://example.com/post");
    } catch (error) {
      threw = true;
      assert(
        (error as Error).message.includes("Tavily Extract"),
        `에러 메시지에 Tavily Extract 포함 필요: ${(error as Error).message}`,
      );
    }
    assert(threw, "API 오류 시 예외를 던져야 합니다");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

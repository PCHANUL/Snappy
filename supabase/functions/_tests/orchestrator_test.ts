import "./setup.ts";
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  deduplicateResults,
  searchAllPlatforms,
} from "../_search/orchestrator.ts";
import type { SearchResult } from "../_core/types.ts";

function makeResult(platform: string, urls: string[]): SearchResult {
  return {
    platform: platform as any,
    items: urls.map((url) => ({
      platform: platform as any,
      title: `Title ${url}`,
      url,
      description: "desc",
    })),
    count: urls.length,
  };
}

Deno.test("deduplicateResults: 중복 URL 제거", () => {
  const results = [
    makeResult("naver_blog", ["https://a.com", "https://b.com"]),
    makeResult("tistory", ["https://b.com", "https://c.com"]), // b.com 중복
  ];
  const deduped = deduplicateResults(results);
  assertEquals(deduped[0].count, 2); // naver: a, b
  assertEquals(deduped[1].count, 1); // tistory: c만 남음 (b 제거)
  assertEquals(deduped[1].items[0].url, "https://c.com");
});

Deno.test("deduplicateResults: 중복 없으면 변경 없음", () => {
  const results = [
    makeResult("naver_blog", ["https://a.com", "https://b.com"]),
    makeResult("youtube", ["https://c.com", "https://d.com"]),
  ];
  const deduped = deduplicateResults(results);
  assertEquals(deduped[0].count, 2);
  assertEquals(deduped[1].count, 2);
});

Deno.test("deduplicateResults: 빈 결과 처리", () => {
  const results = [
    makeResult("naver_blog", []),
    makeResult("youtube", ["https://a.com"]),
  ];
  const deduped = deduplicateResults(results);
  assertEquals(deduped[0].count, 0);
  assertEquals(deduped[1].count, 1);
});

Deno.test("deduplicateResults: 3개 플랫폼 전체 중복 시나리오", () => {
  const results = [
    makeResult("naver_blog", ["https://a.com"]),
    makeResult("tistory", ["https://a.com"]),
    makeResult("brunch", ["https://a.com"]),
  ];
  const deduped = deduplicateResults(results);
  assertEquals(deduped[0].count, 1); // naver: a
  assertEquals(deduped[1].count, 0); // tistory: 제거
  assertEquals(deduped[2].count, 0); // brunch: 제거
});

// ── searchAllPlatforms ────────────────────────────────────────────────────────

function makeTavilyResult(
  url: string,
  title: string,
  content = "test content",
) {
  return { url, title, content, published_date: "2026-06-01", score: 0.9 };
}

function domainsFromBody(init?: RequestInit): string[] {
  const body = JSON.parse(String(init?.body ?? "{}"));
  return Array.isArray(body.include_domains) ? body.include_domains : [];
}

function queryFromBody(init?: RequestInit): string {
  const body = JSON.parse(String(init?.body ?? "{}"));
  return String(body.query ?? "");
}

Deno.test("searchAllPlatforms: Tavily 요청에 선택한 기간 필터 전달", async () => {
  const originalFetch = globalThis.fetch;
  const capturedTimeRanges: unknown[] = [];
  globalThis.fetch = async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    capturedTimeRanges.push(body.time_range);
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  };

  try {
    await searchAllPlatforms(
      "test",
      ["naver_blog", "youtube", "tistory", "brunch"],
      5,
      "week",
    );

    assertEquals(capturedTimeRanges.length, 8);
    assert(
      capturedTimeRanges.every((timeRange) => timeRange === "week"),
      "모든 Tavily 요청에 선택한 기간 필터가 전달되어야 함",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("searchAllPlatforms: 모든 플랫폼 성공", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    const domains = domainsFromBody(init);
    let results: unknown[] = [];
    if (domains.includes("blog.naver.com")) {
      results = [makeTavilyResult("https://blog.naver.com/user/1", "Naver 글")];
    } else if (domains.includes("youtube.com")) {
      results = [
        makeTavilyResult("https://www.youtube.com/watch?v=vid1", "YT 영상"),
      ];
    } else if (domains.includes("tistory.com")) {
      results = [makeTavilyResult("https://post.tistory.com/1", "Tistory 글")];
    } else if (domains.includes("brunch.co.kr")) {
      results = [makeTavilyResult("https://brunch.co.kr/@u/1", "Brunch 글")];
    }
    return new Response(JSON.stringify({ results, usage: { credits: 1 } }), {
      status: 200,
    });
  };
  try {
    const result = await searchAllPlatforms(
      "test",
      ["naver_blog", "youtube", "tistory", "brunch"],
      10,
      "month",
    );
    assertEquals(result.results.length, 4);
    assertEquals(
      result.results.find((r) => r.platform === "naver_blog")?.count,
      1,
    );
    assertEquals(
      result.results.find((r) => r.platform === "youtube")?.count,
      1,
    );
    assertEquals(
      result.results.find((r) => r.platform === "tistory")?.count,
      1,
    );
    assertEquals(result.results.find((r) => r.platform === "brunch")?.count, 1);
    assert(result.duration_ms >= 0, "duration_ms가 설정되어야 함");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("searchAllPlatforms: 한 플랫폼 실패 → 나머지 정상 반환", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    const domains = domainsFromBody(init);
    if (domains.includes("blog.naver.com")) {
      return new Response(JSON.stringify({ error: "fail" }), { status: 500 });
    }
    return new Response(
      JSON.stringify({
        results: [
          makeTavilyResult("https://www.youtube.com/watch?v=vid1", "YT 영상"),
        ],
      }),
      { status: 200 },
    );
  };
  try {
    const result = await searchAllPlatforms(
      "test",
      ["naver_blog", "youtube"],
      10,
      "month",
    );
    assertEquals(result.results.length, 2);
    const naver = result.results.find((r) => r.platform === "naver_blog")!;
    const youtube = result.results.find((r) => r.platform === "youtube")!;
    assertEquals(naver.count, 0);
    assert(naver.error !== undefined, "naver error가 설정되어야 함");
    assertEquals(youtube.count, 1);
    assertEquals(youtube.error, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("searchAllPlatforms: 취소 요청 시 진행 중인 Tavily 요청을 abort", async () => {
  const originalFetch = globalThis.fetch;
  let aborted = false;
  let checks = 0;
  const cancelError = new Error("검색이 취소되었습니다.");
  cancelError.name = "SearchCancelledError";

  globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) =>
    await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("Aborted", "AbortError"));
      });
    });

  try {
    await assertRejects(
      () =>
        searchAllPlatforms("test", ["tistory"], 5, "month", {
          throwIfCancelled: async () => {
            checks++;
            if (checks >= 3) throw cancelError;
          },
        }),
      Error,
      "검색이 취소되었습니다.",
    );
    assert(aborted, "취소 시 Tavily fetch AbortSignal이 abort되어야 함");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("searchAllPlatforms: tiktok 검색은 Tavily 검색기로 연결됨", async () => {
  const originalFetch = globalThis.fetch;
  let capturedQuery = "";
  globalThis.fetch = async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    capturedQuery = queryFromBody(init);
    return new Response(
      JSON.stringify({
        results: [
          makeTavilyResult(
            "https://www.tiktok.com/@creator/video/7350000000000000000",
            "dance tiktok video",
            "dance tiktok content",
          ),
        ],
      }),
      { status: 200 },
    );
  };
  try {
    const result = await searchAllPlatforms("dance", ["tiktok"], 5, "month");
    const tiktok = result.results.find((r) => r.platform === "tiktok")!;
    assertEquals(tiktok.count, 1);
    assertEquals(
      tiktok.items[0].url,
      "https://www.tiktok.com/@creator/video/7350000000000000000",
    );
    assert(
      capturedQuery.includes("site:tiktok.com/@"),
      "TikTok Tavily query에 site 힌트 필요",
    );
    assert(
      capturedQuery.includes("/video/"),
      "TikTok Tavily query에 video 힌트 필요",
    );
    assertEquals(result.total_cost_usd, 0.008);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("searchAllPlatforms: instagram_reels 검색은 Tavily 검색기로 연결됨", async () => {
  const originalFetch = globalThis.fetch;
  let capturedQuery = "";
  globalThis.fetch = async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    capturedQuery = queryFromBody(init);
    return new Response(
      JSON.stringify({
        results: [
          makeTavilyResult(
            "https://www.instagram.com/reel/DRIxfcYkh0I/",
            "vegan reels",
            "vegan reels content",
          ),
        ],
      }),
      { status: 200 },
    );
  };
  try {
    const result = await searchAllPlatforms(
      "vegan",
      ["instagram_reels"],
      5,
      "month",
    );
    const reels = result.results.find((r) => r.platform === "instagram_reels")!;
    assertEquals(reels.count, 1);
    assertEquals(
      reels.items[0].url,
      "https://www.instagram.com/reel/DRIxfcYkh0I/",
    );
    assert(
      capturedQuery.includes("site:instagram.com/reel/"),
      "Reels Tavily query에 reel site 힌트 필요",
    );
    assertEquals(result.total_cost_usd, 0.008);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("searchAllPlatforms: 비용 계산 (tistory+brunch = $0.016)", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ results: [] }), { status: 200 });
  try {
    const result = await searchAllPlatforms(
      "test",
      ["tistory", "brunch"],
      5,
      "month",
    );
    assertEquals(result.total_cost_usd, 0.016);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("searchAllPlatforms: naver+youtube 비용 = $0.016", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ results: [] }), { status: 200 });
  try {
    const result = await searchAllPlatforms(
      "test",
      ["naver_blog", "youtube"],
      5,
      "month",
    );
    assertEquals(result.total_cost_usd, 0.016);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

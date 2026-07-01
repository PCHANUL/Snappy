import "./setup.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

function makeResponse(results: unknown[], extra: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({ results, usage: { credits: 1 }, ...extra }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

function parseBody(init?: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init?.body ?? "{}"));
}

Deno.test("searchTavilyPlatform: Tistory는 .tistory.com 하위 블로그 URL만 반환", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> = {};
  let capturedHeaders: Record<string, string> = {};
  globalThis.fetch = async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    capturedBody = parseBody(init);
    capturedHeaders = Object.fromEntries(
      new Headers(init?.headers as HeadersInit).entries(),
    );
    return makeResponse([
      {
        url: "https://myblog.tistory.com/123",
        title: "비건 디저트 레시피",
        content: "맛있는 디저트 만들기",
        published_date: "2026-06-01",
        favicon: "https://tistory.com/favicon.ico",
      },
      {
        url: "https://tistory.com/category",
        title: "티스토리 홈",
        content: "루트 도메인 페이지",
      },
    ]);
  };

  try {
    const { searchTistoryWithTavily } = await import("../_search/tavily.ts");
    const results = await searchTistoryWithTavily("비건 디저트", 5, "month");

    assertEquals(results.length, 1);
    assertEquals(results[0].platform, "tistory");
    assertEquals(results[0].title, "비건 디저트 레시피");
    assertEquals(results[0].url, "https://myblog.tistory.com/123");
    assertEquals(results[0].description, "맛있는 디저트 만들기");
    assertEquals(results[0].snippet, "맛있는 디저트 만들기");
    assertEquals(results[0].published_at, "2026-06-01");
    assertEquals(results[0].thumbnail, "https://tistory.com/favicon.ico");
    assertEquals(capturedBody.include_domains, ["tistory.com"]);
    assert(String(capturedBody.query).includes("site:.tistory.com/"));
    assertEquals(capturedBody.time_range, "month");
    assertEquals(capturedBody.search_depth, "basic");
    assertEquals(capturedBody.max_results, 10);
    assertEquals(
      capturedHeaders.authorization,
      "Bearer test-tavily-key",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("searchTavilyPlatform: TikTok 영상 URL만 www.tiktok.com/@user/video 형식으로 반환", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> = {};
  globalThis.fetch = async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    capturedBody = parseBody(init);
    return makeResponse([
      {
        url: "https://www.tiktok.com/@creator/video/7350000000000000000",
        title: "댄스 챌린지 영상",
        content: "틱톡 댄스 콘텐츠",
      },
      {
        url: "https://www.tiktok.com/@creator",
        title: "댄스 크리에이터 프로필",
        content: "프로필",
      },
      {
        url: "https://tiktok.com/@creator/video/7350000000000000002",
        title: "댄스 영상",
        content: "",
      },
      {
        url: "https://m.tiktok.com/@creator/video/7350000000000000003",
        title: "모바일 댄스 영상",
        content: "",
      },
      {
        url: "https://www.tiktok.com/@creator/photo/7350000000000000001",
        title: "포토",
        content: "",
      },
    ]);
  };

  try {
    const { searchTikTokWithTavily } = await import("../_search/tavily.ts");
    const results = await searchTikTokWithTavily("댄스", 10, "month");
    const urls = new Set(results.map((r) => r.url));

    assertEquals(results.length, 3);
    assert(
      urls.has("https://www.tiktok.com/@creator/video/7350000000000000000"),
    );
    assert(
      urls.has("https://www.tiktok.com/@creator/video/7350000000000000002"),
    );
    assert(
      urls.has("https://www.tiktok.com/@creator/video/7350000000000000003"),
    );
    assert(
      !urls.has("https://www.tiktok.com/@creator/photo/7350000000000000001"),
    );
    assert(results.every((r) => r.platform === "tiktok"));
    assertEquals(results[0].author, "@creator");
    assert(String(capturedBody.query).includes("site:tiktok.com/@"));
    assert(String(capturedBody.query).includes("/video/"));
    assertEquals(capturedBody.time_range, "month");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("searchTavilyPlatform: TikTok fallback 요청에도 기간 필터 유지", async () => {
  const originalFetch = globalThis.fetch;
  const capturedQueries: string[] = [];
  const capturedTimeRanges: unknown[] = [];
  globalThis.fetch = async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    const body = parseBody(init);
    capturedQueries.push(String(body.query ?? ""));
    capturedTimeRanges.push(body.time_range);

    if (capturedQueries.length < 3) {
      return makeResponse([]);
    }
    return makeResponse([
      {
        url: "https://www.tiktok.com/@creator/video/7350000000000000000",
        title: "댄스 영상",
        content: "",
      },
    ]);
  };

  try {
    const { searchTikTokWithTavily } = await import("../_search/tavily.ts");
    const results = await searchTikTokWithTavily("댄스", 10, "month");

    assertEquals(capturedQueries.length, 3);
    assert(capturedQueries[0].includes("site:tiktok.com/@"));
    assertEquals(capturedQueries[1], "댄스");
    assert(capturedQueries[2].includes("site:tiktok.com/@"));
    assertEquals(capturedTimeRanges, ["month", "month", "month"]);
    assertEquals(results.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("searchTavilyPlatform: Instagram Reel URL만 정규화해서 반환", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    makeResponse([
      {
        url: "https://www.instagram.com/reel/DRIxfcYkh0I/",
        title: "비건 디저트 릴스",
        content: "인스타 릴스 콘텐츠",
      },
      {
        url: "https://instagram.com/reel/DRIxfcYkh0J/",
        title: "www 없는 릴스",
        content: "",
      },
      {
        url: "https://m.instagram.com/reels/DRIxfcYkh0K/",
        title: "모바일 릴스",
        content: "",
      },
      {
        url: "https://www.instagram.com/p/DRIxfcYkh0L/",
        title: "일반 게시물",
        content: "",
      },
      {
        url: "https://www.instagram.com/reels/audio/123456789/",
        title: "릴스 오디오",
        content: "",
      },
    ]);

  try {
    const { searchInstagramReelsWithTavily } = await import(
      "../_search/tavily.ts"
    );
    const results = await searchInstagramReelsWithTavily("비건 릴스", 10);
    const urls = new Set(results.map((r) => r.url));

    assertEquals(results.length, 3);
    assert(urls.has("https://www.instagram.com/reel/DRIxfcYkh0I/"));
    assert(urls.has("https://www.instagram.com/reel/DRIxfcYkh0J/"));
    assert(urls.has("https://www.instagram.com/reel/DRIxfcYkh0K/"));
    assert(!urls.has("https://www.instagram.com/p/DRIxfcYkh0L/"));
    assert(!urls.has("https://www.instagram.com/reels/audio/123456789/"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("searchTavilyPlatform: YouTube와 Shorts URL을 구분", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    if (String(url).includes("www.googleapis.com/youtube/v3/videos")) {
      const ids = new URL(String(url)).searchParams.get("id")?.split(",") ?? [];
      return new Response(
        JSON.stringify({
          items: ids.map((id) => ({
            id,
            snippet: {
              channelTitle: id === "short1" ? "숏츠 채널" : "긴 영상 채널",
            },
          })),
        }),
        { status: 200 },
      );
    }

    const body = parseBody(init);
    const query = String(body.query ?? "");
    if (query.includes("/shorts")) {
      return makeResponse([
        {
          url: "https://www.youtube.com/shorts/short1",
          title: "짧은 영상",
          content: "shorts content",
        },
        {
          url: "https://www.youtube.com/watch?v=long1",
          title: "긴 영상",
          content: "",
        },
      ]);
    }
    return makeResponse([
      {
        url: "https://www.youtube.com/watch?v=long1",
        title: "긴 영상",
        content: "youtube content",
      },
      {
        url: "https://www.youtube.com/shorts/short1",
        title: "짧은 영상",
        content: "",
      },
    ]);
  };

  try {
    const { searchYouTubeShortsWithTavily, searchYouTubeWithTavily } =
      await import("../_search/tavily.ts");
    const youtube = await searchYouTubeWithTavily("비건 디저트", 10);
    const shorts = await searchYouTubeShortsWithTavily("비건 디저트", 10);

    assertEquals(youtube.length, 1);
    assertEquals(youtube[0].url, "https://www.youtube.com/watch?v=long1");
    assertEquals(youtube[0].platform, "youtube");
    assertEquals(youtube[0].author, "긴 영상 채널");
    assertEquals(shorts.length, 1);
    assertEquals(shorts[0].url, "https://www.youtube.com/shorts/short1");
    assertEquals(shorts[0].platform, "youtube_shorts");
    assertEquals(shorts[0].author, "숏츠 채널");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("searchTavilyPlatform: API 오류 시 ExternalApiError 발생", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response('{"error":"unauthorized"}', { status: 401 });

  try {
    const { searchTistoryWithTavily } = await import("../_search/tavily.ts");
    let threw = false;
    try {
      await searchTistoryWithTavily("test", 5, "month");
    } catch (error) {
      threw = true;
      assert(
        (error as Error).message.includes("Tavily"),
        `에러 메시지에 Tavily 포함 필요: ${(error as Error).message}`,
      );
    }
    assert(threw, "API 오류 시 예외를 던져야 합니다");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

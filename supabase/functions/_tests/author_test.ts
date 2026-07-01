import "./setup.ts";
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  enrichPlatformAuthors,
  inferPlatformAuthor,
} from "../_search/author.ts";
import type { ContentItem } from "../_core/types.ts";

Deno.test("inferPlatformAuthor: 매체별 URL과 제목에서 작성자 추출", () => {
  assertEquals(
    inferPlatformAuthor("naver_blog", {
      url: "https://blog.naver.com/myblog/223123456789",
    }),
    "myblog",
  );
  assertEquals(
    inferPlatformAuthor("naver_blog", {
      url: "https://blog.naver.com/PostView.naver?blogId=query_author",
    }),
    "query_author",
  );
  assertEquals(
    inferPlatformAuthor("tistory", {
      url: "https://writer.tistory.com/42",
    }),
    "writer",
  );
  assertEquals(
    inferPlatformAuthor("brunch", {
      url: "https://brunch.co.kr/@essayist/10",
    }),
    "@essayist",
  );
  assertEquals(
    inferPlatformAuthor("brunch", {
      url: "https://brunch.co.kr/book/9790000000000",
      title: "고양이와 나 | 이종산 | 브런치",
    }),
    "이종산",
  );
  assertEquals(
    inferPlatformAuthor("tiktok", {
      url: "https://www.tiktok.com/@creator/video/7350000000000000000",
    }),
    "@creator",
  );
  assertEquals(
    inferPlatformAuthor("instagram_reels", {
      url: "https://www.instagram.com/reel/DRIxfcYkh0I/",
      title: "비건 디저트 by @vegan.creator • Instagram",
    }),
    "@vegan.creator",
  );
});

Deno.test("enrichPlatformAuthors: YouTube 영상 ID를 묶어 채널명 조회", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  globalThis.fetch = (input: string | URL | Request) => {
    capturedUrl = String(input);
    return Promise.resolve(
      new Response(
        JSON.stringify({
          items: [
            { id: "long1", snippet: { channelTitle: "긴 영상 채널" } },
            { id: "short1", snippet: { channelTitle: "숏츠 채널" } },
          ],
        }),
        { status: 200 },
      ),
    );
  };

  const items: ContentItem[] = [
    {
      platform: "youtube",
      title: "긴 영상",
      url: "https://www.youtube.com/watch?v=long1",
      description: "",
    },
    {
      platform: "youtube_shorts",
      title: "짧은 영상",
      url: "https://www.youtube.com/shorts/short1",
      description: "",
    },
  ];

  try {
    await enrichPlatformAuthors(items, "youtube");

    const url = new URL(capturedUrl);
    assertEquals(url.hostname, "www.googleapis.com");
    assertEquals(url.searchParams.get("part"), "snippet");
    assertEquals(url.searchParams.get("id"), "long1,short1");
    assertEquals(items[0].author, "긴 영상 채널");
    assertEquals(items[1].author, "숏츠 채널");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("inferPlatformAuthor: 서비스명과 잘못된 URL은 작성자로 사용하지 않음", () => {
  assertEquals(
    inferPlatformAuthor("tistory", { url: "https://tistory.com/category" }),
    undefined,
  );
  assertEquals(
    inferPlatformAuthor("instagram_reels", {
      url: "https://www.instagram.com/reel/DRIxfcYkh0I/",
      title: "Instagram",
    }),
    undefined,
  );
});

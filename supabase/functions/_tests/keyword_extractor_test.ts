import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  extractCandidateKeywords,
  extractHashtagKeywords,
} from "../_analysis/keyword-extractor.ts";
import type { SearchResult } from "../_core/types.ts";

Deno.test("extractHashtagKeywords: 해시태그를 키워드로 정규화하고 URL fragment는 제외", () => {
  const text =
    "오늘 #비건맛집 #Dessert_Time #비건맛집 https://example.com/post#ignored #1 #2026";

  assertEquals(extractHashtagKeywords(text), ["비건맛집", "Dessert_Time"]);
});

Deno.test("extractCandidateKeywords: hashtagPriority 옵션이면 해시태그를 분석 키워드에 우선 포함", () => {
  const results: SearchResult[] = [{
    platform: "instagram_reels",
    count: 1,
    items: [{
      platform: "instagram_reels",
      title: "비건 디저트 릴스",
      url: "https://www.instagram.com/reel/abc/",
      description: "요즘 인기 있는 카페 디저트 #비건맛집 #디저트투어",
      snippet: "#비건 #비건맛집 함께 보기",
    }],
  }];

  const keywords = extractCandidateKeywords(results, "비건", 5, {
    hashtagPriority: true,
    includeSeedHashtags: true,
  });

  assertEquals(keywords.slice(0, 3), ["비건맛집", "디저트투어", "비건"]);
  assert(keywords.length <= 5);
});

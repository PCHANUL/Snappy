// 콘텐츠 분석 공통 로직
// content_items 조회 → (필요 시) 크롤링 → AI 요약 + 키워드
// 검색 백그라운드 루프(trigger-search)와 온디맨드(fetch-content)에서 공유

import { getSupabase } from "../_core/db.ts";
import { crawlUrl } from "../_crawl/crawler.ts";
import { extractUrlWithTavily } from "../_crawl/tavily-extract.ts";
import { analyzeContentWithLLM } from "./anthropic.ts";
import { extractCandidateKeywords } from "./keyword-extractor.ts";
import { env } from "../_core/env.ts";
import { logger } from "../_core/logger.ts";
import type { Platform, SearchResult } from "../_core/types.ts";

export interface AnalysisResult {
  summary?: string;
  summarySource?: string; // 본문 기반 / 설명 기반 / 제목 기반
  keywords: string[];
  confidence?: number; // 0~1, LLM이 실제 콘텐츠를 근거로 분석했다고 본 정도
  wordCount?: number;
  sourceText?: string;

  status: "done" | "failed";
}

export async function analyzeContentItem(opts: {
  url: string;
  platform: string;
  title?: string;
  description?: string;
  snippet?: string;
  keyword: string;
}): Promise<AnalysisResult> {
  const { url, keyword } = opts;

  // 1. 저장된 콘텐츠 조회
  const { data: content } = await getSupabase()
    .from("content_items")
    .select(
      "full_text, crawl_status, platform, title, description, word_count, published_at",
    )
    .eq("url", url)
    .maybeSingle();

  let fullText = content?.full_text ?? "";
  let wordCount = content?.word_count || 0;
  const platform = content?.platform ?? opts.platform;
  const description = content?.description ?? opts.description ?? "";
  const snippet = opts.snippet ?? "";
  const title = content?.title ?? opts.title ?? "";

  // 2. 본문이 없으면 Tavily Extract 우선 시도 + 캐시
  //    실패 시 기존 플랫폼별 크롤러로 fallback한다.
  if (!fullText) {
    try {
      const extracted = await extractUrlWithTavily(url);
      if (extracted.status === "done" && extracted.full_text) {
        fullText = extracted.full_text;
        wordCount = extracted.word_count ?? countWords(extracted.full_text);
        await getSupabase()
          .from("content_items")
          .update({
            full_text: extracted.full_text,
            word_count: wordCount,
            crawl_status: "done",
            crawled_at: new Date().toISOString(),
          })
          .eq("url", url);
      }
    } catch (err) {
      logger.warn("Tavily extract during analysis failed (non-fatal)", {
        url,
        error: String(err),
      });
    }
  }

  // 3. Tavily Extract가 본문을 채우지 못하면 즉석 크롤링 + 캐시
  // ('skip' 상태였던 유튜브도 API 방식으로 재시도)
  if (!fullText) {
    try {
      const result = await crawlUrl(url, platform, {
        youtubeApiKey: env.youtube.apiKey || undefined,
      });
      if (result.status === "done" && result.full_text) {
        fullText = result.full_text;
        wordCount = result.word_count ?? countWords(result.full_text);
        await getSupabase()
          .from("content_items")
          .update({
            full_text: result.full_text,
            word_count: wordCount,
            crawl_status: "done",
            crawled_at: new Date().toISOString(),
          })
          .eq("url", url);
      } else {
        await getSupabase()
          .from("content_items")
          .update({
            crawl_status: result.status,
            crawled_at: new Date().toISOString(),
          })
          .eq("url", url)
          .eq("crawl_status", "pending");
      }
    } catch (err) {
      logger.warn("Crawl during analysis failed (non-fatal)", {
        url,
        error: String(err),
      });
    }
  }

  // 4. 분석용 텍스트 소스 결정 (폴백 체인: 본문 → 설명 → 제목)
  let sourceText: string;
  let summarySource: string;
  const searchText = [description, snippet].filter(Boolean).join("\n").trim();
  if (fullText) {
    sourceText = fullText;
    summarySource = "본문 기반";
  } else if (searchText) {
    sourceText = searchText;
    summarySource = "설명 기반";
  } else {
    sourceText = title;
    summarySource = "제목 기반";
  }

  if (!sourceText) return { keywords: [], status: "failed" };

  // 5. LLM 분석 (비필수): raw text에서 요약 + 키워드를 함께 구조화한다.
  let summary: string | undefined;
  let llmKeywords: string[] = [];
  let confidence: number | undefined;
  if (env.anthropic.apiKey && keyword) {
    try {
      const analysis = await analyzeContentWithLLM(
        env.anthropic.apiKey,
        sourceText,
        keyword,
      );
      summary = analysis.summary;
      llmKeywords = analysis.keywords;
      confidence = analysis.confidence;
    } catch (err) {
      logger.warn("LLM content analysis failed (non-fatal)", {
        url,
        error: String(err),
      });
    }
  }

  // 6. 핵심 키워드 보강 (최대 5개 — multi-select 태그용)
  // LLM 결과를 우선하고, 실패/누락 시 해시태그 우선 규칙 기반 추출로 채운다.
  let localKeywords: string[] = [];
  try {
    const pseudoResults: SearchResult[] = [{
      platform: platform as Platform,
      items: [{
        title,
        url,
        description: sourceText.slice(0, 5000),
        snippet: snippet || undefined,
        platform: platform as Platform,
      }],
      count: 1,
    }];
    localKeywords = extractCandidateKeywords(pseudoResults, keyword ?? "", 5, {
      hashtagPriority: true,
      includeSeedHashtags: true,
    });
  } catch (err) {
    logger.warn("Keyword extraction failed (non-fatal)", {
      url,
      error: String(err),
    });
  }
  const keywords = mergeKeywords(llmKeywords, localKeywords, 5);

  return {
    summary,
    summarySource: summary ? summarySource : undefined,
    keywords,
    confidence,
    wordCount: wordCount || undefined,
    sourceText: sourceText.slice(0, 6000),
    status: "done",
  };
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function mergeKeywords(
  primary: string[],
  fallback: string[],
  max: number,
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const raw of [...primary, ...fallback]) {
    const keyword = raw.replace(/,/g, " ").replace(/\s+/g, " ").trim();
    if (!keyword || seen.has(keyword)) continue;
    seen.add(keyword);
    merged.push(keyword);
    if (merged.length >= max) break;
  }
  return merged;
}

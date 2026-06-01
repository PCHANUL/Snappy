// 콘텐츠 분석 공통 로직
// content_items 조회 → (필요 시) 크롤링 → AI 요약 + 키워드 + SEO + 읽기시간
// 검색 백그라운드 루프(trigger-search)와 온디맨드(fetch-content)에서 공유

import { getSupabase } from './db.ts';
import { crawlUrl } from './crawler.ts';
import { summarizeContent } from './anthropic.ts';
import { extractCandidateKeywords } from './keyword-extractor.ts';
import { env } from './env.ts';
import { logger } from './logger.ts';
import type { SearchResult, Platform } from './types.ts';

export interface AnalysisResult {
  summary?: string;
  summarySource?: string; // 본문 기반 / 설명 기반 / 제목 기반
  keywords: string[];
  seoCount?: number; // 본문 내 검색어 등장 횟수 (본문 크롤 성공 시에만)
  seoScore?: number; // 0~5 밀도 기반 점수
  wordCount?: number;

  status: 'done' | 'failed';
}

export async function analyzeContentItem(opts: {
  url: string;
  platform: string;
  title?: string;
  keyword: string;
}): Promise<AnalysisResult> {
  const { url, keyword } = opts;

  // 1. 저장된 콘텐츠 조회
  const { data: content } = await getSupabase()
    .from('content_items')
    .select('full_text, crawl_status, platform, title, description, word_count, published_at')
    .eq('url', url)
    .maybeSingle();

  let fullText = content?.full_text ?? '';
  const platform = content?.platform ?? opts.platform;
  const description = content?.description ?? '';
  const title = content?.title ?? opts.title ?? '';

  // 2. 본문이 없고 스킵 대상이 아니면 즉석 크롤링 + 캐시
  if (!fullText && content?.crawl_status !== 'skip') {
    try {
      const result = await crawlUrl(url, platform);
      if (result.status === 'done' && result.full_text) {
        fullText = result.full_text;
        await getSupabase()
          .from('content_items')
          .update({
            full_text: result.full_text,
            word_count: result.word_count ?? 0,
            crawl_status: 'done',
            crawled_at: new Date().toISOString(),
          })
          .eq('url', url);
      } else {
        await getSupabase()
          .from('content_items')
          .update({ crawl_status: result.status, crawled_at: new Date().toISOString() })
          .eq('url', url)
          .eq('crawl_status', 'pending');
      }
    } catch (err) {
      logger.warn('Crawl during analysis failed (non-fatal)', { url, error: String(err) });
    }
  }

  // 3. 분석용 텍스트 소스 결정 (폴백 체인: 본문 → 설명 → 제목)
  let sourceText: string;
  let summarySource: string;
  if (fullText) {
    sourceText = fullText;
    summarySource = '본문 기반';
  } else if (description) {
    sourceText = description;
    summarySource = '설명 기반';
  } else {
    sourceText = title;
    summarySource = '제목 기반';
  }

  if (!sourceText) return { keywords: [], status: 'failed' };

  // 4. AI 요약 (비필수)
  let summary: string | undefined;
  if (env.anthropic.apiKey && keyword) {
    try {
      summary = await summarizeContent(env.anthropic.apiKey, sourceText, keyword);
    } catch (err) {
      logger.warn('AI summary failed (non-fatal)', { url, error: String(err) });
    }
  }

  // 5. 핵심 키워드 추출 (최대 5개 — multi-select 태그용)
  let keywords: string[] = [];
  try {
    const pseudoResults: SearchResult[] = [{
      platform: platform as Platform,
      items: [{ title, url, description: sourceText.slice(0, 5000), platform: platform as Platform }],
      count: 1,
    }];
    keywords = extractCandidateKeywords(pseudoResults, keyword ?? '', 5);
  } catch (err) {
    logger.warn('Keyword extraction failed (non-fatal)', { url, error: String(err) });
  }

  // 6. 검색어 적합도 — 본문 크롤 성공 시에만 (스니펫/제목은 밀도 측정 무의미)
  let seoCount: number | undefined;
  let seoScore: number | undefined;
  if (keyword && fullText) {
    seoCount = countOccurrences(fullText, keyword);
    seoScore = seoScoreFromDensity(seoCount, fullText.length, keyword.length);
  }

  const wordCount = content?.word_count || 0;

  return {
    summary,
    summarySource: summary ? summarySource : undefined,
    keywords,
    seoCount,
    seoScore,
    wordCount: wordCount || undefined,
    status: 'done',
  };
}

function countOccurrences(text: string, keyword: string): number {
  const lower = text.toLowerCase();
  const kw = keyword.toLowerCase();
  let count = 0;
  let idx = 0;
  while ((idx = lower.indexOf(kw, idx)) !== -1) {
    count++;
    idx += kw.length;
  }
  return count;
}

// 키워드 밀도(등장 글자수 / 전체 글자수) 기반 점수.
// 너무 낮으면 주제 적합도 부족, 너무 높으면 키워드 스터핑(과최적화)으로 감점.
function seoScoreFromDensity(count: number, textLength: number, keywordLength = 1): number {
  if (count === 0 || textLength === 0) return 0;
  const pct = ((count * Math.max(1, keywordLength)) / textLength) * 100;
  if (pct < 0.3) return 1;
  if (pct < 0.8) return 3;
  if (pct <= 2.5) return 5;
  if (pct <= 4) return 4;
  return 2;
}

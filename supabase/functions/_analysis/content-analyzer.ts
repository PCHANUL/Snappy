// 콘텐츠 분석 공통 로직
// content_items 조회 → (필요 시) 크롤링 → AI 요약 + 키워드
// 검색 백그라운드 루프(trigger-search)와 온디맨드(fetch-content)에서 공유

import { getSupabase } from '../_core/db.ts';
import { crawlUrl } from '../_crawl/crawler.ts';
import { summarizeContent } from './anthropic.ts';
import { extractCandidateKeywords } from './keyword-extractor.ts';
import { env } from '../_core/env.ts';
import { logger } from '../_core/logger.ts';
import type { SearchResult, Platform } from '../_core/types.ts';

export interface AnalysisResult {
  summary?: string;
  summarySource?: string; // 본문 기반 / 설명 기반 / 제목 기반
  keywords: string[];
  wordCount?: number;
  sourceText?: string;

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
  let wordCount = content?.word_count || 0;
  const platform = content?.platform ?? opts.platform;
  const description = content?.description ?? '';
  const title = content?.title ?? opts.title ?? '';

  // 2. 본문이 없으면 즉석 크롤링 + 캐시
  // ('skip' 상태였던 유튜브도 API 방식으로 재시도)
  if (!fullText) {
    try {
      const result = await crawlUrl(url, platform, { youtubeApiKey: env.youtube.apiKey });
      if (result.status === 'done' && result.full_text) {
        fullText = result.full_text;
        wordCount = result.word_count ?? countWords(result.full_text);
        await getSupabase()
          .from('content_items')
          .update({
            full_text: result.full_text,
            word_count: wordCount,
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

  return {
    summary,
    summarySource: summary ? summarySource : undefined,
    keywords,
    wordCount: wordCount || undefined,
    sourceText: sourceText.slice(0, 6000),
    status: 'done',
  };
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

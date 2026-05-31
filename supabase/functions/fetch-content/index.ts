// 콘텐츠 분석 Edge Function
// Notion 콘텐츠 행에 임베드된 버튼이 호출 →
// 해당 URL의 본문을 크롤링/조회 후 분석 결과를 Notion 행에 추가한다.
//
// 추가 블록 순서:
//   북마크 → AI 요약 → 핵심 키워드 → 검색어 적합도 → 메타데이터

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getSupabase } from '../_shared/db.ts';
import { decryptNotionKey } from '../_shared/crypto.ts';
import { crawlUrl } from '../_shared/crawler.ts';
import { NotionClient } from '../notion/client.ts';
import type { ContentAnalysis } from '../notion/client.ts';
import { logger } from '../_shared/logger.ts';
import { corsHeaders, errorToResponse, ValidationError, AuthError } from '../_shared/errors.ts';
import { summarizeContent } from '../_shared/anthropic.ts';
import { extractCandidateKeywords } from '../_shared/keyword-extractor.ts';
import { env } from '../_shared/env.ts';
import type { SearchResult, Platform } from '../_shared/types.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const { user_id, url, page_id, keyword } = await req.json();
    if (!user_id || typeof user_id !== 'string') throw new ValidationError('user_id required');
    if (!url || typeof url !== 'string') throw new ValidationError('url required');
    if (!page_id || typeof page_id !== 'string') throw new ValidationError('page_id required');

    // 1. Notion API 키 복호화
    const { data: user } = await getSupabase()
      .from('users')
      .select('notion_api_key_encrypted')
      .eq('id', user_id)
      .single();

    if (!user?.notion_api_key_encrypted) throw new AuthError('Notion not connected');
    const apiKey = await decryptNotionKey(user.notion_api_key_encrypted);

    // 2. content_items에서 저장된 데이터 조회
    const { data: content } = await getSupabase()
      .from('content_items')
      .select('full_text, crawl_status, platform, title, description, word_count, published_at')
      .eq('url', url)
      .maybeSingle();

    let fullText = content?.full_text ?? '';
    const platform = content?.platform ?? guessPlatform(url);
    const description = content?.description ?? '';

    // 3. 본문이 없고 스킵 대상이 아니면 즉석 크롤링
    if (!fullText && content?.crawl_status !== 'skip') {
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
      }
    }

    // 4. 분석용 텍스트 소스 결정 (폴백 체인: 본문 → 설명 → 제목)
    let sourceText: string;
    let summarySource: string;
    if (fullText) {
      sourceText = fullText;
      summarySource = '본문 기반';
    } else if (description) {
      sourceText = description;
      summarySource = '설명 기반';
    } else {
      sourceText = content?.title ?? '';
      summarySource = '제목 기반';
    }

    // 5. AI 요약 (비필수 — 실패해도 나머지 분석은 계속)
    let summary: string | undefined;
    const anthropicKey = env.anthropic.apiKey;
    if (anthropicKey && sourceText && keyword) {
      try {
        summary = await summarizeContent(anthropicKey, sourceText, keyword);
      } catch (err) {
        logger.warn('AI summary failed (non-fatal)', { error: String(err) });
      }
    }

    // 6. 핵심 키워드 추출
    let keywords: string[] = [];
    if (sourceText) {
      try {
        const pseudoResults: SearchResult[] = [{
          platform: platform as Platform,
          items: [{
            title: content?.title ?? '',
            url,
            description: sourceText.slice(0, 5000),
            platform: platform as Platform,
          }],
          count: 1,
        }];
        keywords = extractCandidateKeywords(pseudoResults, keyword ?? '', 8);
      } catch (err) {
        logger.warn('Keyword extraction failed (non-fatal)', { error: String(err) });
      }
    }

    // 7. 검색어 적합도 — 본문 크롤링이 성공한 경우에만 측정.
    // 스니펫/제목은 검색엔진이 키워드 주변을 잘라낸 것이라 밀도 측정이 무의미.
    let seoCount: number | undefined;
    let seoScore: number | undefined;
    if (keyword && fullText) {
      seoCount = countOccurrences(fullText, keyword);
      seoScore = seoScoreFromDensity(seoCount, fullText.length, keyword.length);
    }

    // 8. 읽기 시간 추정 (어절 수 × 3.5자 / 분당 500자)
    const wordCount = content?.word_count || 0;
    const charEstimate = wordCount > 0 ? wordCount * 3.5 : sourceText.length;
    const readMinutes = charEstimate > 0 ? Math.max(1, Math.ceil(charEstimate / 500)) : undefined;

    // 9. Notion 행에 분석 블록 추가
    const notion = new NotionClient(apiKey);
    const analysis: ContentAnalysis = {
      url,
      summary,
      summarySource: summary ? summarySource : undefined,
      keywords: keywords.length ? keywords : undefined,
      seoKeyword: keyword,
      seoCount,
      seoScore,
      wordCount: wordCount || undefined,
      readMinutes,
      platform,
      publishedAt: content?.published_at ?? undefined,
    };
    const added = await notion.appendContentAnalysis(page_id, analysis);

    return jsonResponse({
      success: true,
      already_added: !added,
      message: added ? '분석 결과를 추가했어요.' : '이미 추가되어 있어요.',
    });
  } catch (error) {
    logger.error('fetch-content failed', error);
    return errorToResponse(error);
  }
});

function guessPlatform(url: string): string {
  if (url.includes('blog.naver.')) return 'naver_blog';
  if (url.includes('tistory.')) return 'tistory';
  if (url.includes('brunch.')) return 'brunch';
  if (url.includes('youtube.') || url.includes('youtu.be')) return 'youtube';
  return 'naver_blog';
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
// 너무 낮으면 주제 적합도 부족, 너무 높으면 키워드 스터핑(과최적화)으로 간주해 감점.
function seoScoreFromDensity(count: number, textLength: number, keywordLength = 1): number {
  if (count === 0 || textLength === 0) return 0;
  const density = (count * Math.max(1, keywordLength)) / textLength; // 0~1
  const pct = density * 100;
  if (pct < 0.3) return 1; // 거의 안 다룸
  if (pct < 0.8) return 3; // 적정 하단
  if (pct <= 2.5) return 5; // 적정 (주제 집중)
  if (pct <= 4) return 4; // 다소 과함
  return 2; // 과최적화 의심
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

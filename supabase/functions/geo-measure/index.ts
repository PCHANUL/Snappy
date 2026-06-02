// GEO 측정 Edge Function — 기본 티어 "측정" 진입점 (기획서 6-1)
// 키워드 하나로 SEO 노출과 AI 인용을 한 번에 모아 도메인 기준으로 나란히 보여준다.
//
// POST { user_id, keyword, intent? }
//   1. 사용자 + 쿼터 확인 (기존 검색과 동일한 비용 통제)
//   2. SEO 검색(네이버·유튜브, 무료)과 GEO 질의(Claude web_search)를 병렬 실행
//   3. 루트 도메인 기준 3분류(both / seo_only / geo_only) — 자기 도메인 강조
//   4. JSON 반환 (노션 적재는 후속 단계)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, errorToResponse, ValidationError, AppError } from '../_core/errors.ts';
import { env } from '../_core/env.ts';
import { logger } from '../_core/logger.ts';
import { getUserAndCheckQuota, incrementUsage } from '../_core/db.ts';
import { searchAllPlatforms } from '../_search/orchestrator.ts';
import { queryClaudeGeo } from '../_geo/claude-engine.ts';
import { buildQuestion } from '../_geo/question-template.ts';
import type { QuestionIntent } from '../_geo/question-template.ts';
import { classifyGap } from '../_geo/gap.ts';
import type { SeoHit } from '../_geo/gap.ts';
import type { Platform } from '../_core/types.ts';

// SEO는 무료 매체만 사용 — 측정 비용을 GEO(Claude) 한 번으로 한정
const SEO_PLATFORMS: Platform[] = ['naver_blog', 'youtube'];
const SEO_COUNT = 10;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const userId = typeof body?.user_id === 'string' ? body.user_id.trim() : '';
    const keyword = typeof body?.keyword === 'string' ? body.keyword.trim() : '';
    const intent: QuestionIntent = body?.intent ?? 'recommend';
    const selfDomain = typeof body?.self_domain === 'string' ? body.self_domain.trim() : undefined;

    if (!userId) throw new ValidationError('user_id is required', '사용자 정보가 누락되었습니다.');
    if (!keyword) throw new ValidationError('keyword is required', '키워드를 입력해주세요.');
    if (!env.anthropic.apiKey) {
      throw new AppError('ANTHROPIC_API_KEY not set', 'CONFIG_ERROR', 503, 'AI 측정 기능이 설정되지 않았어요.');
    }

    // 쿼터 확인 (검색과 동일한 일일 한도 적용)
    await getUserAndCheckQuota(userId);

    const question = buildQuestion(keyword, intent);

    // SEO·GEO 병렬 — 한쪽 실패해도 다른 쪽 결과는 보존
    const [seoResult, geoResult] = await Promise.allSettled([
      searchAllPlatforms(keyword, SEO_PLATFORMS, SEO_COUNT, 'month'),
      queryClaudeGeo(env.anthropic.apiKey, question),
    ]);

    // SEO 노출 → 도메인 순위 (매체별 순위를 평탄화, 전체 등장 순서를 rank로)
    const seoHits: SeoHit[] = [];
    if (seoResult.status === 'fulfilled') {
      for (const r of seoResult.value.results) {
        r.items.forEach((item, idx) => seoHits.push({ url: item.url, rank: idx + 1 }));
      }
    } else {
      logger.warn('GEO measure: SEO search failed', { error: String(seoResult.reason) });
    }

    const geo = geoResult.status === 'fulfilled'
      ? geoResult.value
      : null;
    if (geoResult.status === 'rejected') {
      logger.warn('GEO measure: Claude query failed', { error: String(geoResult.reason) });
    }

    const gap = classifyGap(seoHits, geo?.citations ?? [], selfDomain);

    await incrementUsage(userId).catch(() => { /* 사용량 기록 실패는 비치명적 */ });

    return jsonRes({
      keyword,
      question,
      seo: {
        hits: seoHits.length,
        available: seoResult.status === 'fulfilled',
      },
      geo: geo
        ? { engine: geo.engine, model: geo.model, citations: geo.citations, run_at: geo.runAt, available: true }
        : { available: false },
      gap,
      // AI 스냅샷 경고 (기획서 6-1 필수 표시)
      notice: 'AI 인용 결과는 조회 시점 스냅샷이며 호출마다 달라질 수 있어요.',
    });
  } catch (error) {
    logger.error('geo-measure failed', error);
    return errorToResponse(error);
  }
});

function jsonRes(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

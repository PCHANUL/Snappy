// 메인 Edge Function — 노션 웹훅 진입점
// 흐름: 요청 검증(user_id + notion_page_id) → 즉시 202 → 백그라운드에서 페이지 속성 읽기 + 검색

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { searchAllPlatforms } from '../search/orchestrator.ts';
import { NotionClient } from '../notion/client.ts';
import { logger } from '../_shared/logger.ts';
import { corsHeaders, errorToResponse, ValidationError } from '../_shared/errors.ts';
import { validateMinimalRequest, validateSearchRequest } from '../_shared/validator.ts';
import {
  saveSearchResults,
  getNextBatch,
  getUserAndCheckQuota,
  incrementUsage,
  logSearch,
  crawlSearchResults,
} from '../_shared/db.ts';
import type { Platform, User } from '../_shared/types.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<any>): void };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const body = await req.json();

    // user_id + notion_page_id만 즉시 검증 — 나머지는 백그라운드에서 Notion에서 읽음
    const { user_id, notion_page_id } = validateMinimalRequest(body);
    const user = await getUserAndCheckQuota(user_id);

    EdgeRuntime.waitUntil(processSearch(body, user));

    return new Response(
      JSON.stringify({ status: 'accepted', page_id: notion_page_id, message: '검색을 시작합니다.' }),
      { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    logger.error('Request handling failed', error);
    return errorToResponse(error);
  }
});

async function processSearch(rawBody: any, user: User): Promise<void> {
  const notion = new NotionClient(user.notion_api_key);
  const startTime = Date.now();

  // 로그용 fallback 값 (readSearchParams 실패 전에도 기록 가능하도록)
  let keyword = (rawBody.keyword as string | undefined)?.trim() || '';
  let platforms: Platform[] = Array.isArray(rawBody.platforms) ? rawBody.platforms : [];

  try {
    await notion.updatePageStatus(rawBody.notion_page_id, '검색중');

    // Notion 페이지 속성에서 검색 파라미터 읽기
    // body에 이미 값이 있으면 그것을 우선 사용 (하위 호환)
    const pageParams = await notion.readSearchParams(rawBody.notion_page_id);

    // 페이지 소유권 검증: 부모 DB가 사용자의 notion_database_id와 일치해야 함
    if (pageParams.parentDbId && user.notion_database_id) {
      const userDbId = user.notion_database_id.replace(/-/g, '');
      if (pageParams.parentDbId !== userDbId) {
        throw new Error('Page does not belong to user database — 이 페이지는 연동된 데이터베이스에 속하지 않습니다.');
      }
    }

    keyword = keyword || pageParams.keyword;
    platforms = platforms.length ? platforms : pageParams.platforms;
    const period = rawBody.period || pageParams.period;
    const result_count = rawBody.result_count || pageParams.result_count;

    // 키워드 누락 시 사용자에게 명확한 안내
    if (!keyword) {
      throw new ValidationError('keyword is required', '키워드를 입력해주세요.');
    }
    // 매체 미선택 시 전체 매체 검색
    const resolvedPlatforms = platforms.length
      ? platforms
      : ['naver_blog', 'youtube', 'tistory', 'brunch'] as Platform[];

    const request = validateSearchRequest({
      user_id: user.id,
      notion_page_id: rawBody.notion_page_id,
      keyword,
      platforms: resolvedPlatforms,
      period,
      result_count,
    });

    const orchestratorResult = await searchAllPlatforms(
      request.keyword,
      request.platforms,
      request.result_count,
      request.period,
    );

    const metadata = { duration_ms: Date.now() - startTime, cost_usd: orchestratorResult.total_cost_usd };
    const totalFound = orchestratorResult.results.reduce((s, r) => s + r.count, 0);

    // 전체 결과를 영구 저장 (이력 누적 + 더보기 페이지네이션)
    await saveSearchResults(
      request.notion_page_id,
      request.user_id,
      request.keyword,
      request.platforms,
      request.period,
      orchestratorResult.results,
      metadata,
    );

    // 저장된 항목 본문 크롤링 — Notion 응답과 무관하게 백그라운드에서 실행
    const crawlTargets = orchestratorResult.results.flatMap(r =>
      r.items.map(item => ({ url: item.url, platform: r.platform }))
    );
    EdgeRuntime.waitUntil(crawlSearchResults(crawlTargets));

    // 첫 5개 배치 가져와서 서브페이지로 생성
    const firstBatch = await getNextBatch(request.notion_page_id, request.user_id, 5);
    await notion.updatePageWithSubPages(
      request.notion_page_id,
      request.keyword,
      firstBatch?.items ?? [],
      orchestratorResult.results,
      metadata,
      firstBatch?.hasMore ?? false,
      totalFound,
    );

    await incrementUsage(request.user_id);
    await logSearch({
      user_id: request.user_id,
      keyword: request.keyword,
      platforms: request.platforms,
      period: request.period,
      result_count: totalFound,
      duration_ms: Date.now() - startTime,
      cost_usd: orchestratorResult.total_cost_usd,
      status: 'success',
    });

    logger.info('Search completed', { user_id: user.id, keyword, totalFound, duration_ms: Date.now() - startTime });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Search failed', error, { user_id: user.id, keyword });

    try {
      await notion.updatePageStatus(rawBody.notion_page_id, '실패', errorMessage);
    } catch (notionError) {
      logger.error('Failed to update Notion failure status', notionError);
    }

    await logSearch({
      user_id: user.id,
      keyword: keyword || '(unknown)',
      platforms: platforms.length ? platforms : ['naver_blog'],
      period: rawBody.period || 'month',
      result_count: 0,
      duration_ms: Date.now() - startTime,
      cost_usd: 0,
      status: 'failed',
      error_message: errorMessage,
    });
  }
}

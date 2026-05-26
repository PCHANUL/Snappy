// 메인 Edge Function — 검색 임베드 진입점
// 흐름: user_id 검증 → 즉시 202 → 백그라운드에서 검색 DB에 행 생성 + 검색

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { searchAllPlatforms } from '../search/orchestrator.ts';
import { NotionClient } from '../notion/client.ts';
import { logger } from '../_shared/logger.ts';
import { corsHeaders, errorToResponse, ValidationError } from '../_shared/errors.ts';
import { validateSearchRequest } from '../_shared/validator.ts';
import {
  saveSearchResults,
  getUserAndCheckQuota,
  incrementUsage,
  logSearch,
  crawlSearchResults,
  markSearchingStart,
  markSearchingEnd,
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

    // user_id만 즉시 검증 — 검색 파라미터는 임베드 폼에서 body로 전달됨
    const user_id = typeof body?.user_id === 'string' ? body.user_id.trim() : '';
    if (!user_id) throw new ValidationError('user_id is required', '사용자 정보가 누락되었습니다.');

    const user = await getUserAndCheckQuota(user_id);

    EdgeRuntime.waitUntil(processSearch(body, user));

    return new Response(
      JSON.stringify({ status: 'accepted', message: '검색을 시작합니다.' }),
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

  const keyword = (rawBody.keyword as string | undefined)?.trim() || '';
  const platforms: Platform[] = Array.isArray(rawBody.platforms) ? rawBody.platforms : [];

  await markSearchingStart(user.id);

  let pageId: string | undefined;
  try {
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
      notion_page_id: 'pending', // 검색 DB 행 생성 후 실제 page_id로 대체됨
      keyword,
      platforms: resolvedPlatforms,
      period: rawBody.period,
      result_count: rawBody.result_count,
    });

    // 1. 검색 DB에 새 행 생성 (상태: 검색중) — 결과 서브페이지의 부모가 됨
    pageId = await notion.createSearchEntry(user.notion_database_id, {
      keyword: request.keyword,
      platforms: request.platforms,
      period: request.period,
    });

    // 2. 매체별 검색 실행 — 매체당 5개씩
    const orchestratorResult = await searchAllPlatforms(
      request.keyword,
      request.platforms,
      5,
      request.period,
    );

    const metadata = { duration_ms: Date.now() - startTime, cost_usd: orchestratorResult.total_cost_usd };
    const totalFound = orchestratorResult.results.reduce((s, r) => s + r.count, 0);

    // 3. 검색 이력 저장
    await saveSearchResults(
      pageId,
      request.user_id,
      request.keyword,
      request.platforms,
      request.period,
      orchestratorResult.results,
      metadata,
    );

    // 4. 본문 크롤링 (백그라운드)
    const crawlTargets = orchestratorResult.results.flatMap(r =>
      r.items.map(item => ({ url: item.url, platform: r.platform }))
    );
    EdgeRuntime.waitUntil(crawlSearchResults(crawlTargets));

    // 5. 요약 callout + child DB(매체별 행)로 결과 표시 (상태 → 완료)
    await notion.updatePageWithChildDatabase(
      pageId,
      request.keyword,
      orchestratorResult.results,
      metadata,
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

    logger.info('Search completed', { user_id: user.id, keyword, totalFound, page_id: pageId, duration_ms: Date.now() - startTime });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Search failed', error, { user_id: user.id, keyword });

    // 행이 이미 생성됐다면 실패 상태로 표시
    if (pageId) {
      try {
        await notion.updatePageStatus(pageId, '실패', errorMessage);
      } catch (notionError) {
        logger.error('Failed to update Notion failure status', notionError);
      }
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
  } finally {
    // 검색 완료(성공/실패 무관) → DB 상태 해제 + 임베드 URL 복원
    await markSearchingEnd(user.id);
    try {
      await notion.setSearchEmbedStatus(user.notion_database_id, false);
    } catch { /* non-fatal */ }
  }
}

// 웹 임베드 검색 진입점
// Notion 자동화 없이 search.html 임베드에서 직접 검색을 트리거할 때 사용.
// trigger-search와 달리 notion_page_id가 필요 없고, 백엔드가 DB 행을 직접 생성함.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { searchAllPlatforms } from '../search/orchestrator.ts';
import { NotionClient } from '../notion/client.ts';
import { logger } from '../_shared/logger.ts';
import { corsHeaders, errorToResponse, ValidationError } from '../_shared/errors.ts';
import {
  cacheSearchResults,
  getNextBatch,
  getUserAndCheckQuota,
  incrementUsage,
  logSearch,
} from '../_shared/db.ts';
import type { Platform, Period, User } from '../_shared/types.ts';

const VALID_PLATFORMS: Platform[] = ['naver_blog', 'youtube', 'tistory', 'brunch'];
const VALID_PERIODS: Period[] = ['day', 'week', 'month', 'year'];

declare const EdgeRuntime: { waitUntil(promise: Promise<any>): void };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const body = await req.json();

    const user_id = String(body.user_id || '').trim();
    if (!user_id) throw new ValidationError('user_id is required', '사용자 정보가 누락되었습니다.');

    const keyword = String(body.keyword || '').trim();
    if (!keyword) throw new ValidationError('keyword is required', '키워드를 입력해주세요.');
    if (keyword.length > 100) throw new ValidationError('keyword too long', '키워드는 100자 이내로 입력해주세요.');

    const rawPlatforms: unknown[] = Array.isArray(body.platforms) ? body.platforms : [];
    const platforms: Platform[] = rawPlatforms.length
      ? rawPlatforms.filter((p): p is Platform => VALID_PLATFORMS.includes(p as Platform))
      : [...VALID_PLATFORMS];
    if (platforms.length === 0) throw new ValidationError('no valid platforms', '유효한 매체를 선택해주세요.');

    const period: Period = VALID_PERIODS.includes(body.period) ? body.period as Period : 'month';
    const result_count = [5, 10, 20].includes(Number(body.result_count)) ? Number(body.result_count) : 10;

    const user = await getUserAndCheckQuota(user_id);

    // 사용자의 검색 DB에 새 행 생성 → notion_page_id 확보
    const notion = new NotionClient(user.notion_api_key);
    const notion_page_id = await notion.createSearchPage(user.notion_database_id, {
      keyword, platforms, period, result_count, user_id: user.id,
    });

    EdgeRuntime.waitUntil(processSearch({ notion_page_id, keyword, platforms, period, result_count }, user));

    return new Response(
      JSON.stringify({ status: 'accepted', page_id: notion_page_id, message: '검색을 시작합니다.' }),
      { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    logger.error('web-search request failed', error);
    return errorToResponse(error);
  }
});

async function processSearch(
  params: { notion_page_id: string; keyword: string; platforms: Platform[]; period: Period; result_count: number },
  user: User,
): Promise<void> {
  const { notion_page_id, keyword, platforms, period, result_count } = params;
  const notion = new NotionClient(user.notion_api_key);
  const startTime = Date.now();

  try {
    await notion.updatePageStatus(notion_page_id, '검색중');

    const orchestratorResult = await searchAllPlatforms(keyword, platforms, result_count, period);
    const metadata = { duration_ms: Date.now() - startTime, cost_usd: orchestratorResult.total_cost_usd };
    const totalFound = orchestratorResult.results.reduce((s, r) => s + r.count, 0);

    await cacheSearchResults(notion_page_id, user.id, keyword, orchestratorResult.results, metadata);

    const firstBatch = await getNextBatch(notion_page_id, user.id, 5);
    await notion.updatePageWithSubPages(
      notion_page_id,
      keyword,
      firstBatch?.items ?? [],
      orchestratorResult.results,
      metadata,
      firstBatch?.hasMore ?? false,
      totalFound,
    );

    await incrementUsage(user.id);
    await logSearch({
      user_id: user.id,
      keyword,
      platforms,
      period,
      result_count: totalFound,
      duration_ms: Date.now() - startTime,
      cost_usd: orchestratorResult.total_cost_usd,
      status: 'success',
    });

    logger.info('Web search completed', { user_id: user.id, keyword, totalFound, duration_ms: Date.now() - startTime });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Web search failed', error, { user_id: user.id, keyword });

    try {
      await notion.updatePageStatus(notion_page_id, '실패', errorMessage);
    } catch (notionError) {
      logger.error('Failed to update Notion failure status', notionError);
    }

    await logSearch({
      user_id: user.id,
      keyword,
      platforms,
      period,
      result_count: 0,
      duration_ms: Date.now() - startTime,
      cost_usd: 0,
      status: 'failed',
      error_message: errorMessage,
    });
  }
}

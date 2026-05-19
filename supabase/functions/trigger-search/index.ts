// 메인 Edge Function — 노션 웹훅 진입점
// 흐름: 요청 검증 → 사용자 확인 → 즉시 응답 → 백그라운드 처리
//
// 노션 자동화가 호출하는 URL:
// POST https://[project].supabase.co/functions/v1/trigger-search

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { searchAllPlatforms } from '../search/orchestrator.ts';
import { NotionClient } from '../notion/client.ts';
import { logger } from '../_shared/logger.ts';
import { corsHeaders, errorToResponse } from '../_shared/errors.ts';
import { validateSearchRequest } from '../_shared/validator.ts';
import {
  getUser,
  checkQuota,
  incrementUsage,
  logSearch,
} from '../_shared/db.ts';
import type { SearchRequest, User } from '../_shared/types.ts';

// Deno Edge Runtime의 백그라운드 처리 API
declare const EdgeRuntime: {
  waitUntil(promise: Promise<any>): void;
};

serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    // 1. 요청 파싱 및 검증
    const body = await req.json();
    const request = validateSearchRequest(body);

    // 2. 사용자 인증 + 사용량 체크
    const user = await getUser(request.user_id);
    await checkQuota(user);

    // 3. 즉시 응답 반환 (노션 웹훅 타임아웃 방지)
    //    실제 처리는 백그라운드에서 진행
    EdgeRuntime.waitUntil(processSearch(request, user));

    return new Response(
      JSON.stringify({
        status: 'accepted',
        page_id: request.notion_page_id,
        message: '검색을 시작합니다.',
      }),
      {
        status: 202,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    logger.error('Request handling failed', error);
    return errorToResponse(error);
  }
});

// 백그라운드 검색 처리
async function processSearch(request: SearchRequest, user: User): Promise<void> {
  const notion = new NotionClient(user.notion_api_key);
  const startTime = Date.now();

  try {
    // 노션 페이지 상태: 검색중
    await notion.updatePageStatus(request.notion_page_id, '검색중');

    // 매체별 병렬 검색
    const orchestratorResult = await searchAllPlatforms(
      request.keyword,
      request.platforms,
      request.result_count,
      request.period,
    );

    // 노션에 결과 저장
    await notion.updatePageWithResults(
      request.notion_page_id,
      request.keyword,
      orchestratorResult.results,
      {
        duration_ms: Date.now() - startTime,
        cost_usd: orchestratorResult.total_cost_usd,
      },
    );

    // 사용량 증가
    await incrementUsage(request.user_id);

    // 성공 로그
    const totalFound = orchestratorResult.results.reduce(
      (sum, r) => sum + r.count,
      0,
    );
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

    logger.info('Search completed successfully', {
      user_id: request.user_id,
      keyword: request.keyword,
      totalFound,
      duration_ms: Date.now() - startTime,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Search failed', error, {
      user_id: request.user_id,
      keyword: request.keyword,
    });

    // 노션에 실패 상태 반영 (best effort)
    try {
      await notion.updatePageStatus(
        request.notion_page_id,
        '실패',
        errorMessage,
      );
    } catch (notionError) {
      logger.error('Failed to update Notion failure status', notionError);
    }

    // 실패 로그
    await logSearch({
      user_id: request.user_id,
      keyword: request.keyword,
      platforms: request.platforms,
      period: request.period,
      result_count: 0,
      duration_ms: Date.now() - startTime,
      cost_usd: 0,
      status: 'failed',
      error_message: errorMessage,
    });
  }
}

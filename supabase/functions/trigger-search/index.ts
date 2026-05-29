// 메인 Edge Function — 검색 임베드 진입점
// 흐름: user_id 검증 → 즉시 202 → 백그라운드에서 검색 DB에 행 생성 + 검색

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { searchAllPlatforms } from '../search/orchestrator.ts';
import { NotionClient } from '../notion/client.ts';
import { logger } from '../_shared/logger.ts';
import { AppError, corsHeaders, errorToResponse, ValidationError } from '../_shared/errors.ts';
import { validateSearchRequest } from '../_shared/validator.ts';
import {
  saveSearchResults,
  getUserAndCheckQuota,
  incrementUsage,
  logSearch,
  crawlSearchResults,
  markSearchingStart,
  markSearchingEnd,
  updateSearchProgress,
  setSearchError,
  setRelatedKeywords,
} from '../_shared/db.ts';
import { extractCandidateKeywords } from '../_shared/keyword-extractor.ts';
import { rankCandidatesByTrend } from '../_shared/naver-trends.ts';
import { env } from '../_shared/env.ts';
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

  // 진행 메시지를 DB에 기록 — 폴링 응답에 포함되어 임베드 UI에 표시됨
  const onProgress = (message: string) => updateSearchProgress(user.id, message);

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
    await onProgress('노션에 검색 항목 생성 중...');
    pageId = await notion.createSearchEntry(user.notion_database_id, {
      keyword: request.keyword,
      platforms: request.platforms,
      period: request.period,
    });

    // 2. 매체별 검색 실행 — 매체당 10개씩
    await onProgress(`${request.platforms.length}개 매체 검색 중...`);
    const orchestratorResult = await searchAllPlatforms(
      request.keyword,
      request.platforms,
      10,
      request.period,
    );

    const metadata = { duration_ms: Date.now() - startTime, cost_usd: orchestratorResult.total_cost_usd };
    const totalFound = orchestratorResult.results.reduce((s, r) => s + r.count, 0);

    // 3. 검색 이력 저장
    await onProgress(`${totalFound}개 발견, 저장 중...`);
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

    // 4-b. 연관 인기 키워드 추출 + DataLab 랭킹 (비차단 — 실패해도 검색 완료에 영향 없음)
    let relatedKeywords: Array<{ keyword: string; ratio: number }> = [];
    try {
      await onProgress('연관 키워드 분석 중...');
      const candidates = extractCandidateKeywords(orchestratorResult.results, request.keyword);
      if (candidates.length) {
        relatedKeywords = (await rankCandidatesByTrend(
          env.naver.clientId,
          env.naver.clientSecret,
          candidates,
        )).slice(0, 5);
      }
    } catch (err) {
      logger.warn('Related keyword ranking failed (non-fatal)', { error: String(err) });
    }

    if (relatedKeywords.length) {
      await setRelatedKeywords(user.id, relatedKeywords);
    }

    // 5. 요약 callout + child DB(매체별 행)로 결과 표시 (상태 → 완료)
    await notion.updatePageWithChildDatabase(
      pageId,
      request.keyword,
      orchestratorResult.results,
      metadata,
      totalFound,
      onProgress,
    );

    // 6. 연관 인기 키워드 Notion 블록 추가
    if (relatedKeywords.length) {
      try {
        await notion.appendRelatedKeywords(pageId, relatedKeywords);
      } catch (err) {
        logger.warn('Failed to append related keywords to Notion (non-fatal)', { error: String(err) });
      }
    }

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

    // 사용자에게 표시할 메시지 기록 — 폴링이 검색 종료 후 읽어 표시
    const userMessage = error instanceof AppError
      ? (error.userMessage || '검색에 실패했습니다.')
      : '검색에 실패했습니다. 잠시 후 다시 시도해주세요.';
    await setSearchError(user.id, userMessage);

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

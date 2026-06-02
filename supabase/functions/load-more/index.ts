// 더보기 Edge Function — 캐시에서 다음 5개 결과를 서브페이지로 추가
// DB의 '📄 더보기' 버튼 자동화에서 호출
//
// POST /functions/v1/load-more
// Body: { user_id, notion_page_id }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { NotionClient } from '../_notion/client.ts';
import { logger } from '../_core/logger.ts';
import { corsHeaders, errorToResponse, ValidationError } from '../_core/errors.ts';
import { decryptNotionKey } from '../_core/crypto.ts';
import { getSupabase, getNextBatch } from '../_core/db.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<any>): void };

const BATCH_SIZE = 5;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const notion_page_id = body.notion_page_id?.trim();
    if (!notion_page_id) throw new ValidationError('notion_page_id required');

    // user_id는 버튼 자동화에서 생략 가능 — notion_page_id로 검색 기록에서 조회
    let user_id = body.user_id?.trim();
    if (!user_id) {
      const { data } = await getSupabase()
        .from('search_results')
        .select('user_id')
        .eq('notion_page_id', notion_page_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      user_id = data?.user_id;
    }
    if (!user_id) throw new ValidationError('user_id required', '검색 정보를 찾을 수 없습니다.');

    // 캐시에 해당 항목이 있는지 먼저 확인 (만료 및 소유권 검증 포함)
    const batch = await getNextBatch(notion_page_id, user_id, BATCH_SIZE);
    if (!batch || batch.items.length === 0) {
      return jsonResponse({ message: '더 이상 결과가 없습니다.', hasMore: false });
    }

    // 노션 API 키 조회
    const { data: userData, error: userError } = await getSupabase()
      .from('users')
      .select('notion_api_key_encrypted')
      .eq('id', user_id)
      .single();

    if (userError || !userData?.notion_api_key_encrypted) {
      throw new ValidationError('User not found or Notion not configured');
    }

    const notionApiKey = await decryptNotionKey(userData.notion_api_key_encrypted);
    const notion = new NotionClient(notionApiKey);

    // 백그라운드에서 서브페이지 생성
    EdgeRuntime.waitUntil(
      appendNextBatch(notion, notion_page_id, batch.items, batch.shownCount, batch.metadata.total, batch.hasMore),
    );

    return jsonResponse({
      status: 'accepted',
      added: batch.items.length,
      hasMore: batch.hasMore,
      shown: batch.shownCount,
      total: batch.metadata.total,
    }, 202);
  } catch (error) {
    logger.error('load-more error', error);
    return errorToResponse(error);
  }
});

async function appendNextBatch(
  notion: NotionClient,
  pageId: string,
  items: any[],
  shownCount: number,
  total: number,
  hasMore: boolean,
): Promise<void> {
  try {
    // 기존 "더보기" callout 교체 (있으면 삭제) + 서브페이지 생성 + 새 callout 추가
    await notion.appendLoadMoreCallout(pageId, 0); // 기존 callout 삭제
    await notion.createResultSubPages(pageId, items);

    const remaining = total - shownCount;
    if (hasMore) {
      await notion.appendLoadMoreCallout(pageId, remaining);
    }

    logger.info('load-more completed', { pageId, added: items.length, hasMore, remaining });
  } catch (error) {
    logger.error('load-more background failed', error, { pageId });
  }
}

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// 본문 가져오기 Edge Function
// Notion 콘텐츠 행에 임베드된 버튼이 호출 → 해당 URL의 본문을 크롤링/조회 후
// 그 행(page_id)의 본문 블록으로 추가한다.
//
// 흐름:
//   1. user_id로 Notion API 키 복호화
//   2. content_items에서 url 기준 full_text 조회 (백그라운드 크롤 결과 재사용)
//   3. 없으면 즉석 크롤링
//   4. page_id에 본문 블록 추가 (중복 방지 마커 확인)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getSupabase } from '../_shared/db.ts';
import { decryptNotionKey } from '../_shared/crypto.ts';
import { crawlUrl } from '../_shared/crawler.ts';
import { NotionClient } from '../notion/client.ts';
import { logger } from '../_shared/logger.ts';
import { corsHeaders, errorToResponse, ValidationError, AuthError } from '../_shared/errors.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const { user_id, url, page_id } = await req.json();
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

    // 2. content_items에서 본문 조회
    const { data: content } = await getSupabase()
      .from('content_items')
      .select('full_text, crawl_status, platform, title')
      .eq('url', url)
      .maybeSingle();

    let fullText = content?.full_text ?? '';
    const platform = content?.platform ?? guessPlatform(url);

    // 3. 본문이 없고 스킵 대상이 아니면 즉석 크롤링
    if (!fullText && content?.crawl_status !== 'skip') {
      const result = await crawlUrl(url, platform);
      if (result.status === 'done' && result.full_text) {
        fullText = result.full_text;
        // 캐시 업데이트 (다음 호출 시 재사용)
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

    if (!fullText) {
      return jsonResponse({
        success: false,
        reason: 'no_content',
        message: '본문을 가져올 수 없는 페이지예요.',
      });
    }

    // 4. Notion 행에 본문 추가 (중복 방지)
    const notion = new NotionClient(apiKey);
    const added = await notion.appendArticleBody(page_id, fullText, url);

    return jsonResponse({
      success: true,
      already_added: !added,
      message: added ? '본문을 추가했어요.' : '이미 본문을 추가했어요.',
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

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

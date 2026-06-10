// 콘텐츠 재분석 Edge Function
// 특정 콘텐츠 행(page_id)을 다시 분석해 DB 속성(요약/키워드/상태)을 갱신한다.
//
// POST { user_id, url, page_id, keyword }
//   1. Notion API 키 복호화
//   2. 행의 부모 DB 분석 컬럼 확인
//   3. 공통 분석기로 크롤/요약/키워드 산출
//   4. 행 속성 업데이트

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getSupabase } from '../_core/db.ts';
import { decryptNotionKey } from '../_core/crypto.ts';
import { NotionClient } from '../_notion/client.ts';
import { logger } from '../_core/logger.ts';
import { corsHeaders, errorToResponse, ValidationError, AuthError } from '../_core/errors.ts';
import { analyzeContentItem } from '../_analysis/content-analyzer.ts';

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

    const { data: user } = await getSupabase()
      .from('users')
      .select('notion_api_key_encrypted')
      .eq('id', user_id)
      .single();

    if (!user?.notion_api_key_encrypted) throw new AuthError('Notion not connected');
    const apiKey = await decryptNotionKey(user.notion_api_key_encrypted);

    const notion = new NotionClient(apiKey);

    // 행의 부모 DB에 분석 컬럼이 있는지 확인
    const analysisProps = await notion.getRowAnalysisProps(page_id);
    if (analysisProps.size === 0) {
      return jsonResponse({
        success: false,
        reason: 'no_analysis_columns',
        message: '이 DB에는 분석 컬럼이 없어요.',
      });
    }

    const result = await analyzeContentItem({ url, platform: guessPlatform(url), keyword });
    await notion.updateRowAnalysis(page_id, result, analysisProps);

    return jsonResponse({
      success: true,
      status: result.status,
      message: result.status === 'done' ? '분석을 갱신했어요.' : '분석에 실패했어요.',
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

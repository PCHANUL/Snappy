import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { encryptNotionKey } from '../_shared/crypto.ts';
import { getSupabase } from '../_shared/db.ts';
import { env } from '../_shared/env.ts';
import { corsHeaders, errorToResponse, ValidationError } from '../_shared/errors.ts';
import { logger } from '../_shared/logger.ts';
import { NotionClient } from '../notion/client.ts';

const SETUP_PAGE = (Deno.env.get('SETUP_PAGE_URL') || 'https://pchanul.github.io/Snappy/').replace(/\/+$/, '/');
const NOTION_VERSION = '2022-06-28';
const EXPECTED_TEMPLATE_PAGE_NAME = (Deno.env.get('TEMPLATE_PAGE_NAME') || '트렌드 콘텐츠 발견기').trim();

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = resolveAction(url);

    switch (action) {
      case 'authorize':
        return handleAuthorize(url);
      case 'callback':
        return await handleCallback(url);
      default:
        throw new ValidationError(`Unknown action: ${action}`);
    }
  } catch (error) {
    logger.error('notion-oauth error', error);
    return errorToResponse(error);
  }
});

function resolveAction(url: URL): string | null {
  const queryAction = url.searchParams.get('action');
  if (queryAction) return queryAction;

  if (url.searchParams.has('code') || url.searchParams.has('error')) {
    return 'callback';
  }

  const path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith('/authorize')) return 'authorize';
  if (path.endsWith('/callback')) return 'callback';
  return null;
}

function handleAuthorize(url: URL): Response {
  const userId = url.searchParams.get('user_id');
  if (!userId) throw new ValidationError('user_id required');

  const { clientId, redirectUri } = env.notion;
  if (!clientId || !redirectUri) {
    throw new ValidationError('Notion OAuth not configured', 'OAuth 설정이 완료되지 않았습니다.');
  }

  const authUrl = new URL('https://api.notion.com/v1/oauth/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('owner', 'user');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', userId);

  return new Response(JSON.stringify({ url: authUrl.toString() }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function handleCallback(url: URL): Promise<Response> {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state'); // user_id
  const oauthError = url.searchParams.get('error');

  const redirectBase = `${SETUP_PAGE}?user_id=${encodeURIComponent(state || '')}`;

  if (oauthError || !code || !state) {
    return Response.redirect(`${redirectBase}&error=${oauthError || 'missing_params'}`, 302);
  }

  try {
    const { clientId, clientSecret, redirectUri } = env.notion;
    if (!clientId || !clientSecret || !redirectUri) {
      return Response.redirect(`${redirectBase}&error=server_error`, 302);
    }

    const credentials = btoa(`${clientId}:${clientSecret}`);

    const tokenRes = await fetch('https://api.notion.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Notion-Version': NOTION_VERSION,
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      logger.error('Notion token exchange failed', { status: tokenRes.status, body });
      return Response.redirect(`${redirectBase}&error=oauth_failed`, 302);
    }

    const tokenData = await tokenRes.json();
    const { access_token, workspace_id, workspace_name, duplicated_template_id } = tokenData;
    const encryptedToken = await encryptNotionKey(access_token);

    const update: Record<string, string> = { notion_api_key_encrypted: encryptedToken };
    if (workspace_id) update.notion_workspace_id = workspace_id;
    if (workspace_name) update.notion_workspace_name = workspace_name;

    // 템플릿 복제로 연결된 경우: Notion이 복제된 페이지 ID를 돌려주고 통합도 자동 연결해줌
    // → 사용자가 승인 화면에서 페이지를 직접 선택하지 않아도 검색 DB를 자동 연동
    if (duplicated_template_id) {
      try {
        const dbId = await new NotionClient(access_token).resolveSearchDatabase(duplicated_template_id);
        if (dbId) update.notion_database_id = dbId;
        else logger.info('No database resolved from duplicated template', { user_id: state, duplicated_template_id });
      } catch (err) {
        logger.error('Failed to resolve DB from duplicated template', err, { user_id: state });
      }
    }

    const { error: dbError } = await getSupabase()
      .from('users')
      .update(update)
      .eq('id', state);

    if (dbError) {
      logger.error('Failed to store OAuth token', { error: dbError });
      return Response.redirect(`${redirectBase}&error=store_failed`, 302);
    }

    // 페이지 이름 검증: 복제한 Snappy 템플릿 페이지가 연결됐는지 확인
    // 템플릿 복제 경로(duplicated_template_id)는 Notion이 올바른 페이지를 보장하므로 건너뜀
    if (!duplicated_template_id) {
      try {
        const notion = new NotionClient(access_token);
        // 이름으로 검색해 접근 가능한 결과 중 템플릿 페이지가 있는지 확인
        // search 인덱스 반영 지연 대비 1회 재시도
        let found = await searchTemplatePage(notion);
        if (!found) {
          await new Promise((r) => setTimeout(r, 1500));
          found = await searchTemplatePage(notion);
        }
        if (found === null) {
          // 접근 가능한 페이지 자체가 없음
          logger.info('OAuth connected but no page access', { user_id: state });
          return Response.redirect(`${redirectBase}&error=no_page_access`, 302);
        }
        if (!found) {
          // 페이지는 있지만 템플릿 이름이 아님
          logger.info('OAuth connected but wrong page selected', { user_id: state });
          return Response.redirect(`${redirectBase}&error=wrong_page_name`, 302);
        }
      } catch (err) {
        logger.error('Template page verification failed', err, { user_id: state });
      }
    }

    logger.info('Notion OAuth completed', {
      user_id: state,
      has_duplicated_template: !!duplicated_template_id,
      db_resolved: !!update.notion_database_id,
    });
    return Response.redirect(`${redirectBase}&notion_connected=1`, 302);
  } catch (err) {
    logger.error('OAuth callback error', err);
    return Response.redirect(`${redirectBase}&error=server_error`, 302);
  }
}

// 접근 가능한 결과 중 Snappy 템플릿 페이지가 있는지 검색
// 반환값: true = 템플릿 페이지 있음, false = 다른 페이지가 있지만 템플릿 아님, null = 접근 가능한 페이지 없음
async function searchTemplatePage(notion: NotionClient): Promise<boolean | null> {
  const results = await notion.searchByTitle(EXPECTED_TEMPLATE_PAGE_NAME);
  if (results === null) return null; // 접근 가능한 객체 없음
  return results.some((obj: any) => {
    const title = getObjectTitle(obj).replace(/\s+/g, ' ').trim();
    return title.startsWith(EXPECTED_TEMPLATE_PAGE_NAME);
  });
}

function getObjectTitle(obj: any): string {
  if (obj.object === 'database') {
    return ((obj.title || []) as any[]).map((t: any) => t.plain_text).join('').trim();
  }
  const titleProp = Object.values(obj.properties || {})
    .find((p: any) => (p as any)?.type === 'title') as { title?: any[] } | undefined;
  return (titleProp?.title || []).map((t: any) => t.plain_text).join('').trim();
}

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
        return handleAuthorize();
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

// user_id 없이 시작 — Notion이 owner.user.id로 사용자를 식별해줌
function handleAuthorize(): Response {
  const { clientId, redirectUri } = env.notion;
  if (!clientId || !redirectUri) {
    throw new ValidationError('Notion OAuth not configured', 'OAuth 설정이 완료되지 않았습니다.');
  }

  const authUrl = new URL('https://api.notion.com/v1/oauth/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('owner', 'user');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', crypto.randomUUID()); // CSRF 방지

  return new Response(JSON.stringify({ url: authUrl.toString() }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function handleCallback(url: URL): Promise<Response> {
  const code = url.searchParams.get('code');
  const oauthError = url.searchParams.get('error');

  if (oauthError || !code) {
    return redirect(`error=${oauthError || 'missing_params'}`);
  }

  try {
    const { clientId, clientSecret, redirectUri } = env.notion;
    if (!clientId || !clientSecret || !redirectUri) {
      return redirect('error=server_error');
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
      body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      logger.error('Notion token exchange failed', { status: tokenRes.status, body });
      return redirect('error=oauth_failed');
    }

    const tokenData = await tokenRes.json();
    const { access_token, workspace_id, workspace_name, duplicated_template_id } = tokenData;

    // Notion 계정(사람) 기준 식별 — 워크스페이스가 달라도 동일 ID
    const notionUserId: string | undefined = tokenData.owner?.user?.id;
    const email: string | undefined = tokenData.owner?.user?.person?.email;

    if (!notionUserId) {
      logger.error('Notion OAuth: owner.user.id missing', { tokenData });
      return redirect('error=no_user_id');
    }

    const encryptedToken = await encryptNotionKey(access_token);

    // 핵심 업데이트 필드 (컬럼이 반드시 존재하는 것만 포함)
    const coreUpdate: Record<string, any> = {
      notion_api_key_encrypted: encryptedToken,
      // 새 OAuth 승인 범위가 이전 템플릿과 다를 수 있으므로 오래된 DB 연결은 유지하지 않는다.
      notion_database_id: null,
    };
    if (workspace_id) coreUpdate.notion_workspace_id = workspace_id;
    if (workspace_name) coreUpdate.notion_workspace_name = workspace_name;

    // 템플릿 복제로 연결된 경우: 검색 DB 자동 연동
    if (duplicated_template_id) {
      try {
        const dbId = await new NotionClient(access_token).resolveSearchDatabase(duplicated_template_id);
        if (dbId) coreUpdate.notion_database_id = dbId;
        else logger.info('No database resolved from duplicated template', { notionUserId, duplicated_template_id });
      } catch (err) {
        logger.error('Failed to resolve DB from duplicated template', err, { notionUserId });
      }
    }

    // 사용자 조회: email → notion_user_id 순으로 시도 (마이그레이션 013 미적용 환경 호환)
    let existing: { id: string } | null = null;
    if (email) {
      const { data } = await getSupabase()
        .from('users').select('id').eq('email', email).maybeSingle();
      existing = data;
    }
    if (!existing) {
      const { data } = await getSupabase()
        .from('users').select('id').eq('notion_user_id', notionUserId).maybeSingle();
      existing = data;
    }

    let userId: string;
    if (existing) {
      userId = existing.id;
      const { error } = await getSupabase().from('users').update(coreUpdate).eq('id', userId);
      if (error) {
        logger.error('Failed to update user', { error, userId });
        return redirect('error=store_failed');
      }
    } else {
      if (!email) {
        logger.error('Notion OAuth: email missing, cannot create user', { notionUserId });
        return redirect('error=no_email');
      }
      const { data: newUser, error } = await getSupabase()
        .from('users')
        .insert({ ...coreUpdate, email, subscription_tier: 'free' })
        .select('id')
        .single();
      if (error || !newUser) {
        logger.error('Failed to create user', { error });
        return redirect('error=store_failed');
      }
      userId = newUser.id;
    }

    // notion_user_id는 별도 업데이트 — 마이그레이션 013 미적용 시 무시
    getSupabase()
      .from('users')
      .update({ notion_user_id: notionUserId })
      .eq('id', userId)
      .then(({ error }) => {
        if (error) logger.info('notion_user_id update skipped (migration pending?)', { message: error.message });
      });

    // 템플릿 복제 경로가 아닌 경우: 올바른 페이지가 연결됐는지 이름으로 검증
    if (!duplicated_template_id) {
      try {
        const notion = new NotionClient(access_token);
        let found = await searchTemplatePage(notion);
        if (!found) {
          await new Promise((r) => setTimeout(r, 1500));
          found = await searchTemplatePage(notion);
        }
        if (found === null) {
          return redirect(`user_id=${userId}&error=no_page_access`);
        }
        if (!found) {
          return redirect(`user_id=${userId}&error=wrong_page_name`);
        }
      } catch (err) {
        logger.error('Template page verification failed', err, { userId });
      }
    }

    logger.info('Notion OAuth completed', {
      userId,
      notionUserId,
      has_duplicated_template: !!duplicated_template_id,
      db_resolved: !!coreUpdate.notion_database_id,
    });
    return redirect(`user_id=${userId}&notion_connected=1&db_resolved=${coreUpdate.notion_database_id ? '1' : '0'}`);
  } catch (err) {
    logger.error('OAuth callback error', err);
    return redirect('error=server_error');
  }
}

function redirect(params: string): Response {
  return Response.redirect(`${SETUP_PAGE}?${params}`, 302);
}

async function searchTemplatePage(notion: NotionClient): Promise<boolean | null> {
  const results = await notion.searchByTitle(EXPECTED_TEMPLATE_PAGE_NAME);
  if (results === null) return null;
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

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { encryptNotionKey } from '../_shared/crypto.ts';
import { getSupabase } from '../_shared/db.ts';
import { env } from '../_shared/env.ts';
import { corsHeaders, errorToResponse, ValidationError } from '../_shared/errors.ts';
import { logger } from '../_shared/logger.ts';

const SETUP_PAGE = (Deno.env.get('SETUP_PAGE_URL') || 'https://pchanul.github.io/Snappy/').replace(/\/+$/, '/');
const NOTION_VERSION = '2022-06-28';

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
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('owner', 'user');
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

    const { access_token } = await tokenRes.json();
    const encryptedToken = await encryptNotionKey(access_token);

    const { error: dbError } = await getSupabase()
      .from('users')
      .update({ notion_api_key_encrypted: encryptedToken })
      .eq('id', state);

    if (dbError) {
      logger.error('Failed to store OAuth token', { error: dbError });
      return Response.redirect(`${redirectBase}&error=store_failed`, 302);
    }

    logger.info('Notion OAuth completed', { user_id: state });
    return Response.redirect(`${redirectBase}&notion_connected=1`, 302);
  } catch (err) {
    logger.error('OAuth callback error', err);
    return Response.redirect(`${redirectBase}&error=server_error`, 302);
  }
}

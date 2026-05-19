// 사용자 관리 Edge Function
// 가입, 노션 키 등록, 사용량 조회
//
// 엔드포인트:
//   POST /functions/v1/manage-user?action=signup
//   POST /functions/v1/manage-user?action=setup-notion
//   GET  /functions/v1/manage-user?action=usage&user_id=...
//
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { encryptNotionKey } from '../_shared/crypto.ts';
import { getSupabase } from '../_shared/db.ts';
import { logger } from '../_shared/logger.ts';
import {
  corsHeaders,
  errorToResponse,
  ValidationError,
} from '../_shared/errors.ts';
import { DAILY_QUOTAS } from '../_shared/types.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');

    switch (action) {
      case 'signup':
        return await handleSignup(req);
      case 'setup-notion':
        return await handleSetupNotion(req);
      case 'usage':
        return await handleUsage(req, url);
      case 'list-databases':
        return await handleListDatabases(req);
      default:
        throw new ValidationError(`Unknown action: ${action}`);
    }
  } catch (error) {
    logger.error('manage-user error', error);
    return errorToResponse(error);
  }
});

// === 가입 ===
async function handleSignup(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    throw new ValidationError('POST required');
  }

  const body = await req.json();
  const email = body.email?.trim();

  if (!email || !isValidEmail(email)) {
    throw new ValidationError('Invalid email', '유효한 이메일을 입력해주세요.');
  }

  // 중복 체크
  const { data: existing } = await getSupabase()
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (existing) {
    throw new ValidationError(
      'Email already registered',
      '이미 가입된 이메일입니다.',
    );
  }

  // 가입 (free 플랜으로 시작)
  const { data, error } = await getSupabase()
    .from('users')
    .insert({
      email,
      subscription_tier: 'free',
    })
    .select('id, email, subscription_tier')
    .single();

  if (error || !data) {
    throw new Error(`Signup failed: ${error?.message}`);
  }

  logger.info('User signed up', { user_id: data.id, email });

  return jsonResponse({
    user_id: data.id,
    email: data.email,
    subscription_tier: data.subscription_tier,
    message: '가입이 완료되었습니다. 노션 API 키를 등록해주세요.',
  });
}

// === 노션 키 등록 ===
async function handleSetupNotion(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    throw new ValidationError('POST required');
  }

  const body = await req.json();
  const { user_id, notion_api_key, notion_database_id } = body;

  if (!user_id || typeof user_id !== 'string') {
    throw new ValidationError('user_id required');
  }
  if (!notion_api_key || typeof notion_api_key !== 'string') {
    throw new ValidationError('notion_api_key required', '노션 API 키를 입력해주세요.');
  }
  if (!notion_database_id || typeof notion_database_id !== 'string') {
    throw new ValidationError(
      'notion_database_id required',
      '노션 데이터베이스 ID를 입력해주세요.',
    );
  }

  // 노션 API 키 검증 (실제 API 호출로 확인)
  const isValid = await verifyNotionApiKey(notion_api_key);
  if (!isValid) {
    throw new ValidationError(
      'Invalid Notion API key',
      '노션 API 키가 올바르지 않습니다. 다시 확인해주세요.',
    );
  }

  const encryptedNotionKey = await encryptNotionKey(notion_api_key);

  const { error } = await getSupabase()
    .from('users')
    .update({
      notion_api_key_encrypted: encryptedNotionKey,
      notion_database_id,
    })
    .eq('id', user_id);

  if (error) {
    throw new Error(`Setup failed: ${error.message}`);
  }

  logger.info('Notion setup completed', { user_id });

  return jsonResponse({
    success: true,
    message: '노션 연동이 완료되었습니다.',
  });
}

// === 사용량 조회 ===
async function handleUsage(req: Request, url: URL): Promise<Response> {
  const user_id = url.searchParams.get('user_id');
  if (!user_id) {
    throw new ValidationError('user_id required');
  }

  const today = new Date().toISOString().slice(0, 10);

  // 사용자 정보
  const { data: user } = await getSupabase()
    .from('users')
    .select('subscription_tier, subscription_expires_at')
    .eq('id', user_id)
    .single();

  if (!user) {
    throw new ValidationError('User not found');
  }

  // 오늘 사용량
  const { data: todayUsage } = await getSupabase()
    .from('usage_quotas')
    .select('search_count')
    .eq('user_id', user_id)
    .eq('date', today)
    .maybeSingle();

  const limit = DAILY_QUOTAS[user.subscription_tier as keyof typeof DAILY_QUOTAS]
    || DAILY_QUOTAS.free;
  const used = todayUsage?.search_count || 0;

  return jsonResponse({
    subscription_tier: user.subscription_tier,
    subscription_expires_at: user.subscription_expires_at,
    today: {
      used,
      limit,
      remaining: Math.max(0, limit - used),
    },
  });
}

// === 노션 데이터베이스 목록 조회 ===
async function handleListDatabases(req: Request): Promise<Response> {
  if (req.method !== 'POST') throw new ValidationError('POST required');

  const body = await req.json();
  const { notion_api_key } = body;

  if (!notion_api_key || typeof notion_api_key !== 'string') {
    throw new ValidationError('notion_api_key required');
  }

  const res = await fetch('https://api.notion.com/v1/search', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${notion_api_key}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filter: { value: 'database', property: 'object' },
      sort: { direction: 'descending', timestamp: 'last_edited_time' },
    }),
  });

  if (res.status === 401) {
    throw new ValidationError('Invalid Notion API key', '노션 API 키가 올바르지 않습니다.');
  }
  if (!res.ok) {
    throw new ValidationError(`Notion API error: ${res.status}`);
  }

  const data = await res.json();
  const databases = data.results.map((db: any) => ({
    id: db.id.replace(/-/g, ''),
    title: db.title?.[0]?.plain_text || '제목 없음',
  }));

  return jsonResponse({ databases });
}

// === 헬퍼 함수 ===

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// 노션 API 키 유효성 검증
async function verifyNotionApiKey(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch('https://api.notion.com/v1/users/me', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': '2022-06-28',
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}

function jsonResponse(data: any, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

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
import { env } from '../_shared/env.ts';
import { logger } from '../_shared/logger.ts';
import {
  AuthError,
  corsHeaders,
  errorToResponse,
  ValidationError,
} from '../_shared/errors.ts';
import { DAILY_QUOTAS, getEffectiveTier } from '../_shared/types.ts';
import type { SubscriptionTier } from '../_shared/types.ts';

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
      case 'verify-user':
        return await handleVerifyUser(url);
      case 'history':
        return await handleHistory(req, url);
      case 'admin-create-user':
        return await handleAdminCreateUser(req);
      case 'admin-list-users':
        return await handleAdminListUsers(req, url);
      case 'admin-upgrade-user':
        return await handleAdminUpgradeUser(req);
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

  // 노션 API 키 + DB 접근 권한 검증
  const keyValid = await verifyNotionApiKey(notion_api_key);
  if (!keyValid) {
    throw new ValidationError(
      'Invalid Notion API key',
      '노션 API 키가 올바르지 않습니다. 다시 확인해주세요.',
    );
  }

  const dbAccessible = await verifyNotionDatabase(notion_api_key, notion_database_id);
  if (!dbAccessible) {
    throw new ValidationError(
      'Database not accessible',
      '데이터베이스에 접근할 수 없습니다. 노션에서 해당 DB에 통합을 연결했는지 확인해주세요.',
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

  const effectiveTier = getEffectiveTier(
    user.subscription_tier as SubscriptionTier,
    user.subscription_expires_at,
  );
  const limit = DAILY_QUOTAS[effectiveTier] || DAILY_QUOTAS.free;
  const used = todayUsage?.search_count || 0;

  return jsonResponse({
    subscription_tier: effectiveTier,
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

// === user_id 유효성 검증 ===
async function handleVerifyUser(url: URL): Promise<Response> {
  const user_id = url.searchParams.get('user_id');
  if (!user_id) throw new ValidationError('user_id required');

  const { data, error } = await getSupabase()
    .from('users')
    .select('id, subscription_tier, notion_database_id')
    .eq('id', user_id)
    .single();

  if (error || !data) {
    return jsonResponse({ valid: false }, 200);
  }

  return jsonResponse({
    valid: true,
    subscription_tier: data.subscription_tier,
    notion_configured: !!data.notion_database_id,
  });
}

// === 검색 기록 조회 ===
async function handleHistory(_req: Request, url: URL): Promise<Response> {
  const user_id = url.searchParams.get('user_id');
  if (!user_id) throw new ValidationError('user_id required');

  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10)));

  const { data, error } = await getSupabase()
    .from('search_logs')
    .select('keyword, platforms, period, result_count, duration_ms, status, error_message, created_at')
    .eq('user_id', user_id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`History query failed: ${error.message}`);

  return jsonResponse({ searches: data || [] });
}

// === 관리자: 사용자 생성 ===
async function handleAdminCreateUser(req: Request): Promise<Response> {
  if (req.method !== 'POST') throw new ValidationError('POST required');
  requireAdmin(req);

  const body = await req.json();
  const email = body.email?.trim();
  const tier = body.subscription_tier || 'free';

  if (!email || !isValidEmail(email)) {
    throw new ValidationError('Invalid email');
  }
  if (!['free', 'light', 'standard', 'premium'].includes(tier)) {
    throw new ValidationError(`Invalid subscription_tier: ${tier}`);
  }

  const { data: existing } = await getSupabase()
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (existing) {
    throw new ValidationError('Email already registered', '이미 등록된 이메일입니다.');
  }

  const { data, error } = await getSupabase()
    .from('users')
    .insert({ email, subscription_tier: tier })
    .select('id, email, subscription_tier')
    .single();

  if (error || !data) {
    throw new Error(`Create user failed: ${error?.message}`);
  }

  logger.info('Admin created user', { user_id: data.id, email, tier });

  const setupUrl = `https://pchanul.github.io/Snappy/?user_id=${data.id}`;
  return jsonResponse({ user_id: data.id, email: data.email, subscription_tier: data.subscription_tier, setup_url: setupUrl });
}

// === 관리자: 사용자 목록 ===
async function handleAdminListUsers(req: Request, url: URL): Promise<Response> {
  requireAdmin(req);

  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10)));
  const from = (page - 1) * limit;

  const { data, error, count } = await getSupabase()
    .from('users')
    .select('id, email, subscription_tier, subscription_expires_at, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);

  if (error) throw new Error(`List users failed: ${error.message}`);

  return jsonResponse({ users: data || [], total: count ?? 0, page, limit });
}

// === 관리자: 사용자 등급 변경 ===
async function handleAdminUpgradeUser(req: Request): Promise<Response> {
  if (req.method !== 'POST') throw new ValidationError('POST required');
  requireAdmin(req);

  const body = await req.json();
  const { user_id, subscription_tier, days } = body;

  if (!user_id || typeof user_id !== 'string') {
    throw new ValidationError('user_id required');
  }
  if (!['free', 'light', 'standard', 'premium'].includes(subscription_tier)) {
    throw new ValidationError(`Invalid subscription_tier: ${subscription_tier}`);
  }

  let subscription_expires_at: string | null = null;
  if (days !== undefined) {
    const d = parseInt(String(days), 10);
    if (isNaN(d) || d < 1) throw new ValidationError('days must be a positive integer');
    const exp = new Date();
    exp.setDate(exp.getDate() + d);
    subscription_expires_at = exp.toISOString();
  }

  const update: Record<string, string | null> = { subscription_tier };
  // tier가 free이거나 days 미지정 시 만료일 초기화
  update.subscription_expires_at = subscription_expires_at;

  const { error } = await getSupabase()
    .from('users')
    .update(update)
    .eq('id', user_id);

  if (error) throw new Error(`Upgrade failed: ${error.message}`);

  logger.info('Admin upgraded user', { user_id, subscription_tier, subscription_expires_at });

  return jsonResponse({ success: true, user_id, subscription_tier, subscription_expires_at });
}

// === 헬퍼 함수 ===

function requireAdmin(req: Request): void {
  const secret = env.admin.secret;
  if (!secret) throw new ValidationError('Admin not configured', '관리자 기능이 설정되지 않았습니다.');
  const header = req.headers.get('x-admin-secret');
  if (header !== secret) throw new AuthError('Invalid admin secret');
}

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

// 노션 DB 접근 권한 검증 (통합이 연결되어 있어야 함)
async function verifyNotionDatabase(apiKey: string, databaseId: string): Promise<boolean> {
  // UUID 형식으로 정규화 (32자리 → 8-4-4-4-12)
  const id = databaseId.replace(/-/g, '');
  const uuid = `${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20)}`;
  try {
    const response = await fetch(`https://api.notion.com/v1/databases/${uuid}`, {
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

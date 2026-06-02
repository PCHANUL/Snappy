// 사용자 관리 Edge Function
// 노션 키 등록, 사용량 조회, 검색 버튼 설정
//
// 엔드포인트:
//   POST /functions/v1/manage-user?action=setup-notion
//   POST /functions/v1/manage-user?action=ensure-search-database
//   GET  /functions/v1/manage-user?action=usage&user_id=...
//
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { decryptNotionKey } from '../_core/crypto.ts';
import { getSupabase } from '../_core/db.ts';
import { env } from '../_core/env.ts';
import { logger } from '../_core/logger.ts';
import { fetchNaverTrendTopics } from '../_trends/naver-trends.ts';
import { fetchNaverAutocomplete } from '../_trends/naver-autocomplete.ts';
import { fetchGoogleDailyTrends, fetchGoogleRelatedQueries } from '../_trends/google-trends.ts';
import {
  AuthError,
  corsHeaders,
  errorToResponse,
  ValidationError,
} from '../_core/errors.ts';
import { DAILY_QUOTAS, getEffectiveTier } from '../_core/types.ts';
import type { SubscriptionTier } from '../_core/types.ts';
import { NotionClient } from '../_notion/client.ts';

const EXPECTED_TEMPLATE_PAGE_NAME = (Deno.env.get('TEMPLATE_PAGE_NAME') || '트렌드 콘텐츠 발견기').trim();

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');

    switch (action) {
      case 'setup-notion':
        return await handleSetupNotion(req);
      case 'usage':
        return await handleUsage(req, url);
      case 'list-databases':
        return await handleListDatabases(req);
      case 'ensure-search-database':
        return await handleEnsureSearchDatabase(req);
      case 'list-pages':
        return await handleListPages(req);
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
      case 'setup-search-button':
        return await handleSetupSearchButton(req);
      case 'set-search-status':
        return await handleSetSearchStatus(req);
      case 'get-search-status':
        return await handleGetSearchStatus(url);
      case 'trend-daily':
        return await handleTrendDaily();
      case 'trend-google-daily':
        return await handleTrendGoogleDaily();
      case 'trend-google-related':
        return await handleTrendGoogleRelated(url);
      case 'trend-suggest':
        return await handleTrendSuggest(url);
      default:
        throw new ValidationError(`Unknown action: ${action}`);
    }
  } catch (error) {
    logger.error('manage-user error', error);
    return errorToResponse(error);
  }
});

// === 노션 DB 연동 ===
async function handleSetupNotion(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    throw new ValidationError('POST required');
  }

  const body = await req.json();
  const { user_id, notion_database_id } = body;

  if (!user_id || typeof user_id !== 'string') {
    throw new ValidationError('user_id required');
  }
  if (!notion_database_id || typeof notion_database_id !== 'string') {
    throw new ValidationError(
      'notion_database_id required',
      '노션 데이터베이스 ID를 입력해주세요.',
    );
  }

  const { error } = await getSupabase()
    .from('users')
    .update({ notion_database_id })
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

// === 연결된 노션 페이지에 검색 DB 생성/연동 ===
async function handleEnsureSearchDatabase(req: Request): Promise<Response> {
  if (req.method !== 'POST') throw new ValidationError('POST required');

  const body = await req.json();
  const { user_id } = body;
  const requestedPageId = typeof body.page_id === 'string' ? body.page_id.trim() : '';

  if (!user_id || typeof user_id !== 'string') {
    throw new ValidationError('user_id required');
  }

  const { data: user, error: userError } = await getSupabase()
    .from('users')
    .select('notion_api_key_encrypted')
    .eq('id', user_id)
    .single();

  if (userError || !user) {
    throw new ValidationError('User not found', '유저를 찾을 수 없습니다.');
  }
  if (!user.notion_api_key_encrypted) {
    throw new ValidationError('No token stored for user', '노션 연동이 필요합니다.');
  }

  const apiKey = await decryptNotionKey(user.notion_api_key_encrypted);
  const notion = new NotionClient(apiKey);

  let page: { id: string; title: string } | null = requestedPageId
    ? { id: requestedPageId.replace(/-/g, ''), title: '연결된 페이지' }
    : await notion.findAccessiblePageByTitle(EXPECTED_TEMPLATE_PAGE_NAME);

  if (!page) {
    const pages = await notion.listAccessiblePages();
    if (pages.length === 1) {
      page = pages[0];
    } else if (pages.length === 0) {
      throw new ValidationError(
        'No accessible Notion page',
        '연결된 Notion 페이지를 찾지 못했습니다. Notion 연결을 다시 진행하면서 복제한 Snappy 페이지를 선택해주세요.',
      );
    } else {
      throw new ValidationError(
        'Multiple accessible Notion pages',
        '여러 Notion 페이지가 연결되어 대상 페이지를 고를 수 없습니다. Notion 연결을 다시 진행하면서 복제한 Snappy 페이지만 선택해주세요.',
      );
    }
  }

  const database = await notion.ensureSearchDatabase(page.id);

  const { error: updateError } = await getSupabase()
    .from('users')
    .update({ notion_database_id: database.id })
    .eq('id', user_id);

  if (updateError) {
    throw new Error(`Setup failed: ${updateError.message}`);
  }

  logger.info('Search database ensured', {
    user_id,
    page_id: page.id,
    database_id: database.id,
    created: database.created,
  });

  return jsonResponse({
    success: true,
    notion_database_id: database.id,
    database_title: database.title,
    page_id: page.id,
    page_title: page.title,
    created: database.created,
    message: database.created
      ? '검색 DB를 생성하고 연결했습니다.'
      : '기존 검색 DB를 연결했습니다.',
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
  let { notion_api_key, user_id } = body;

  // OAuth 플로우: user_id만 제공된 경우 저장된 토큰 사용
  if (!notion_api_key && user_id) {
    const { data } = await getSupabase()
      .from('users')
      .select('notion_api_key_encrypted')
      .eq('id', user_id)
      .single();

    if (!data?.notion_api_key_encrypted) {
      throw new ValidationError('No token stored for user', '노션 연동이 필요합니다.');
    }
    notion_api_key = await decryptNotionKey(data.notion_api_key_encrypted);
  }

  if (!notion_api_key || typeof notion_api_key !== 'string') {
    throw new ValidationError('notion_api_key or user_id required');
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
  const databases = data.results.map((db: any) => {
    const props = db.properties || {};
    const is_snappy =
      props['키워드']?.type === 'title' &&
      '매체' in props &&
      '상태' in props;
    return {
      id: db.id.replace(/-/g, ''),
      title: db.title?.[0]?.plain_text || '제목 없음',
      is_snappy,
    };
  });

  return jsonResponse({ databases });
}

// === 연결된 노션 페이지 목록 조회 ===
async function handleListPages(req: Request): Promise<Response> {
  if (req.method !== 'POST') throw new ValidationError('POST required');

  const { user_id } = await req.json();
  if (!user_id || typeof user_id !== 'string') throw new ValidationError('user_id required');

  const { data } = await getSupabase()
    .from('users')
    .select('notion_api_key_encrypted')
    .eq('id', user_id)
    .single();

  if (!data?.notion_api_key_encrypted) {
    throw new ValidationError('No token stored for user', '노션 연동이 필요합니다.');
  }

  const apiKey = await decryptNotionKey(data.notion_api_key_encrypted);
  const pages = await new NotionClient(apiKey).listAccessiblePages();

  return jsonResponse({ pages });
}

// === user_id 유효성 검증 ===
async function handleVerifyUser(url: URL): Promise<Response> {
  const user_id = url.searchParams.get('user_id');
  if (!user_id) throw new ValidationError('user_id required');

  const { data, error } = await getSupabase()
    .from('users')
    .select('id, subscription_tier, notion_api_key_encrypted, notion_database_id')
    .eq('id', user_id)
    .single();

  if (error || !data) {
    return jsonResponse({ valid: false }, 200);
  }

  return jsonResponse({
    valid: true,
    user_id: data.id,
    subscription_tier: data.subscription_tier,
    notion_key_set: !!data.notion_api_key_encrypted,
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

// === 검색 완료 여부 폴링용 상태 조회 ===
async function handleGetSearchStatus(url: URL): Promise<Response> {
  const user_id = url.searchParams.get('user_id');
  if (!user_id) throw new ValidationError('user_id required');

  const { data, error } = await getSupabase()
    .from('users')
    .select('searching_since, search_progress, last_search_error, last_related_keywords')
    .eq('id', user_id)
    .single();

  if (error || !data) throw new AuthError('User not found');

  return jsonResponse({
    searching: data.searching_since !== null,
    message: data.search_progress ?? null,
    error: data.last_search_error ?? null,
    related: data.last_related_keywords ?? null,
  });
}

// === 검색 중 상태 임베드 URL 반영 ===
async function handleSetSearchStatus(req: Request): Promise<Response> {
  if (req.method !== 'POST') throw new ValidationError('POST required');
  const { user_id, searching } = await req.json();
  if (!user_id || typeof user_id !== 'string') throw new ValidationError('user_id required');

  const { data: user, error } = await getSupabase()
    .from('users')
    .select('notion_api_key_encrypted, notion_database_id')
    .eq('id', user_id)
    .single();

  if (error || !user?.notion_api_key_encrypted || !user?.notion_database_id) {
    return jsonResponse({ success: false }, 200); // non-fatal
  }

  const apiKey = await decryptNotionKey(user.notion_api_key_encrypted);
  const notion = new NotionClient(apiKey);
  await notion.setSearchEmbedStatus(user.notion_database_id, !!searching);

  return jsonResponse({ success: true });
}

// === 검색 버튼 임베드 URL 업데이트 ===
async function handleSetupSearchButton(req: Request): Promise<Response> {
  if (req.method !== 'POST') throw new ValidationError('POST required');

  const body = await req.json();
  const { user_id } = body;
  if (!user_id || typeof user_id !== 'string') throw new ValidationError('user_id required');

  const { data: user, error } = await getSupabase()
    .from('users')
    .select('notion_api_key_encrypted, notion_database_id')
    .eq('id', user_id)
    .single();

  if (error || !user) throw new ValidationError('User not found', '유저를 찾을 수 없습니다.');
  if (!user.notion_api_key_encrypted || !user.notion_database_id) {
    throw new ValidationError('Notion not configured', '노션 연동을 먼저 완료해주세요.');
  }

  const apiKey = await decryptNotionKey(user.notion_api_key_encrypted);
  const notion = new NotionClient(apiKey);
  const embedUrl = await notion.updateSearchEmbed(user.notion_database_id, user_id);
  await notion.updateTrendsEmbed(user.notion_database_id, user_id);
  await notion.updateGeoEmbed(user.notion_database_id, user_id);

  logger.info('Search button embed updated', { user_id, embedUrl });
  return jsonResponse({ success: true, embed_url: embedUrl });
}

// === 네이버 자동완성 — 키워드 후보 제안 ===
async function handleTrendSuggest(url: URL): Promise<Response> {
  const keyword = url.searchParams.get('keyword')?.trim() || '';
  if (!keyword) return jsonResponse({ suggestions: [] });
  try {
    const suggestions = await fetchNaverAutocomplete(keyword);
    return jsonResponse({ suggestions });
  } catch (error) {
    logger.warn('Naver autocomplete unavailable', { error: String(error) });
    return jsonResponse({ suggestions: [] });
  }
}

// === 네이버 데이터랩 — 후보 키워드 검색량 트렌드 ===
async function handleTrendDaily(): Promise<Response> {
  try {
    return jsonResponse({
      topics: await fetchNaverTrendTopics(
        env.naver.clientId,
        env.naver.clientSecret,
        Deno.env.get('NAVER_TREND_KEYWORDS') || '',
      ),
    });
  } catch (error) {
    logger.warn('Naver trend unavailable', { error: String(error) });
    return jsonResponse({ topics: [] });
  }
}

// === 구글 트렌드 — 오늘의 인기 검색어 (RSS) ===
async function handleTrendGoogleDaily(): Promise<Response> {
  try {
    const topics = await fetchGoogleDailyTrends('KR');
    return jsonResponse({ topics, source: 'google' });
  } catch (error) {
    logger.warn('Google Trends daily unavailable', { error: String(error) });
    return jsonResponse({ topics: [], source: 'google' });
  }
}

// === 구글 트렌드 — 키워드 상승 관련 검색어 (explore + multirange) ===
async function handleTrendGoogleRelated(url: URL): Promise<Response> {
  const keyword = url.searchParams.get('keyword')?.trim() || '';
  if (!keyword) return jsonResponse({ queries: [] });
  try {
    const queries = await fetchGoogleRelatedQueries(keyword);
    return jsonResponse({ queries });
  } catch (error) {
    logger.warn('Google related queries unavailable', { error: String(error) });
    return jsonResponse({ queries: [] });
  }
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


function jsonResponse(data: any, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

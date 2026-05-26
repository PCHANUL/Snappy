// Supabase DB 접근 유틸리티

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { decryptNotionKey } from './crypto.ts';
import { env } from '../_shared/env.ts';
import { AuthError, QuotaExceededError, ValidationError } from '../_shared/errors.ts';
import { DAILY_QUOTAS, getEffectiveTier } from '../_shared/types.ts';
import type { FlatResult, Platform, SearchMetadata, SearchResult, SubscriptionTier, User } from '../_shared/types.ts';
import { crawlUrl } from './crawler.ts';

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_client) {
    _client = createClient(env.supabase.url, env.supabase.serviceRoleKey, {
      auth: { persistSession: false },
    });
  }
  return _client;
}

// ── 유저 ──────────────────────────────────────────────────────────────────────

export async function getUser(userId: string): Promise<User> {
  const { data, error } = await getSupabase()
    .from('users')
    .select('id, email, subscription_tier, subscription_expires_at, notion_api_key_encrypted, notion_database_id')
    .eq('id', userId)
    .single();

  if (error || !data) throw new AuthError('User not found');

  if (!data.notion_api_key_encrypted || !data.notion_database_id) {
    throw new ValidationError('Notion integration not configured', '노션 연동을 먼저 완료해주세요.');
  }

  return {
    id: data.id,
    email: data.email,
    subscription_tier: data.subscription_tier,
    subscription_expires_at: data.subscription_expires_at,
    notion_api_key: await decryptNotionKey(data.notion_api_key_encrypted),
    notion_database_id: data.notion_database_id,
  };
}

// 사용자 조회 + 사용량 체크 병렬 실행 — DB 왕복 1회 절감
export async function getUserAndCheckQuota(userId: string): Promise<User> {
  const today = new Date().toISOString().slice(0, 10);
  const STALE_MS = 3 * 60 * 1000; // 3분 초과 시 stale 처리

  const [userResult, quotaResult] = await Promise.all([
    getSupabase()
      .from('users')
      .select('id, email, subscription_tier, subscription_expires_at, notion_api_key_encrypted, notion_database_id, searching_since')
      .eq('id', userId)
      .single(),
    getSupabase()
      .from('usage_quotas')
      .select('search_count')
      .eq('user_id', userId)
      .eq('date', today)
      .maybeSingle(),
  ]);

  if (userResult.error || !userResult.data) throw new AuthError('User not found');

  const data = userResult.data;
  if (!data.notion_api_key_encrypted || !data.notion_database_id) {
    throw new ValidationError('Notion integration not configured', '노션 연동을 먼저 완료해주세요.');
  }

  const effectiveTier = getEffectiveTier(data.subscription_tier as SubscriptionTier, data.subscription_expires_at);

  if (effectiveTier !== data.subscription_tier) {
    getSupabase()
      .from('users')
      .update({ subscription_tier: 'free', subscription_expires_at: null })
      .eq('id', data.id)
      .then(({ error }) => { if (error) console.error('Auto-downgrade failed', error); });
  }

  const limit = DAILY_QUOTAS[effectiveTier] ?? DAILY_QUOTAS.free;
  if ((quotaResult.data?.search_count ?? 0) >= limit) throw new QuotaExceededError(limit);

  // 검색 중 상태 확인 — stale(3분 초과)이 아니면 중복 요청 차단
  if (data.searching_since) {
    const elapsed = Date.now() - new Date(data.searching_since).getTime();
    if (elapsed < STALE_MS) {
      throw new ValidationError('Search already in progress', '이미 검색이 진행 중입니다. 잠시 후 다시 시도해주세요.');
    }
    // stale → 자동 해제 후 계속 진행
    getSupabase().from('users').update({ searching_since: null }).eq('id', data.id)
      .then(({ error }) => { if (error) console.error('Failed to clear stale searching_since', error); });
  }

  return {
    id: data.id,
    email: data.email,
    subscription_tier: effectiveTier,
    subscription_expires_at: effectiveTier === 'free' && effectiveTier !== data.subscription_tier
      ? null
      : data.subscription_expires_at,
    notion_api_key: await decryptNotionKey(data.notion_api_key_encrypted),
    notion_database_id: data.notion_database_id,
  };
}

// ── 검색 진행 상태 ────────────────────────────────────────────────────────────

export async function markSearchingStart(userId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('users')
    .update({ searching_since: new Date().toISOString(), search_progress: null })
    .eq('id', userId);
  if (error) console.error('Failed to mark searching start', error);
}

export async function markSearchingEnd(userId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('users')
    .update({ searching_since: null, search_progress: null })
    .eq('id', userId);
  if (error) console.error('Failed to mark searching end', error);
}

export async function updateSearchProgress(userId: string, message: string): Promise<void> {
  const { error } = await getSupabase()
    .from('users')
    .update({ search_progress: message })
    .eq('id', userId);
  if (error) console.error('Failed to update search progress', error);
}

// ── 사용량 ────────────────────────────────────────────────────────────────────

export async function incrementUsage(userId: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await getSupabase().rpc('increment_search_count', {
    p_user_id: userId,
    p_date: today,
  });
  if (error) console.error('Failed to increment usage', error);
}

// ── 검색 결과 저장 (정규화 3-테이블 구조) ─────────────────────────────────────
//
// search_results      → 검색 이벤트 메타데이터 (유저 로그)
// content_items       → URL 기준 중복 제거 컨텐츠 (자체 데이터)
// search_result_items → junction (어느 검색에서 어떤 순서로 나왔는지)

export async function saveSearchResults(
  notionPageId: string,
  userId: string,
  keyword: string,
  platforms: Platform[],
  period: string,
  results: SearchResult[],
  metadata: SearchMetadata,
): Promise<void> {
  const flatResults: FlatResult[] = results.flatMap(r =>
    r.items.map(item => ({ ...item, platform: r.platform }))
  );

  if (flatResults.length === 0) return;

  // 1. 검색 이벤트 INSERT
  const { data: sr, error: srErr } = await getSupabase()
    .from('search_results')
    .insert({
      notion_page_id: notionPageId,
      user_id: userId,
      keyword,
      platforms,
      period,
      total_count: flatResults.length,
      shown_count: 0,
      metadata,
    })
    .select('id')
    .single();

  if (srErr || !sr) {
    console.error('Failed to insert search_result', srErr);
    return;
  }

  // 2. content_items 배치 upsert (RPC — search_count 증가 + keywords 누적)
  const { data: contentItems, error: ciErr } = await getSupabase()
    .rpc('upsert_content_items', {
      p_keyword: keyword,
      p_items: JSON.stringify(flatResults),
    });

  if (ciErr || !contentItems) {
    console.error('Failed to upsert content_items', ciErr);
    return;
  }

  // 3. junction INSERT (search_result_id + content_item_id + rank)
  const urlToId = new Map<string, string>(
    (contentItems as Array<{ id: string; url: string }>).map(c => [c.url, c.id])
  );

  const junctionRows = flatResults
    .map((item, idx) => ({
      search_result_id: sr.id,
      content_item_id:  urlToId.get(item.url),
      rank: idx + 1,
    }))
    .filter(r => r.content_item_id != null);

  const { error: jiErr } = await getSupabase()
    .from('search_result_items')
    .insert(junctionRows);

  if (jiErr) console.error('Failed to insert search_result_items', jiErr);
}

// ── 더보기 페이지네이션 ───────────────────────────────────────────────────────

export interface NextBatch {
  items: FlatResult[];
  keyword: string;
  metadata: { duration_ms: number; cost_usd: number; total: number };
  shownCount: number;
  hasMore: boolean;
}

export async function getNextBatch(
  notionPageId: string,
  userId: string,
  batchSize = 5,
): Promise<NextBatch | null> {
  // 해당 페이지의 가장 최근 검색 결과
  const { data: sr } = await getSupabase()
    .from('search_results')
    .select('id, keyword, metadata, shown_count, total_count')
    .eq('notion_page_id', notionPageId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!sr || sr.shown_count >= sr.total_count) return null;

  // junction → content_items 조인으로 다음 배치
  const { data: rows } = await getSupabase()
    .from('search_result_items')
    .select('rank, content_items(*)')
    .eq('search_result_id', sr.id)
    .gt('rank', sr.shown_count)
    .lte('rank', sr.shown_count + batchSize)
    .order('rank');

  if (!rows || rows.length === 0) return null;

  const items = rows.map(r => r.content_items as unknown as FlatResult);
  const newShownCount = sr.shown_count + items.length;
  const hasMore = newShownCount < sr.total_count;

  await getSupabase()
    .from('search_results')
    .update({ shown_count: newShownCount })
    .eq('id', sr.id);

  return {
    items,
    keyword: sr.keyword,
    metadata: sr.metadata,
    shownCount: newShownCount,
    hasMore,
  };
}

// ── 이력 조회 (유저 개인 + 자체 데이터 활용) ─────────────────────────────────

export interface SearchHistoryEntry {
  id: string;
  notion_page_id: string;
  keyword: string;
  platforms: Platform[];
  period: string;
  total_count: number;
  shown_count: number;
  metadata: { duration_ms: number; cost_usd: number };
  created_at: string;
}

export async function getSearchHistory(
  userId: string,
  limit = 50,
): Promise<SearchHistoryEntry[]> {
  const { data, error } = await getSupabase()
    .from('search_results')
    .select('id, notion_page_id, keyword, platforms, period, total_count, shown_count, metadata, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Failed to fetch search history', error);
    return [];
  }
  return (data ?? []) as SearchHistoryEntry[];
}

// 키워드 빈도 집계 — 개인 또는 전체 집계 (userId 없으면 전체)
export async function getKeywordFrequency(
  opts: { userId?: string; since?: string; limit?: number } = {},
): Promise<Array<{ keyword: string; count: number; last_searched: string }>> {
  let query = getSupabase()
    .from('search_results')
    .select('keyword, created_at')
    .order('created_at', { ascending: false });

  if (opts.userId) query = query.eq('user_id', opts.userId);
  if (opts.since)  query = query.gte('created_at', opts.since);

  const { data, error } = await query;
  if (error || !data) return [];

  const freq = new Map<string, { count: number; last_searched: string }>();
  for (const row of data) {
    const existing = freq.get(row.keyword);
    if (!existing) {
      freq.set(row.keyword, { count: 1, last_searched: row.created_at });
    } else {
      existing.count += 1;
    }
  }

  const result = Array.from(freq.entries())
    .map(([keyword, { count, last_searched }]) => ({ keyword, count, last_searched }))
    .sort((a, b) => b.count - a.count);

  return opts.limit ? result.slice(0, opts.limit) : result;
}

// 자체 컨텐츠 DB 조회 — 특정 키워드에서 많이 발견된 컨텐츠
export async function getTopContentByKeyword(
  keyword: string,
  limit = 20,
): Promise<Array<{ url: string; title: string; platform: string; search_count: number }>> {
  const { data, error } = await getSupabase()
    .from('content_items')
    .select('url, title, platform, search_count')
    .contains('keywords', [keyword])
    .order('search_count', { ascending: false })
    .limit(limit);

  if (error) return [];
  return data ?? [];
}

// ── 검색 로그 ─────────────────────────────────────────────────────────────────

export interface SearchLogEntry {
  user_id: string;
  keyword: string;
  platforms: Platform[];
  period: string;
  result_count: number;
  duration_ms: number;
  cost_usd: number;
  status: 'success' | 'failed';
  error_message?: string;
}

export async function logSearch(entry: SearchLogEntry): Promise<void> {
  const { error } = await getSupabase().from('search_logs').insert({
    user_id: entry.user_id,
    keyword: entry.keyword,
    platforms: entry.platforms,
    period: entry.period,
    result_count: entry.result_count,
    duration_ms: entry.duration_ms,
    cost_usd: entry.cost_usd,
    status: entry.status,
    error_message: entry.error_message,
  });
  if (error) console.error('Failed to log search', error);
}

// ── 크롤링 ────────────────────────────────────────────────────────────────────

// 검색 결과에서 방금 저장된 URL들을 백그라운드에서 크롤링
// trigger-search에서 EdgeRuntime.waitUntil()로 호출
export async function crawlSearchResults(items: Array<{ url: string; platform: string }>): Promise<void> {
  const CONCURRENCY = 5; // 동시 크롤 제한

  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    await Promise.allSettled(batch.map(async ({ url, platform }) => {
      const result = await crawlUrl(url, platform);
      const { error } = await getSupabase()
        .from('content_items')
        .update({
          full_text:    result.full_text ?? null,
          word_count:   result.word_count ?? 0,
          crawl_status: result.status,
          crawled_at:   new Date().toISOString(),
        })
        .eq('url', url)
        .eq('crawl_status', 'pending'); // 이미 크롤된 항목은 덮어쓰지 않음
      if (error) console.error('Failed to update crawl result', url, error);
    }));
  }
}

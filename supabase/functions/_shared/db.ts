// Supabase DB 접근 유틸리티
// 사용자 정보 조회, 사용량 관리, 검색 로그 저장

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { decryptNotionKey } from './crypto.ts';
import { env } from '../_shared/env.ts';
import { AuthError, QuotaExceededError, ValidationError } from '../_shared/errors.ts';
import { DAILY_QUOTAS } from '../_shared/types.ts';
import type { Platform, User } from '../_shared/types.ts';

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_client) {
    _client = createClient(env.supabase.url, env.supabase.serviceRoleKey, {
      auth: { persistSession: false },
    });
  }
  return _client;
}

export async function getUser(userId: string): Promise<User> {
  const { data, error } = await getSupabase()
    .from('users')
    .select('id, email, subscription_tier, subscription_expires_at, notion_api_key_encrypted, notion_database_id')
    .eq('id', userId)
    .single();

  if (error || !data) {
    throw new AuthError('User not found');
  }

  if (!data.notion_api_key_encrypted || !data.notion_database_id) {
    throw new ValidationError(
      'Notion integration not configured',
      '노션 연동을 먼저 완료해주세요.',
    );
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

// 사용량 한도 체크
export async function checkQuota(user: User): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const limit = DAILY_QUOTAS[user.subscription_tier] || DAILY_QUOTAS.free;

  const { data } = await getSupabase()
    .from('usage_quotas')
    .select('search_count')
    .eq('user_id', user.id)
    .eq('date', today)
    .maybeSingle();

  const currentCount = data?.search_count || 0;
  if (currentCount >= limit) {
    throw new QuotaExceededError(limit);
  }
}

// 사용량 증가 (RPC 호출)
export async function incrementUsage(userId: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  const { error } = await getSupabase().rpc('increment_search_count', {
    p_user_id: userId,
    p_date: today,
  });

  if (error) {
    // 사용량 증가 실패는 치명적이지 않으므로 로깅만
    console.error('Failed to increment usage', error);
  }
}

// 검색 로그 저장
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

  if (error) {
    console.error('Failed to log search', error);
  }
}

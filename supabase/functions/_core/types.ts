// 공통 타입 정의
// 모든 모듈이 공유하는 타입. 변경 시 전체 영향.

export type Platform =
  | 'naver_blog'
  | 'youtube'
  | 'youtube_shorts'
  | 'tistory'
  | 'brunch'
  | 'tiktok'
  | 'instagram_reels';
export type Period = 'day' | 'week' | 'month' | 'year';
export type SearchStatus = '대기' | '검색중' | '완료' | '실패';
export type SubscriptionTier = 'free' | 'light' | 'standard' | 'premium';

export interface SearchRequest {
  user_id: string;
  notion_page_id: string;
  keyword: string;
  platforms: Platform[];
  period: Period;
  result_count: number;
}

export interface ContentItem {
  platform: Platform;
  title: string;
  url: string;
  description: string;
  snippet?: string;
  author?: string;
  thumbnail?: string;
  published_at?: string;
}

export interface SearchResult {
  platform: Platform;
  items: ContentItem[];
  count: number;
  error?: string;
}

// 플랫폼 정보가 포함된 평탄화된 결과 (페이지네이션 캐시용)
export interface FlatResult extends ContentItem {
  platform: Platform;
}

export interface User {
  id: string;
  email: string;
  subscription_tier: SubscriptionTier;
  subscription_expires_at: string | null;
  notion_api_key: string;
  notion_database_id: string;
}

export interface SearchMetadata {
  duration_ms: number;
  cost_usd: number;
}

// 매체별 정보
export const PLATFORM_INFO: Record<Platform, { name: string; emoji: string }> = {
  naver_blog: { name: '네이버 블로그', emoji: '📝' },
  youtube: { name: '유튜브', emoji: '🎥' },
  youtube_shorts: { name: '유튜브 숏츠', emoji: '📱' },
  tistory: { name: '티스토리', emoji: '📚' },
  brunch: { name: '브런치', emoji: '✍️' },
  tiktok: { name: '틱톡', emoji: '🎵' },
  instagram_reels: { name: '인스타 릴스', emoji: '📸' },
};

// 플랜별 일일 한도
export const DAILY_QUOTAS: Record<SubscriptionTier, number> = {
  free: 3,
  light: 5,
  standard: 10,
  premium: 30,
};

// 구독 만료 여부를 반영한 실제 티어 반환 (만료 후 7일 유예)
export function getEffectiveTier(tier: SubscriptionTier, expiresAt: string | null): SubscriptionTier {
  if (!expiresAt) return tier;
  const GRACE_MS = 7 * 24 * 60 * 60 * 1000;
  if (Date.now() > new Date(expiresAt).getTime() + GRACE_MS) return 'free';
  return tier;
}

// Instagram Graph API — 해시태그 기반 공개 게시물 검색
//
// 키워드 → 해시태그 변환 후 top_media(인기) 또는 recent_media(최신) 조회.
// 인증: 장기 사용자 액세스 토큰 (60일, 갱신 필요) + Instagram Business 계정 ID.
// 제약: 동일 계정으로 7일 내 고유 해시태그 검색 30회 한도 (Meta 정책).

import { env } from '../_core/env.ts';
import { ExternalApiError } from '../_core/errors.ts';
import { logger } from '../_core/logger.ts';
import type { ContentItem, Period } from '../_core/types.ts';

const GRAPH_API = 'https://graph.facebook.com/v21.0';
const MEDIA_FIELDS = 'id,caption,media_type,permalink,like_count,comments_count,timestamp';

interface IgHashtagSearchResponse {
  data: Array<{ id: string }>;
}

interface IgMediaItem {
  id: string;
  caption?: string;
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  permalink: string;
  like_count?: number;
  comments_count?: number;
  timestamp: string;
}

interface IgMediaResponse {
  data: IgMediaItem[];
}

export async function searchInstagram(
  keyword: string,
  count: number = 10,
  period: Period = 'month',
): Promise<ContentItem[]> {
  const { accessToken, businessAccountId } = env.instagram;
  if (!accessToken || !businessAccountId) {
    throw new ExternalApiError('Instagram', 'credentials not configured (INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_BUSINESS_ACCOUNT_ID)');
  }

  const hashtag = toHashtag(keyword);
  logger.info('Instagram search started', { keyword, hashtag, period });

  const hashtagId = await getHashtagId(hashtag, businessAccountId, accessToken);
  if (!hashtagId) {
    logger.info('Instagram: hashtag not found', { hashtag });
    return [];
  }

  // day/week는 최신 게시물, month/year는 인기 게시물
  const edge = (period === 'day' || period === 'week') ? 'recent_media' : 'top_media';
  const posts = await getMedia(hashtagId, edge, businessAccountId, accessToken);

  const since = periodToDate(period);
  const filtered = since
    ? posts.filter(p => new Date(p.timestamp) >= since)
    : posts;

  // period 필터로 결과가 없으면 인기 게시물로 폴백
  const final = filtered.length > 0 ? filtered : posts;

  const items = final.slice(0, count).map(normalizePost);
  logger.info('Instagram search completed', { keyword, found: items.length, edge });
  return items;
}

async function getHashtagId(
  hashtag: string,
  accountId: string,
  token: string,
): Promise<string | null> {
  const url = `${GRAPH_API}/ig-hashtag-search` +
    `?user_id=${accountId}` +
    `&q=${encodeURIComponent(hashtag)}` +
    `&access_token=${token}`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new ExternalApiError('Instagram', `hashtag search ${res.status}: ${body}`);
  }
  const data: IgHashtagSearchResponse = await res.json();
  return data.data?.[0]?.id ?? null;
}

async function getMedia(
  hashtagId: string,
  edge: 'top_media' | 'recent_media',
  accountId: string,
  token: string,
): Promise<IgMediaItem[]> {
  const url = `${GRAPH_API}/${hashtagId}/${edge}` +
    `?user_id=${accountId}` +
    `&fields=${MEDIA_FIELDS}` +
    `&access_token=${token}`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new ExternalApiError('Instagram', `${edge} ${res.status}: ${body}`);
  }
  const data: IgMediaResponse = await res.json();
  return data.data ?? [];
}

function normalizePost(post: IgMediaItem): ContentItem {
  const caption = post.caption ?? '';
  const title = caption.split('\n')[0].slice(0, 100) || '인스타그램 게시물';
  return {
    platform: 'instagram',
    title,
    url: post.permalink,
    description: caption.slice(0, 300),
    published_at: post.timestamp,
  };
}

// "카페 추천" → "카페추천" (공백·특수문자 제거, 소문자)
function toHashtag(keyword: string): string {
  return keyword
    .replace(/\s+/g, '')
    .replace(/[#\-–—.,'":;!?@&*()\[\]{}<>/\\|]/g, '')
    .toLowerCase();
}

function periodToDate(period: Period): Date | null {
  const offsets: Record<Period, number | null> = {
    day: 1,
    week: 7,
    month: 30,
    year: 365,
  };
  const days = offsets[period];
  if (days === null) return null;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

// You.com Search API 모듈
// 회당 $0.005, 티스토리 + 브런치 + 틱톡 + 인스타 릴스 담당
// 신규 가입 시 $100 크레딧

import { env } from '../_core/env.ts';
import { ExternalApiError } from '../_core/errors.ts';
import { logger } from '../_core/logger.ts';
import type { ContentItem, Period, Platform } from '../_core/types.ts';

interface YouComWebResult {
  url: string;
  title: string;
  description?: string;
  snippets?: string[];
  thumbnail_url?: string;
  page_age?: string;
  favicon_url?: string;
}

interface YouComSearchResponse {
  results: {
    web?: YouComWebResult[];
    news?: YouComWebResult[];
  };
  metadata: {
    query: string;
    search_uuid: string;
    latency: number;
  };
}

async function searchYouCom(
  keyword: string,
  domains: string[],
  platform: Platform,
  count: number = 10,
  period: Period = 'month',
): Promise<ContentItem[]> {
  // 관련성 필터 후 count개를 채우기 위해 여유분 확보
  const fetchCount = Math.min(count * 3, 50);
  const url = `https://ydc-index.io/v1/search` +
    `?query=${encodeURIComponent(keyword)}` +
    `&count=${fetchCount}` +
    `&freshness=${period}` +
    `&country=KR` +
    `&language=KO` +
    `&include_domains=${domains.join(',')}`;

  logger.info('You.com search started', { keyword, platform, domains });

  const response = await fetch(url, {
    headers: {
      'X-API-KEY': env.youcom.apiKey,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new ExternalApiError('You.com', `${response.status} ${body}`);
  }

  const data: YouComSearchResponse = await response.json();
  const webResults = data.results?.web || [];

  // 1. 도메인/플랫폼 필터 — include_domains가 API에서 무시될 수 있으므로 클라이언트에서도 강제
  const domainFiltered = webResults
    .filter((item) => domains.some((domain) => item.url.includes(domain)))
    .filter((item) => isPlatformResult(item.url, platform));

  // 2. 키워드 관련성 점수 정렬 — 제목·설명·스니펫에 키워드 단어가 많을수록 상위
  const words = keyword.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = domainFiltered.map((item) => ({
    item,
    score: relevanceScore(item, words),
  }));
  scored.sort((a, b) => b.score - a.score);

  // 3. 관련성 0점(키워드 단어가 하나도 없음) 제거 — 단, 전부 0이면 원본 순서 그대로
  const relevant = scored.filter((s) => s.score > 0);
  const finalPool = relevant.length > 0 ? relevant : scored;

  const items = finalPool.slice(0, count).map((s) => normalizeItem(s.item, platform));

  logger.info('You.com search completed', {
    keyword,
    platform,
    fetched: webResults.length,
    afterDomainFilter: domainFiltered.length,
    afterRelevanceFilter: relevant.length,
    returned: items.length,
    latency: data.metadata?.latency,
  });

  return items;
}

// 제목·설명·스니펫에서 키워드 단어가 등장한 횟수를 반환 (제목 가중치 2배)
function relevanceScore(item: YouComWebResult, words: string[]): number {
  const title = (item.title ?? '').toLowerCase();
  const desc = (item.description ?? '').toLowerCase();
  const snippets = (item.snippets ?? []).join(' ').toLowerCase();
  let score = 0;
  for (const word of words) {
    if (title.includes(word)) score += 2;
    if (desc.includes(word)) score += 1;
    if (snippets.includes(word)) score += 1;
  }
  return score;
}

function normalizeItem(item: YouComWebResult, platform: Platform): ContentItem {
  return {
    platform,
    title: item.title,
    url: item.url,
    description: item.description || '',
    snippet: item.snippets?.[0] || undefined,
    thumbnail: item.thumbnail_url || undefined,
    published_at: item.page_age || undefined,
    author: extractAuthor(item.url, platform),
  };
}

function isPlatformResult(url: string, platform: Platform): boolean {
  if (platform === 'tiktok') return isTikTokContentUrl(url);
  if (platform === 'instagram_reels') return isInstagramReelUrl(url);
  return true;
}

function isTikTokContentUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host !== 'www.tiktok.com') return false;

    return /^\/@[^/]+\/video\/[^/?#]+/.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isInstagramReelUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host !== 'www.instagram.com') return false;

    return /^\/reel\/[^/?#]+\/?$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

function extractAuthor(url: string, platform: Platform): string | undefined {
  try {
    const parsed = new URL(url);

    if (platform === 'tistory') {
      const host = parsed.hostname; // e.g. "username.tistory.com"
      const sub = host.split('.')[0];
      return sub && sub !== 'tistory' ? sub : undefined;
    }

    if (platform === 'tiktok') {
      const match = parsed.pathname.match(/^\/@([^/]+)/);
      return match ? `@${match[1]}` : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function searchTistory(
  keyword: string,
  count: number = 10,
  period: Period = 'month',
): Promise<ContentItem[]> {
  return searchYouCom(keyword, ['tistory.com'], 'tistory', count, period);
}

export function searchBrunch(
  keyword: string,
  count: number = 10,
  period: Period = 'month',
): Promise<ContentItem[]> {
  return searchYouCom(keyword, ['brunch.co.kr'], 'brunch', count, period);
}

export function searchTikTok(
  keyword: string,
  count: number = 10,
  period: Period = 'month',
): Promise<ContentItem[]> {
  return searchYouCom(keyword, ['tiktok.com'], 'tiktok', count, period);
}

export function searchInstagramReels(
  keyword: string,
  count: number = 10,
  period: Period = 'month',
): Promise<ContentItem[]> {
  return searchYouCom(keyword, ['instagram.com'], 'instagram_reels', count, period);
}

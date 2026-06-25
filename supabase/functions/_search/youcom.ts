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
  const queries = [...new Set([buildSearchQuery(keyword, platform), keyword])];

  logger.info('You.com search started', { keyword, platform, domains });

  let webResults: YouComWebResult[] = [];
  let domainFiltered: YouComWebResult[] = [];
  let metadata: YouComSearchResponse['metadata'] | undefined;
  let usedQuery = queries[0];

  for (const [index, query] of queries.entries()) {
    const data = await requestYouComSearch(query, domains, fetchCount, period);
    const candidateWebResults = data.results?.web || [];
    const candidateFiltered = filterPlatformResults(candidateWebResults, domains, platform);

    webResults = candidateWebResults;
    domainFiltered = candidateFiltered;
    metadata = data.metadata;
    usedQuery = query;

    if (domainFiltered.length > 0 || index === queries.length - 1) break;
    logger.info('You.com platform query returned no content URLs; retrying broad query', {
      keyword,
      platform,
      query,
    });
  }

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

  const items: ContentItem[] = [];
  const seenUrls = new Set<string>();
  for (const scoredItem of finalPool) {
    const item = normalizeItem(scoredItem.item, platform);
    if (seenUrls.has(item.url)) continue;
    seenUrls.add(item.url);
    items.push(item);
    if (items.length >= count) break;
  }

  logger.info('You.com search completed', {
    keyword,
    platform,
    fetched: webResults.length,
    afterDomainFilter: domainFiltered.length,
    afterRelevanceFilter: relevant.length,
    returned: items.length,
    query: usedQuery,
    latency: metadata?.latency,
  });

  return items;
}

async function requestYouComSearch(
  query: string,
  domains: string[],
  fetchCount: number,
  period: Period,
): Promise<YouComSearchResponse> {
  const url = `https://ydc-index.io/v1/search` +
    `?query=${encodeURIComponent(query)}` +
    `&count=${fetchCount}` +
    `&freshness=${period}` +
    `&country=KR` +
    `&language=KO` +
    `&include_domains=${domains.join(',')}`;

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

  return await response.json();
}

function filterPlatformResults(
  webResults: YouComWebResult[],
  domains: string[],
  platform: Platform,
): YouComWebResult[] {
  return webResults
    .filter((item) => matchesAnyDomain(item.url, domains))
    .map((item) => normalizePlatformResult(item, platform))
    .filter((item): item is YouComWebResult => item !== null);
}

function buildSearchQuery(keyword: string, platform: Platform): string {
  if (platform === 'tiktok') return `${keyword} site:tiktok.com/@ /video/`;
  if (platform === 'instagram_reels') return `${keyword} site:instagram.com/reel/`;
  return keyword;
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

function matchesAnyDomain(url: string, domains: string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function normalizePlatformResult(item: YouComWebResult, platform: Platform): YouComWebResult | null {
  const normalizedUrl = normalizePlatformUrl(item.url, platform);
  if (!normalizedUrl) return null;
  if (normalizedUrl === item.url) return item;
  return { ...item, url: normalizedUrl };
}

function normalizePlatformUrl(url: string, platform: Platform): string | null {
  if (platform === 'tiktok') return normalizeTikTokContentUrl(url);
  if (platform === 'instagram_reels') return normalizeInstagramReelUrl(url);
  return url;
}

function normalizeTikTokContentUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (!['www.tiktok.com', 'tiktok.com', 'm.tiktok.com'].includes(host)) return null;

    const match = parsed.pathname.match(/^\/(@[^/]+)\/video\/([^/?#]+)/);
    if (!match) return null;

    return `https://www.tiktok.com/${match[1]}/video/${match[2]}`;
  } catch {
    return null;
  }
}

function normalizeInstagramReelUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (!['www.instagram.com', 'instagram.com', 'm.instagram.com'].includes(host)) return null;

    const match = parsed.pathname.match(/^\/reels?\/(?!audio\/)([^/?#]+)\/?$/);
    if (!match) return null;

    return `https://www.instagram.com/reel/${match[1]}/`;
  } catch {
    return null;
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

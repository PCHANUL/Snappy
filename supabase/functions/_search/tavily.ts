// Tavily Search API 모듈
// 모든 매체 검색을 Tavily /search로 통합한다.

import { env } from "../_core/env.ts";
import { ExternalApiError } from "../_core/errors.ts";
import { logger } from "../_core/logger.ts";
import type { ContentItem, Period, Platform } from "../_core/types.ts";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

export const TAVILY_PAYG_USD_PER_CREDIT = 0.008;

interface TavilyImage {
  url?: string;
  description?: string;
}

interface TavilySearchResult {
  title?: string;
  url?: string;
  content?: string;
  raw_content?: string | null;
  score?: number;
  favicon?: string;
  images?: Array<TavilyImage | string>;
  published_date?: string;
}

interface TavilySearchResponse {
  query?: string;
  results?: TavilySearchResult[];
  response_time?: number | string;
  usage?: { credits?: number };
  request_id?: string;
}

interface PlatformConfig {
  domains: string[];
  buildQuery: (keyword: string) => string;
  fallbackWithoutTimeRange?: boolean;
}

const PLATFORM_CONFIG: Record<Platform, PlatformConfig> = {
  naver_blog: {
    domains: ["blog.naver.com", "m.blog.naver.com"],
    buildQuery: (keyword) => `${keyword} site:blog.naver.com`,
  },
  youtube: {
    domains: ["youtube.com", "www.youtube.com", "youtu.be"],
    buildQuery: (keyword) => `${keyword} site:youtube.com/watch`,
  },
  youtube_shorts: {
    domains: ["youtube.com", "www.youtube.com"],
    buildQuery: (keyword) => `${keyword} site:youtube.com/shorts`,
  },
  tistory: {
    domains: ["tistory.com"],
    buildQuery: (keyword) => `${keyword} site:tistory.com`,
  },
  brunch: {
    domains: ["brunch.co.kr"],
    buildQuery: (keyword) => `${keyword} site:brunch.co.kr`,
  },
  tiktok: {
    domains: ["tiktok.com", "www.tiktok.com", "m.tiktok.com"],
    buildQuery: (keyword) => `${keyword} site:tiktok.com/@ /video/`,
    fallbackWithoutTimeRange: true,
  },
  instagram_reels: {
    domains: ["instagram.com", "www.instagram.com", "m.instagram.com"],
    buildQuery: (keyword) => `${keyword} site:instagram.com/reel/`,
    fallbackWithoutTimeRange: true,
  },
};

interface SearchAttempt {
  query: string;
  timeRange?: Period;
}

export async function searchTavilyPlatform(
  platform: Platform,
  keyword: string,
  count: number = 10,
  period: Period = "month",
): Promise<ContentItem[]> {
  const config = PLATFORM_CONFIG[platform];
  const fetchCount = Math.min(Math.max(count * 2, count), 20);
  const queries = [...new Set([config.buildQuery(keyword), keyword])];
  const attempts = buildSearchAttempts(queries, period, config);

  logger.info("Tavily search started", { keyword, platform, count, period });

  let rawResults: TavilySearchResult[] = [];
  let domainFiltered: TavilySearchResult[] = [];
  let responseTime: number | string | undefined;
  let credits: number | undefined;
  let usedQuery = queries[0];

  for (const [index, attempt] of attempts.entries()) {
    const data = await requestTavilySearch(
      attempt.query,
      config.domains,
      fetchCount,
      attempt.timeRange,
    );
    const candidateResults = data.results ?? [];
    const candidateFiltered = filterPlatformResults(
      candidateResults,
      config.domains,
      platform,
    );

    rawResults = candidateResults;
    domainFiltered = candidateFiltered;
    responseTime = data.response_time;
    credits = data.usage?.credits;
    usedQuery = attempt.query;

    if (domainFiltered.length > 0 || index === attempts.length - 1) break;
    logger.info("Tavily search attempt returned no content URLs; retrying", {
      keyword,
      platform,
      query: attempt.query,
      timeRange: attempt.timeRange,
      nextWithoutTimeRange: attempts[index + 1]?.timeRange === undefined,
    });
  }

  const words = keyword.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = domainFiltered.map((item) => ({
    item,
    score: relevanceScore(item, words),
  }));
  scored.sort((a, b) => b.score - a.score);

  const relevant = scored.filter((s) => s.score > 0);
  const finalPool = relevant.length > 0 ? relevant : scored;

  const items: ContentItem[] = [];
  const seenUrls = new Set<string>();
  for (const scoredItem of finalPool) {
    const item = normalizeItem(scoredItem.item, platform);
    if (!item || seenUrls.has(item.url)) continue;
    seenUrls.add(item.url);
    items.push(item);
    if (items.length >= count) break;
  }

  logger.info("Tavily search completed", {
    keyword,
    platform,
    fetched: rawResults.length,
    afterDomainFilter: domainFiltered.length,
    afterRelevanceFilter: relevant.length,
    returned: items.length,
    query: usedQuery,
    responseTime,
    credits,
  });

  return items;
}

export function searchNaverBlogWithTavily(
  keyword: string,
  count: number = 10,
  period: Period = "month",
): Promise<ContentItem[]> {
  return searchTavilyPlatform("naver_blog", keyword, count, period);
}

export function searchYouTubeWithTavily(
  keyword: string,
  count: number = 10,
  period: Period = "month",
): Promise<ContentItem[]> {
  return searchTavilyPlatform("youtube", keyword, count, period);
}

export function searchYouTubeShortsWithTavily(
  keyword: string,
  count: number = 10,
  period: Period = "month",
): Promise<ContentItem[]> {
  return searchTavilyPlatform("youtube_shorts", keyword, count, period);
}

export function searchTistoryWithTavily(
  keyword: string,
  count: number = 10,
  period: Period = "month",
): Promise<ContentItem[]> {
  return searchTavilyPlatform("tistory", keyword, count, period);
}

export function searchBrunchWithTavily(
  keyword: string,
  count: number = 10,
  period: Period = "month",
): Promise<ContentItem[]> {
  return searchTavilyPlatform("brunch", keyword, count, period);
}

export function searchTikTokWithTavily(
  keyword: string,
  count: number = 10,
  period: Period = "month",
): Promise<ContentItem[]> {
  return searchTavilyPlatform("tiktok", keyword, count, period);
}

export function searchInstagramReelsWithTavily(
  keyword: string,
  count: number = 10,
  period: Period = "month",
): Promise<ContentItem[]> {
  return searchTavilyPlatform("instagram_reels", keyword, count, period);
}

async function requestTavilySearch(
  query: string,
  domains: string[],
  maxResults: number,
  timeRange?: Period,
): Promise<TavilySearchResponse> {
  const body: Record<string, unknown> = {
    query,
    search_depth: "basic",
    topic: "general",
    max_results: maxResults,
    include_domains: domains,
    include_answer: false,
    include_raw_content: false,
    include_images: true,
    include_favicon: true,
    include_usage: true,
    country: "south korea",
  };
  if (timeRange) body.time_range = timeRange;

  const response = await fetch(TAVILY_SEARCH_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.tavily.apiKey}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new ExternalApiError("Tavily", `${response.status} ${responseBody}`);
  }

  return await response.json();
}

function buildSearchAttempts(
  queries: string[],
  period: Period,
  config: PlatformConfig,
): SearchAttempt[] {
  const attempts: SearchAttempt[] = queries.map((query) => ({
    query,
    timeRange: period,
  }));

  if (config.fallbackWithoutTimeRange) {
    attempts.push(...queries.map((query) => ({ query })));
  }

  return attempts;
}

function filterPlatformResults(
  results: TavilySearchResult[],
  domains: string[],
  platform: Platform,
): TavilySearchResult[] {
  return results
    .filter((item) => item.url && matchesAnyDomain(item.url, domains))
    .map((item) => normalizePlatformResult(item, platform))
    .filter((item): item is TavilySearchResult => item !== null);
}

function relevanceScore(item: TavilySearchResult, words: string[]): number {
  const title = cleanText(item.title ?? "").toLowerCase();
  const content = cleanText(item.content ?? "").toLowerCase();
  let score = 0;
  for (const word of words) {
    if (title.includes(word)) score += 2;
    if (content.includes(word)) score += 1;
  }
  return score;
}

function normalizeItem(
  item: TavilySearchResult,
  platform: Platform,
): ContentItem | null {
  const normalizedUrl = normalizePlatformUrl(item.url ?? "", platform);
  if (!normalizedUrl) return null;

  return {
    platform,
    title: cleanText(item.title ?? normalizedUrl),
    url: normalizedUrl,
    description: cleanText(item.content ?? ""),
    snippet: cleanText(item.content ?? "") || undefined,
    thumbnail: extractImageUrl(item.images) || item.favicon || undefined,
    published_at: item.published_date || undefined,
    author: extractAuthor(normalizedUrl, platform),
  };
}

function extractImageUrl(images?: Array<TavilyImage | string>): string | undefined {
  if (!images) return undefined;
  for (const image of images) {
    if (typeof image === "string" && image) return image;
    if (typeof image === "object" && image.url) return image.url;
  }
  return undefined;
}

function normalizePlatformResult(
  item: TavilySearchResult,
  platform: Platform,
): TavilySearchResult | null {
  const normalizedUrl = normalizePlatformUrl(item.url ?? "", platform);
  if (!normalizedUrl) return null;
  if (normalizedUrl === item.url) return item;
  return { ...item, url: normalizedUrl };
}

function normalizePlatformUrl(url: string, platform: Platform): string | null {
  if (!url) return null;
  if (platform === "youtube" || platform === "youtube_shorts") {
    return normalizeYouTubeUrl(url, platform);
  }
  if (platform === "tiktok") return normalizeTikTokContentUrl(url);
  if (platform === "instagram_reels") return normalizeInstagramReelUrl(url);
  if (platform === "naver_blog") return normalizeNaverBlogUrl(url);
  if (platform === "tistory") return normalizeDomainUrl(url, ["tistory.com"]);
  if (platform === "brunch") return normalizeDomainUrl(url, ["brunch.co.kr"]);
  return url;
}

function normalizeYouTubeUrl(url: string, platform: Platform): string | null {
  const video = extractYouTubeVideo(url);
  if (!video) return null;

  if (platform === "youtube_shorts") {
    if (!video.isShorts) return null;
    return `https://www.youtube.com/shorts/${video.id}`;
  }

  if (video.isShorts) return null;
  return `https://www.youtube.com/watch?v=${video.id}`;
}

function extractYouTubeVideo(
  url: string,
): { id: string; isShorts: boolean } | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "youtu.be") {
      const id = parsed.pathname.split("/").filter(Boolean)[0];
      return id ? { id, isShorts: false } : null;
    }
    if (!["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host)) {
      return null;
    }

    const shortsMatch = parsed.pathname.match(/^\/shorts\/([^/?#]+)/);
    if (shortsMatch) return { id: shortsMatch[1], isShorts: true };

    const embedMatch = parsed.pathname.match(/^\/embed\/([^/?#]+)/);
    if (embedMatch) return { id: embedMatch[1], isShorts: false };

    if (parsed.pathname === "/watch") {
      const id = parsed.searchParams.get("v");
      return id ? { id, isShorts: false } : null;
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeTikTokContentUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (!["www.tiktok.com", "tiktok.com", "m.tiktok.com"].includes(host)) {
      return null;
    }

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
    if (
      !["www.instagram.com", "instagram.com", "m.instagram.com"].includes(host)
    ) return null;

    const match = parsed.pathname.match(/^\/reels?\/(?!audio\/)([^/?#]+)\/?$/);
    if (!match) return null;

    return `https://www.instagram.com/reel/${match[1]}/`;
  } catch {
    return null;
  }
}

function normalizeNaverBlogUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.toLowerCase().endsWith("blog.naver.com")) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeDomainUrl(url: string, domains: string[]): string | null {
  try {
    const parsed = new URL(url);
    return matchesAnyDomain(parsed.toString(), domains) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function matchesAnyDomain(url: string, domains: string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return domains.some((domain) => {
      const normalized = domain.toLowerCase();
      return host === normalized || host.endsWith(`.${normalized}`);
    });
  } catch {
    return false;
  }
}

function extractAuthor(url: string, platform: Platform): string | undefined {
  try {
    const parsed = new URL(url);

    if (platform === "tistory") {
      const host = parsed.hostname;
      const sub = host.split(".")[0];
      return sub && sub !== "tistory" ? sub : undefined;
    }

    if (platform === "tiktok") {
      const match = parsed.pathname.match(/^\/@([^/]+)/);
      return match ? `@${match[1]}` : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function cleanText(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

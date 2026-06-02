// YouTube Data API v3 검색 모듈
// 무료, 일 10,000 units (검색 1회 = 100 units → 일 100회 가능)

import { env } from '../_core/env.ts';
import { ExternalApiError } from '../_core/errors.ts';
import { logger } from '../_core/logger.ts';
import type { ContentItem, Period } from '../_core/types.ts';

interface YouTubeSearchItem {
  id: { videoId: string };
  snippet: {
    title: string;
    description: string;
    channelTitle: string;
    publishedAt: string;
    thumbnails: {
      default?: { url: string };
      medium?: { url: string };
      high?: { url: string };
    };
  };
}

interface YouTubeSearchResponse {
  items: YouTubeSearchItem[];
  pageInfo: { totalResults: number; resultsPerPage: number };
}

export async function searchYouTube(
  keyword: string,
  count: number = 10,
  period: Period = 'month',
): Promise<ContentItem[]> {
  const publishedAfter = getPublishedAfter(period);

  const url = `https://www.googleapis.com/youtube/v3/search` +
    `?part=snippet` +
    `&q=${encodeURIComponent(keyword)}` +
    `&type=video` +
    `&maxResults=${count}` +
    `&regionCode=KR` +
    `&relevanceLanguage=ko` +
    `&publishedAfter=${publishedAfter}` +
    `&order=relevance` +
    `&key=${env.youtube.apiKey}`;

  logger.info('YouTube search started', { keyword, count, period });

  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.text();
    throw new ExternalApiError('YouTube', `${response.status} ${body}`);
  }

  const data: YouTubeSearchResponse = await response.json();

  const items = (data.items ?? []).map(normalizeItem);

  logger.info('YouTube search completed', { keyword, found: items.length });
  return items;
}

function normalizeItem(item: YouTubeSearchItem): ContentItem {
  const thumbnails = item.snippet.thumbnails;
  return {
    platform: 'youtube',
    title: item.snippet.title,
    url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
    description: item.snippet.description,
    author: item.snippet.channelTitle,
    thumbnail: thumbnails.high?.url || thumbnails.medium?.url || thumbnails.default?.url,
    published_at: item.snippet.publishedAt,
  };
}

// 기간을 ISO 8601 datetime으로 변환
export function getPublishedAfter(period: Period): string {
  const offsets: Record<Period, number> = {
    day: 1,
    week: 7,
    month: 30,
    year: 365,
  };

  const date = new Date();
  date.setDate(date.getDate() - offsets[period]);
  return date.toISOString();
}

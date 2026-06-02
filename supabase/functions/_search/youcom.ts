// You.com Search API 모듈
// 회당 $0.005, 티스토리 + 브런치 담당
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
  const url = `https://ydc-index.io/v1/search` +
    `?query=${encodeURIComponent(keyword)}` +
    `&count=${count}` +
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

  // include_domains 파라미터가 API에서 무시될 수 있으므로 클라이언트 측에서도 필터링
  const filtered = webResults.filter((item) =>
    domains.some((domain) => item.url.includes(domain))
  );

  const items = filtered.slice(0, count).map((item) => normalizeItem(item, platform));

  logger.info('You.com search completed', {
    keyword,
    platform,
    found: items.length,
    latency: data.metadata?.latency,
  });

  return items;
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
    author: extractTistoryAuthor(item.url, platform),
  };
}

function extractTistoryAuthor(url: string, platform: Platform): string | undefined {
  if (platform !== 'tistory') return undefined;
  try {
    const host = new URL(url).hostname; // e.g. "username.tistory.com"
    const sub = host.split('.')[0];
    return sub && sub !== 'tistory' ? sub : undefined;
  } catch {
    return undefined;
  }
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

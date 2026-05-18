// 네이버 검색 API 모듈
// 무료, 일 25,000회 한도

import { env } from '../_shared/env.ts';
import { ExternalApiError } from '../_shared/errors.ts';
import { logger } from '../_shared/logger.ts';
import type { ContentItem, Period } from '../_shared/types.ts';

interface NaverBlogItem {
  title: string;
  link: string;
  description: string;
  bloggername: string;
  bloggerlink: string;
  postdate: string; // YYYYMMDD
}

interface NaverBlogResponse {
  items: NaverBlogItem[];
  total: number;
  start: number;
  display: number;
}

export async function searchNaverBlog(
  keyword: string,
  count: number = 10,
  period?: Period,
): Promise<ContentItem[]> {
  const display = Math.min(count * 2, 30); // 기간 필터 고려해서 여유있게
  const url = `https://openapi.naver.com/v1/search/blog.json` +
    `?query=${encodeURIComponent(keyword)}` +
    `&display=${display}` +
    `&sort=sim`;

  logger.info('Naver search started', { keyword, count, period });

  const response = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': env.naver.clientId,
      'X-Naver-Client-Secret': env.naver.clientSecret,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new ExternalApiError('Naver', `${response.status} ${body}`);
  }

  const data: NaverBlogResponse = await response.json();

  const items = data.items
    .map(normalizeItem)
    .filter((item) => filterByPeriod(item, period))
    .slice(0, count);

  logger.info('Naver search completed', { keyword, found: items.length });
  return items;
}

function normalizeItem(item: NaverBlogItem): ContentItem {
  return {
    platform: 'naver_blog',
    title: stripHtml(item.title),
    url: item.link,
    description: stripHtml(item.description),
    author: item.bloggername,
    published_at: parseNaverDate(item.postdate),
  };
}

// 네이버 응답에 포함된 <b> 등 HTML 태그 제거
function stripHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// "20240315" → "2024-03-15"
function parseNaverDate(yyyymmdd: string): string {
  if (!yyyymmdd || yyyymmdd.length !== 8) return '';
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

// 네이버 API는 기간 필터가 없어서 클라이언트에서 필터링
function filterByPeriod(item: ContentItem, period?: Period): boolean {
  if (!period || !item.published_at) return true;

  const itemDate = new Date(item.published_at);
  if (isNaN(itemDate.getTime())) return true;

  const now = new Date();
  const diffDays = (now.getTime() - itemDate.getTime()) / (1000 * 60 * 60 * 24);

  const limits: Record<Period, number> = {
    day: 1,
    week: 7,
    month: 30,
    year: 365,
  };

  return diffDays <= limits[period];
}

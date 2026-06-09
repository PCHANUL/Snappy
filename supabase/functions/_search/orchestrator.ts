// 매체별 검색을 병렬 실행하는 오케스트레이터
// 한 매체 실패해도 다른 매체 결과는 정상 반환

import { logger } from '../_core/logger.ts';
import { searchNaverBlog } from './naver.ts';
import { searchYouTube } from './youtube.ts';
import { searchTistory, searchBrunch } from './youcom.ts';
import type { Platform, Period, SearchResult, ContentItem } from '../_core/types.ts';

// 플랫폼별 검색 함수 매핑
type SearcherFn = (keyword: string, count: number, period: Period) => Promise<ContentItem[]>;

const searchers: Record<Platform, SearcherFn> = {
  naver_blog: searchNaverBlog,
  youtube: searchYouTube,
  tistory: searchTistory,
  brunch: searchBrunch,
};

const PLATFORM_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// 플랫폼별 비용 (USD)
const COST_PER_SEARCH: Record<Platform, number> = {
  naver_blog: 0,
  youtube: 0,
  tistory: 0.005,
  brunch: 0.005,
};

export interface OrchestratorResult {
  results: SearchResult[];
  total_cost_usd: number;
  duration_ms: number;
}

export async function searchAllPlatforms(
  keyword: string,
  platforms: Platform[],
  count: number,
  period: Period,
): Promise<OrchestratorResult> {
  const startTime = Date.now();
  logger.info('Orchestrator started', { keyword, platforms, count, period });

  const tasks = platforms.map(async (platform): Promise<SearchResult> => {
    try {
      const items = await withTimeout(
        searchers[platform](keyword, count, period),
        PLATFORM_TIMEOUT_MS,
        platform,
      );
      return {
        platform,
        items,
        count: items.length,
      };
    } catch (error) {
      logger.error('Platform search failed', error, { platform, keyword });
      return {
        platform,
        items: [],
        count: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  const results = deduplicateResults(await Promise.all(tasks));

  const total_cost_usd = platforms.reduce(
    (sum, p) => sum + COST_PER_SEARCH[p],
    0,
  );

  const duration_ms = Date.now() - startTime;

  logger.info('Orchestrator completed', {
    keyword,
    duration_ms,
    total_cost_usd,
    found: results.reduce((sum, r) => sum + r.count, 0),
  });

  return {
    results,
    total_cost_usd,
    duration_ms,
  };
}

// 플랫폼 간 동일 URL 중복 제거 (naver_blog ↔ tistory 등)
export function deduplicateResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.map(result => {
    const unique = result.items.filter(item => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
    return { ...result, items: unique, count: unique.length };
  });
}

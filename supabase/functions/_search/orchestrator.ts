// 매체별 검색을 병렬 실행하는 오케스트레이터
// 한 매체 실패해도 다른 매체 결과는 정상 반환

import { logger } from "../_core/logger.ts";
import { ExternalApiError } from "../_core/errors.ts";
import {
  searchBrunchWithTavily,
  searchInstagramReelsWithTavily,
  searchNaverBlogWithTavily,
  searchTikTokWithTavily,
  searchTistoryWithTavily,
  searchYouTubeShortsWithTavily,
  searchYouTubeWithTavily,
  TAVILY_PAYG_USD_PER_CREDIT,
} from "./tavily.ts";
import type {
  ContentItem,
  Period,
  Platform,
  SearchResult,
} from "../_core/types.ts";

interface SearchControl {
  throwIfCancelled?: () => Promise<void>;
}

// 플랫폼별 검색 함수 매핑
type SearcherFn = (
  keyword: string,
  count: number,
  period: Period,
  options?: { signal?: AbortSignal; throwIfCancelled?: () => Promise<void> },
) => Promise<ContentItem[]>;

const searchers: Record<Platform, SearcherFn> = {
  naver_blog: searchNaverBlogWithTavily,
  youtube: searchYouTubeWithTavily,
  youtube_shorts: searchYouTubeShortsWithTavily,
  tistory: searchTistoryWithTavily,
  brunch: searchBrunchWithTavily,
  tiktok: searchTikTokWithTavily,
  instagram_reels: searchInstagramReelsWithTavily,
};

const PLATFORM_TIMEOUT_MS = 25_000;
const PLATFORM_ATTEMPTS = 2;
const PLATFORM_RETRY_DELAY_MS = 700;

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  abort?: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abort?.();
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Tavily basic search = 1 credit. USD는 pay-as-you-go 기준 추정치다.
const COST_PER_SEARCH: Record<Platform, number> = {
  naver_blog: TAVILY_PAYG_USD_PER_CREDIT,
  youtube: TAVILY_PAYG_USD_PER_CREDIT,
  youtube_shorts: TAVILY_PAYG_USD_PER_CREDIT,
  tistory: TAVILY_PAYG_USD_PER_CREDIT,
  brunch: TAVILY_PAYG_USD_PER_CREDIT,
  tiktok: TAVILY_PAYG_USD_PER_CREDIT,
  instagram_reels: TAVILY_PAYG_USD_PER_CREDIT,
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
  control: SearchControl = {},
): Promise<OrchestratorResult> {
  const startTime = Date.now();
  logger.info("Orchestrator started", { keyword, platforms, count, period });

  const tasks = platforms.map(async (platform): Promise<SearchResult> => {
    let lastError: unknown;

    for (let attempt = 1; attempt <= PLATFORM_ATTEMPTS; attempt++) {
      try {
        await control.throwIfCancelled?.();
        const items = await runPlatformSearch(
          platform,
          keyword,
          count,
          period,
          PLATFORM_TIMEOUT_MS,
          control,
        );
        await control.throwIfCancelled?.();
        return {
          platform,
          items,
          count: items.length,
        };
      } catch (error) {
        lastError = error;
        if (error instanceof Error && error.name === "SearchCancelledError") {
          throw error;
        }
        logger.warn("Platform search attempt failed", {
          platform,
          keyword,
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
        if (attempt < PLATFORM_ATTEMPTS) {
          await sleep(PLATFORM_RETRY_DELAY_MS);
          await control.throwIfCancelled?.();
        }
      }
    }

    logger.error("Platform search failed", lastError, { platform, keyword });
    return {
      platform,
      items: [],
      count: 0,
      error: lastError instanceof Error ? lastError.message : "Unknown error",
    };
  });

  const results = deduplicateResults(await Promise.all(tasks));
  const found = results.reduce((sum, r) => sum + r.count, 0);

  if (found === 0 && results.length > 0 && results.every((r) => r.error)) {
    throw new ExternalApiError("Search", "all selected platforms failed");
  }

  const total_cost_usd = platforms.reduce(
    (sum, p) => sum + COST_PER_SEARCH[p],
    0,
  );

  const duration_ms = Date.now() - startTime;

  logger.info("Orchestrator completed", {
    keyword,
    duration_ms,
    total_cost_usd,
    found,
  });

  return {
    results,
    total_cost_usd,
    duration_ms,
  };
}

async function runPlatformSearch(
  platform: Platform,
  keyword: string,
  count: number,
  period: Period,
  timeoutMs: number,
  control: SearchControl,
): Promise<ContentItem[]> {
  const controller = new AbortController();
  let settled = false;

  const cancellation = (async () => {
    while (!settled) {
      await sleep(300);
      await control.throwIfCancelled?.();
    }
    return new Promise<never>(() => {});
  })();

  try {
    return await withTimeout(
      Promise.race([
        searchers[platform](keyword, count, period, {
          signal: controller.signal,
          throwIfCancelled: control.throwIfCancelled,
        }),
        cancellation,
      ]),
      timeoutMs,
      platform,
      () => controller.abort(),
    );
  } finally {
    settled = true;
    controller.abort();
  }
}

// 플랫폼 간 동일 URL 중복 제거 (naver_blog ↔ tistory 등)
export function deduplicateResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.map((result) => {
    const unique = result.items.filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
    return { ...result, items: unique, count: unique.length };
  });
}

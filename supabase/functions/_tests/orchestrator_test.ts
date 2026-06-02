import './setup.ts';
import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { deduplicateResults, searchAllPlatforms } from '../_search/orchestrator.ts';
import type { SearchResult } from '../_core/types.ts';

function makeResult(platform: string, urls: string[]): SearchResult {
  return {
    platform: platform as any,
    items: urls.map((url) => ({
      platform: platform as any,
      title: `Title ${url}`,
      url,
      description: 'desc',
    })),
    count: urls.length,
  };
}

Deno.test('deduplicateResults: 중복 URL 제거', () => {
  const results = [
    makeResult('naver_blog', ['https://a.com', 'https://b.com']),
    makeResult('tistory',    ['https://b.com', 'https://c.com']), // b.com 중복
  ];
  const deduped = deduplicateResults(results);
  assertEquals(deduped[0].count, 2); // naver: a, b
  assertEquals(deduped[1].count, 1); // tistory: c만 남음 (b 제거)
  assertEquals(deduped[1].items[0].url, 'https://c.com');
});

Deno.test('deduplicateResults: 중복 없으면 변경 없음', () => {
  const results = [
    makeResult('naver_blog', ['https://a.com', 'https://b.com']),
    makeResult('youtube',    ['https://c.com', 'https://d.com']),
  ];
  const deduped = deduplicateResults(results);
  assertEquals(deduped[0].count, 2);
  assertEquals(deduped[1].count, 2);
});

Deno.test('deduplicateResults: 빈 결과 처리', () => {
  const results = [
    makeResult('naver_blog', []),
    makeResult('youtube',    ['https://a.com']),
  ];
  const deduped = deduplicateResults(results);
  assertEquals(deduped[0].count, 0);
  assertEquals(deduped[1].count, 1);
});

Deno.test('deduplicateResults: 3개 플랫폼 전체 중복 시나리오', () => {
  const results = [
    makeResult('naver_blog', ['https://a.com']),
    makeResult('tistory',    ['https://a.com']),
    makeResult('brunch',     ['https://a.com']),
  ];
  const deduped = deduplicateResults(results);
  assertEquals(deduped[0].count, 1); // naver: a
  assertEquals(deduped[1].count, 0); // tistory: 제거
  assertEquals(deduped[2].count, 0); // brunch: 제거
});

// ── searchAllPlatforms ────────────────────────────────────────────────────────

function makeFetchMock(handlers: Array<{ match: string; response: unknown; status?: number }>) {
  return async (url: string | URL | Request): Promise<Response> => {
    const urlStr = url.toString();
    for (const h of handlers) {
      if (urlStr.includes(h.match)) {
        return new Response(JSON.stringify(h.response), { status: h.status ?? 200 });
      }
    }
    return new Response('not found', { status: 404 });
  };
}

const naverItem = {
  title: 'Naver 글',
  link: 'https://blog.naver.com/post/1',
  description: '내용',
  bloggername: 'blogger',
  bloggerlink: '',
  postdate: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
};

const ytItem = {
  id: { videoId: 'vid1' },
  snippet: {
    title: 'YT 영상',
    description: '',
    channelTitle: 'ch',
    publishedAt: new Date().toISOString(),
    thumbnails: { high: { url: 'https://img.youtube.com/vi/vid1/hqdefault.jpg' } },
  },
};

Deno.test('searchAllPlatforms: 모든 플랫폼 성공', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeFetchMock([
    { match: 'openapi.naver.com',    response: { items: [naverItem], total: 1, start: 1, display: 1 } },
    { match: 'googleapis.com',       response: { items: [ytItem], pageInfo: {} } },
    { match: 'tistory.com',          response: { results: { web: [{ url: 'https://post.tistory.com/1', title: 'T', description: '', snippets: [] }] }, metadata: {} } },
    { match: 'brunch.co.kr',         response: { results: { web: [{ url: 'https://brunch.co.kr/@u/1',  title: 'B', description: '', snippets: [] }] }, metadata: {} } },
    { match: 'ydc-index.io',         response: { results: { web: [] }, metadata: {} } },
  ]) as typeof globalThis.fetch;
  try {
    const result = await searchAllPlatforms('test', ['naver_blog', 'youtube', 'tistory', 'brunch'], 10, 'month');
    assertEquals(result.results.length, 4);
    assertEquals(result.results.find(r => r.platform === 'naver_blog')?.count, 1);
    assertEquals(result.results.find(r => r.platform === 'youtube')?.count, 1);
    assert(result.duration_ms >= 0, 'duration_ms가 설정되어야 함');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('searchAllPlatforms: 한 플랫폼 실패 → 나머지 정상 반환', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeFetchMock([
    { match: 'openapi.naver.com', response: { error: 'fail' }, status: 500 }, // Naver 실패
    { match: 'googleapis.com',    response: { items: [ytItem], pageInfo: {} } },
  ]) as typeof globalThis.fetch;
  try {
    const result = await searchAllPlatforms('test', ['naver_blog', 'youtube'], 10, 'month');
    assertEquals(result.results.length, 2);
    const naver = result.results.find(r => r.platform === 'naver_blog')!;
    const youtube = result.results.find(r => r.platform === 'youtube')!;
    assertEquals(naver.count, 0);
    assert(naver.error !== undefined, 'naver error가 설정되어야 함');
    assertEquals(youtube.count, 1);
    assertEquals(youtube.error, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('searchAllPlatforms: 비용 계산 (tistory+brunch = $0.010)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ results: { web: [] }, metadata: {} }), { status: 200 });
  try {
    const result = await searchAllPlatforms('test', ['tistory', 'brunch'], 5, 'month');
    // tistory($0.005) + brunch($0.005) = $0.010
    assertEquals(result.total_cost_usd, 0.010);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('searchAllPlatforms: naver+youtube 비용 = $0 (무료 API)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeFetchMock([
    { match: 'openapi.naver.com', response: { items: [], total: 0, start: 1, display: 0 } },
    { match: 'googleapis.com',    response: { items: [], pageInfo: {} } },
  ]) as typeof globalThis.fetch;
  try {
    const result = await searchAllPlatforms('test', ['naver_blog', 'youtube'], 5, 'month');
    assertEquals(result.total_cost_usd, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

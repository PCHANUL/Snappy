import './setup.ts';
import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { deduplicateResults } from '../search/orchestrator.ts';
import type { SearchResult } from '../_shared/types.ts';

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

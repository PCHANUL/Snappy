import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { classifyGap } from '../_geo/gap.ts';
import type { Citation } from '../_geo/types.ts';

function cite(url: string, rank: number, rootDomain: string): Citation {
  return { url, rank, rootDomain };
}

Deno.test('classifyGap: both / seo_only / geo_only 분류', () => {
  const seo = [
    { url: 'https://blog.naver.com/a/1', rank: 1 },   // naver.com
    { url: 'https://onlyseo.com/x', rank: 2 },         // onlyseo.com
  ];
  const geo = [
    cite('https://m.blog.naver.com/b/2', 1, 'naver.com'), // both
    cite('https://onlygeo.com/y', 2, 'onlygeo.com'),      // geo_only
  ];

  const gaps = classifyGap(seo, geo);
  const byDomain = Object.fromEntries(gaps.map((g) => [g.rootDomain, g.bucket]));

  assertEquals(byDomain['naver.com'], 'both');
  assertEquals(byDomain['onlyseo.com'], 'seo_only');
  assertEquals(byDomain['onlygeo.com'], 'geo_only');
});

Deno.test('classifyGap: 최상위 순위 집계 (도메인당 최소 rank)', () => {
  const seo = [
    { url: 'https://blog.naver.com/a/3', rank: 3 },
    { url: 'https://blog.naver.com/a/1', rank: 1 },
  ];
  const gaps = classifyGap(seo, []);
  assertEquals(gaps[0].rootDomain, 'naver.com');
  assertEquals(gaps[0].seoRank, 1);
});

Deno.test('classifyGap: 자기 도메인 isSelf 표시 + 최상단 정렬', () => {
  const seo = [
    { url: 'https://other.com/x', rank: 1 },
    { url: 'https://mybrand.co.kr/post', rank: 5 },
  ];
  const geo = [cite('https://other.com/y', 1, 'other.com')];

  const gaps = classifyGap(seo, geo, 'mybrand.co.kr');
  // 자기 도메인이 seo_only여도 맨 앞으로
  assertEquals(gaps[0].rootDomain, 'mybrand.co.kr');
  assertEquals(gaps[0].isSelf, true);
  assertEquals(gaps[0].bucket, 'seo_only');
});

Deno.test('classifyGap: GEO 인용만 있는 경우', () => {
  const geo = [cite('https://ai-fav.com/z', 1, 'ai-fav.com')];
  const gaps = classifyGap([], geo);
  assertEquals(gaps.length, 1);
  assertEquals(gaps[0].bucket, 'geo_only');
  assertEquals(gaps[0].geoRank, 1);
});

Deno.test('classifyGap: 빈 입력 → 빈 배열', () => {
  assertEquals(classifyGap([], []), []);
});

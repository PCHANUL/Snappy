import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  jaccard,
  rbo,
  domainSet,
  domainRanking,
  computeNoiseFloor,
} from '../_geo/variability.ts';
import type { Citation } from '../_geo/types.ts';

function cite(rootDomain: string, rank: number): Citation {
  return { url: `https://${rootDomain}/p${rank}`, rootDomain, rank };
}

Deno.test('jaccard: 완전 일치 = 1', () => {
  assertEquals(jaccard(new Set(['a', 'b']), new Set(['a', 'b'])), 1);
});

Deno.test('jaccard: 완전 불일치 = 0', () => {
  assertEquals(jaccard(new Set(['a']), new Set(['b'])), 0);
});

Deno.test('jaccard: 부분 겹침', () => {
  // {a,b,c} ∩ {b,c,d} = {b,c}=2, 합집합 {a,b,c,d}=4 → 0.5
  assertEquals(jaccard(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd'])), 0.5);
});

Deno.test('jaccard: 둘 다 빈 집합 = 1', () => {
  assertEquals(jaccard(new Set(), new Set()), 1);
});

Deno.test('rbo: 동일 순위 = 1', () => {
  assertEquals(rbo(['a', 'b', 'c'], ['a', 'b', 'c']), 1);
});

Deno.test('rbo: 완전 불일치 = 낮음', () => {
  const r = rbo(['a', 'b', 'c'], ['x', 'y', 'z']);
  assertEquals(r, 0);
});

Deno.test('rbo: 한쪽만 비면 0', () => {
  assertEquals(rbo([], ['a']), 0);
});

Deno.test('rbo: 둘 다 비면 1', () => {
  assertEquals(rbo([], []), 1);
});

Deno.test('rbo: 상위 일치가 하위 일치보다 높은 점수', () => {
  // 상위 2개 일치
  const topMatch = rbo(['a', 'b', 'x'], ['a', 'b', 'y']);
  // 하위 위주 (순서 뒤집힘)
  const lowMatch = rbo(['x', 'a', 'b'], ['y', 'a', 'b']);
  assert(topMatch > lowMatch, `상위 일치(${topMatch})가 하위(${lowMatch})보다 높아야`);
});

Deno.test('domainSet: 중복 제거', () => {
  const set = domainSet([cite('a.com', 1), cite('a.com', 2), cite('b.com', 3)]);
  assertEquals(set.size, 2);
  assert(set.has('a.com'));
  assert(set.has('b.com'));
});

Deno.test('domainRanking: rank 순서 보존 + 첫 등장만', () => {
  const ranking = domainRanking([cite('b.com', 2), cite('a.com', 1), cite('a.com', 3)]);
  assertEquals(ranking, ['a.com', 'b.com']);
});

Deno.test('computeNoiseFloor: 모두 동일 → 안정성 1, 코어 도메인 전부', () => {
  const runs = [
    { citations: [cite('a.com', 1), cite('b.com', 2)] },
    { citations: [cite('a.com', 1), cite('b.com', 2)] },
    { citations: [cite('a.com', 1), cite('b.com', 2)] },
  ];
  const floor = computeNoiseFloor(runs);
  assertEquals(floor.runs, 3);
  assertEquals(floor.avgJaccard, 1);
  assertEquals(floor.avgRbo, 1);
  assertEquals(floor.stableDomains.sort(), ['a.com', 'b.com']);
  assertEquals(floor.volatileDomains, []);
});

Deno.test('computeNoiseFloor: 코어/노이즈 분류', () => {
  const runs = [
    { citations: [cite('core.com', 1), cite('x.com', 2)] },
    { citations: [cite('core.com', 1), cite('y.com', 2)] },
    { citations: [cite('core.com', 1), cite('z.com', 2)] },
  ];
  const floor = computeNoiseFloor(runs);
  assertEquals(floor.stableDomains, ['core.com']);    // 3/3 등장
  assertEquals(floor.volatileDomains.sort(), ['x.com', 'y.com', 'z.com']);
  assertEquals(floor.domainFrequency['core.com'], 1);
  assert(floor.domainFrequency['x.com'] < 0.5);
  assert(floor.avgJaccard < 1, '변동이 있으면 Jaccard < 1');
});

Deno.test('computeNoiseFloor: 빈 입력', () => {
  const floor = computeNoiseFloor([]);
  assertEquals(floor.runs, 0);
  assertEquals(floor.stableDomains, []);
});

// 노이즈 바닥·변동성 측정 (기획서 7-5, 7-6)
//
// AI 인용은 같은 질문에도 호출마다 달라진다. 그래서 "변했다"를 말하려면
// 먼저 "가만히 둬도 이만큼은 흔들린다"는 노이즈 바닥을 알아야 한다.
// 같은 (keyword, engine, model, question)으로 N회 호출 → 결과 간 유사도를 집계.
//
// - Jaccard: 인용 "집합"이 얼마나 겹치는가 (순위 무시)
// - RBO(Rank-Biased Overlap): 인용 "순위"가 얼마나 겹치는가 (상위 가중)
// 두 지표가 높을수록 안정적, 낮을수록 노이즈가 크다.

import type { Citation } from './types.ts';

// 인용 목록 → 루트 도메인 집합 (중복 제거)
export function domainSet(citations: Citation[]): Set<string> {
  const set = new Set<string>();
  for (const c of citations) {
    if (c.rootDomain) set.add(c.rootDomain);
  }
  return set;
}

// 인용 목록 → 순위 보존 루트 도메인 배열 (첫 등장 순서 유지, 중복 제거)
export function domainRanking(citations: Citation[]): string[] {
  const seen = new Set<string>();
  const ranking: string[] = [];
  // rank 오름차순으로 정렬 후 첫 등장만
  const sorted = [...citations].sort((a, b) => a.rank - b.rank);
  for (const c of sorted) {
    if (!c.rootDomain || seen.has(c.rootDomain)) continue;
    seen.add(c.rootDomain);
    ranking.push(c.rootDomain);
  }
  return ranking;
}

// Jaccard 유사도 = |A∩B| / |A∪B|. 둘 다 비면 1(완전 동일=빈 결과끼리).
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 1 : inter / union;
}

// RBO(Rank-Biased Overlap). p∈(0,1): 작을수록 상위 순위에 가중.
// 가변 길이 목록에 대한 유한 절단 근사 — 두 목록 중 긴 쪽 깊이까지 누적.
// 둘 다 비면 1.
export function rbo(listA: string[], listB: string[], p = 0.9): number {
  if (listA.length === 0 && listB.length === 0) return 1;
  if (listA.length === 0 || listB.length === 0) return 0;

  const depth = Math.max(listA.length, listB.length);
  const seenA = new Set<string>();
  const seenB = new Set<string>();
  let overlap = 0;
  let sum = 0;

  for (let d = 1; d <= depth; d++) {
    const a = listA[d - 1];
    const b = listB[d - 1];
    if (a !== undefined) seenA.add(a);
    if (b !== undefined) seenB.add(b);
    // 깊이 d까지의 교집합 크기
    if (a !== undefined && seenB.has(a)) overlap++;
    if (b !== undefined && a !== b && seenA.has(b)) overlap++;
    const agreement = overlap / d; // 깊이 d에서의 일치도
    sum += Math.pow(p, d - 1) * agreement;
  }

  return (1 - p) * sum;
}

export interface NoiseFloor {
  runs: number;             // 호출 횟수 N
  avgJaccard: number;       // 쌍별 Jaccard 평균 (집합 안정성)
  avgRbo: number;           // 쌍별 RBO 평균 (순위 안정성)
  stableDomains: string[];  // 모든 호출에 등장한 도메인 (코어)
  volatileDomains: string[];// 일부 호출에만 등장한 도메인 (노이즈)
  domainFrequency: Record<string, number>; // 도메인별 등장 비율 (0~1)
}

// N개 호출 결과의 노이즈 바닥을 집계.
export function computeNoiseFloor(results: Array<{ citations: Citation[] }>): NoiseFloor {
  const n = results.length;
  if (n === 0) {
    return { runs: 0, avgJaccard: 0, avgRbo: 0, stableDomains: [], volatileDomains: [], domainFrequency: {} };
  }

  const sets = results.map(r => domainSet(r.citations));
  const rankings = results.map(r => domainRanking(r.citations));

  // 쌍별 Jaccard / RBO 평균
  let jSum = 0;
  let rSum = 0;
  let pairs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      jSum += jaccard(sets[i], sets[j]);
      rSum += rbo(rankings[i], rankings[j]);
      pairs++;
    }
  }
  // N=1이면 쌍이 없음 → 변동성 정의 불가, 1로 간주
  const avgJaccard = pairs === 0 ? 1 : jSum / pairs;
  const avgRbo = pairs === 0 ? 1 : rSum / pairs;

  // 도메인별 등장 횟수
  const count = new Map<string, number>();
  for (const set of sets) {
    for (const d of set) count.set(d, (count.get(d) ?? 0) + 1);
  }

  const stableDomains: string[] = [];
  const volatileDomains: string[] = [];
  const domainFrequency: Record<string, number> = {};
  for (const [domain, c] of count) {
    domainFrequency[domain] = c / n;
    if (c === n) stableDomains.push(domain);
    else volatileDomains.push(domain);
  }
  // 등장 빈도 내림차순
  stableDomains.sort((a, b) => (domainFrequency[b] - domainFrequency[a]) || a.localeCompare(b));
  volatileDomains.sort((a, b) => (domainFrequency[b] - domainFrequency[a]) || a.localeCompare(b));

  return { runs: n, avgJaccard, avgRbo, stableDomains, volatileDomains, domainFrequency };
}

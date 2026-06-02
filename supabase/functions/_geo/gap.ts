// 격차 분류 — SEO와 GEO가 같은 도메인 키로 맞물릴 때만 의미가 생긴다 (기획서 4-3, 6-2).
// 기본 티어에선 "한 화면에 나란히"를 위해 도메인을 3분류만 한다.
// (변동성·시계열 등 본격 분석은 프로 영역)

import { rootDomain, isSameDomain } from '../_core/domain.ts';
import type { Citation } from './types.ts';

export type GapBucket = 'both' | 'seo_only' | 'geo_only';

export interface DomainGap {
  rootDomain: string;
  bucket: GapBucket;
  seoRank?: number; // SEO 최상위 노출 순위
  geoRank?: number; // GEO 최상위 인용 순위
  isSelf?: boolean; // 엔티티 자기 도메인 여부 (자기-귀속 강조용)
}

export interface SeoHit {
  url: string;
  rank: number;
}

// SEO 노출 + GEO 인용을 루트 도메인 기준으로 합쳐 3분류.
// selfDomain이 주어지면 해당 도메인을 isSelf로 표시 (격차 매트릭스의 자기-귀속 기준).
export function classifyGap(
  seoHits: SeoHit[],
  geoCitations: Citation[],
  selfDomain?: string,
): DomainGap[] {
  // 도메인별 최상위(최소) 순위 집계
  const seo = new Map<string, number>();
  for (const hit of seoHits) {
    const root = rootDomain(hit.url);
    if (!root) continue;
    const prev = seo.get(root);
    if (prev === undefined || hit.rank < prev) seo.set(root, hit.rank);
  }

  const geo = new Map<string, number>();
  for (const c of geoCitations) {
    if (!c.rootDomain) continue;
    const prev = geo.get(c.rootDomain);
    if (prev === undefined || c.rank < prev) geo.set(c.rootDomain, c.rank);
  }

  const all = new Set<string>([...seo.keys(), ...geo.keys()]);
  const gaps: DomainGap[] = [];

  for (const root of all) {
    const seoRank = seo.get(root);
    const geoRank = geo.get(root);
    const bucket: GapBucket =
      seoRank !== undefined && geoRank !== undefined ? 'both'
      : seoRank !== undefined ? 'seo_only'
      : 'geo_only';

    gaps.push({
      rootDomain: root,
      bucket,
      seoRank,
      geoRank,
      isSelf: selfDomain ? isSameDomain(selfDomain, root) : undefined,
    });
  }

  // 정렬: 자기 도메인 먼저 → both → seo_only → geo_only → 순위 오름차순
  const bucketOrder: Record<GapBucket, number> = { both: 0, seo_only: 1, geo_only: 2 };
  gaps.sort((a, b) => {
    if (!!b.isSelf !== !!a.isSelf) return b.isSelf ? 1 : -1;
    if (bucketOrder[a.bucket] !== bucketOrder[b.bucket]) return bucketOrder[a.bucket] - bucketOrder[b.bucket];
    return (a.seoRank ?? a.geoRank ?? 99) - (b.seoRank ?? b.geoRank ?? 99);
  });

  return gaps;
}

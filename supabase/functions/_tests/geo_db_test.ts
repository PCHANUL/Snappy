import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import type { GeoRunSave, SeoSnapshotHit, RunSummary } from '../_geo/db.ts';
import type { GeoEntity, TrackedKeyword } from '../_geo/db.ts';

// 타입 컴파일 검증 — 실제 DB 호출 없이 구조만 검사

Deno.test('GeoRunSave 타입 구조 검증', () => {
  const snap: SeoSnapshotHit = { url: 'https://blog.naver.com/post', rank: 1, platform: 'naver_blog', title: '제목' };
  const run: GeoRunSave = {
    keywordId: 'kw-uuid',
    engine: 'claude',
    model: 'claude-haiku-4-5-20251001',
    question: '강남 임플란트 추천해줘',
    answer: '답변 텍스트',
    citations: [{ url: 'https://example.com', rootDomain: 'example.com', rank: 1 }],
    seoSnapshots: [snap],
  };
  assertEquals(run.engine, 'claude');
  assertEquals(run.seoSnapshots.length, 1);
  assertEquals(snap.platform, 'naver_blog');
});

Deno.test('RunSummary 타입 구조 검증', () => {
  const summary: RunSummary = {
    id: 'run-uuid',
    keyword_id: 'kw-uuid',
    engine: 'claude',
    model: 'claude-haiku-4-5-20251001',
    question: '테스트 질의',
    run_at: new Date().toISOString(),
    citation_count: 3,
    seo_count: 10,
  };
  assertEquals(summary.citation_count, 3);
  assertEquals(summary.self_geo_rank, undefined);
});

Deno.test('GeoEntity 타입 구조 검증', () => {
  const entity: GeoEntity = {
    id: 'e-uuid',
    user_id: 'u-uuid',
    name: '강남치과',
    self_domain: 'gangnam-dental.com',
    type: 'brand',
    created_at: new Date().toISOString(),
  };
  assertEquals(entity.type, 'brand');
});

Deno.test('TrackedKeyword 타입 구조 검증', () => {
  const kw: TrackedKeyword = {
    id: 'kw-uuid',
    entity_id: 'e-uuid',
    keyword: '강남 임플란트',
    intent: 'recommend',
    created_at: new Date().toISOString(),
  };
  assertEquals(kw.intent, 'recommend');
});

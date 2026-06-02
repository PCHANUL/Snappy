// GEO 엔티티·측정 결과 Supabase CRUD 헬퍼
// 엔티티 등록/조회, 키워드 추적, 측정 run 저장, 타임라인 조회

import { getSupabase } from '../_core/db.ts';
import { rootDomain } from '../_core/domain.ts';
import type { Citation, GeoEngine } from './types.ts';
import type { QuestionIntent } from './question-template.ts';

// ── 타입 ─────────────────────────────────────────────────────────────────────

export interface GeoEntity {
  id: string;
  user_id: string;
  name: string;
  self_domain?: string;
  type: 'brand' | 'website' | 'product' | 'person';
  created_at: string;
}

export interface TrackedKeyword {
  id: string;
  entity_id: string;
  keyword: string;
  intent: QuestionIntent;
  created_at: string;
}

export interface SeoSnapshotHit {
  url: string;
  rank: number;
  platform: string;
  title?: string;
}

export interface GeoRunSave {
  keywordId: string;
  engine: GeoEngine;
  model: string;
  question: string;
  answer?: string;
  citations: Citation[];
  seoSnapshots: SeoSnapshotHit[];
}

export interface RunSummary {
  id: string;
  keyword_id: string;
  engine: string;
  model: string;
  question: string;
  answer?: string;
  run_at: string;
  citation_count: number;
  seo_count: number;
  self_geo_rank?: number;  // 자기 도메인의 GEO 인용 순위 (없으면 undefined)
}

// ── 엔티티 ───────────────────────────────────────────────────────────────────

export async function registerEntity(
  userId: string,
  name: string,
  selfDomain?: string,
  type: GeoEntity['type'] = 'brand',
): Promise<GeoEntity> {
  const { data, error } = await getSupabase()
    .from('geo_entities')
    .insert({ user_id: userId, name, self_domain: selfDomain || null, type })
    .select('id, user_id, name, self_domain, type, created_at')
    .single();
  if (error || !data) throw new Error(`registerEntity failed: ${error?.message}`);
  return data as GeoEntity;
}

export async function listEntities(userId: string): Promise<GeoEntity[]> {
  const { data, error } = await getSupabase()
    .from('geo_entities')
    .select('id, user_id, name, self_domain, type, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`listEntities failed: ${error.message}`);
  return (data ?? []) as GeoEntity[];
}

export async function deleteEntity(entityId: string, userId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('geo_entities')
    .delete()
    .eq('id', entityId)
    .eq('user_id', userId);
  if (error) throw new Error(`deleteEntity failed: ${error.message}`);
}

// ── 추적 키워드 ──────────────────────────────────────────────────────────────

export async function addTrackedKeyword(
  entityId: string,
  userId: string,
  keyword: string,
  intent: QuestionIntent = 'recommend',
): Promise<TrackedKeyword> {
  const { data, error } = await getSupabase()
    .from('geo_tracked_keywords')
    .upsert(
      { entity_id: entityId, user_id: userId, keyword, intent },
      { onConflict: 'entity_id,keyword' },
    )
    .select('id, entity_id, keyword, intent, created_at')
    .single();
  if (error || !data) throw new Error(`addTrackedKeyword failed: ${error?.message}`);
  return data as TrackedKeyword;
}

export async function listTrackedKeywords(entityId: string): Promise<TrackedKeyword[]> {
  const { data, error } = await getSupabase()
    .from('geo_tracked_keywords')
    .select('id, entity_id, keyword, intent, created_at')
    .eq('entity_id', entityId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`listTrackedKeywords failed: ${error.message}`);
  return (data ?? []) as TrackedKeyword[];
}

export async function deleteTrackedKeyword(keywordId: string, userId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('geo_tracked_keywords')
    .delete()
    .eq('id', keywordId)
    .eq('user_id', userId);
  if (error) throw new Error(`deleteTrackedKeyword failed: ${error.message}`);
}

// ── 측정 Run 저장 ────────────────────────────────────────────────────────────

export async function saveGeoRun(run: GeoRunSave): Promise<string> {
  // 1. run 행 삽입
  const { data: runRow, error: runErr } = await getSupabase()
    .from('geo_runs')
    .insert({
      keyword_id: run.keywordId,
      engine: run.engine,
      model: run.model,
      question: run.question,
      answer: run.answer ?? null,
    })
    .select('id')
    .single();
  if (runErr || !runRow) throw new Error(`saveGeoRun insert failed: ${runErr?.message}`);

  const runId = runRow.id as string;

  // 2. 인용 행 배치 삽입
  if (run.citations.length > 0) {
    await getSupabase().from('geo_citations').insert(
      run.citations.map(c => ({
        run_id: runId,
        rank: c.rank,
        url: c.url,
        root_domain: c.rootDomain,
        title: c.title ?? null,
        snippet: c.snippet ?? null,
      })),
    );
  }

  // 3. SEO 스냅샷 배치 삽입
  if (run.seoSnapshots.length > 0) {
    await getSupabase().from('geo_seo_snapshots').insert(
      run.seoSnapshots.map(h => ({
        run_id: runId,
        platform: h.platform,
        rank: h.rank,
        url: h.url,
        root_domain: rootDomain(h.url),
        title: h.title ?? null,
      })),
    );
  }

  return runId;
}

// ── 타임라인 조회 ────────────────────────────────────────────────────────────

export async function getKeywordTimeline(keywordId: string, limit = 20): Promise<RunSummary[]> {
  const { data: runs, error } = await getSupabase()
    .from('geo_runs')
    .select('id, keyword_id, engine, model, question, answer, run_at')
    .eq('keyword_id', keywordId)
    .order('run_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`getKeywordTimeline failed: ${error.message}`);
  if (!runs || runs.length === 0) return [];

  const runIds = runs.map((r: { id: string }) => r.id);

  const [citResult, seoResult] = await Promise.all([
    getSupabase()
      .from('geo_citations')
      .select('run_id, rank, root_domain')
      .in('run_id', runIds),
    getSupabase()
      .from('geo_seo_snapshots')
      .select('run_id')
      .in('run_id', runIds),
  ]);

  // 집계: run_id별 인용 수·SEO 수·자기 도메인 GEO 순위
  type CitRow = { run_id: string; rank: number; root_domain: string };
  const citsByRun = new Map<string, CitRow[]>();
  for (const c of (citResult.data ?? []) as CitRow[]) {
    if (!citsByRun.has(c.run_id)) citsByRun.set(c.run_id, []);
    citsByRun.get(c.run_id)!.push(c);
  }

  const seoCountByRun = new Map<string, number>();
  for (const s of (seoResult.data ?? []) as { run_id: string }[]) {
    seoCountByRun.set(s.run_id, (seoCountByRun.get(s.run_id) ?? 0) + 1);
  }

  // self_domain은 keyword → entity.self_domain 로 가져와야 하나,
  // 여기서는 호출 측에서 selfDomain을 주입해서 필터하도록 설계.
  // self_geo_rank는 호출 측에서 후처리하거나, 별도 join으로 확장 가능.

  return (runs as Array<{
    id: string; keyword_id: string; engine: string; model: string;
    question: string; answer?: string; run_at: string;
  }>).map(r => ({
    id: r.id,
    keyword_id: r.keyword_id,
    engine: r.engine,
    model: r.model,
    question: r.question,
    answer: r.answer,
    run_at: r.run_at,
    citation_count: citsByRun.get(r.id)?.length ?? 0,
    seo_count: seoCountByRun.get(r.id) ?? 0,
  }));
}

// 타임라인 + 자기 도메인 GEO 순위를 한 번에 반환하는 확장 버전
export async function getKeywordTimelineWithSelf(
  keywordId: string,
  selfDomain: string,
  limit = 20,
): Promise<Array<RunSummary & { self_geo_rank?: number }>> {
  const runs = await getKeywordTimeline(keywordId, limit);
  if (!runs.length || !selfDomain) return runs;

  const runIds = runs.map(r => r.id);
  const { data: selfCits } = await getSupabase()
    .from('geo_citations')
    .select('run_id, rank')
    .in('run_id', runIds)
    .eq('root_domain', selfDomain)
    .order('rank');

  const selfRankByRun = new Map<string, number>();
  for (const c of (selfCits ?? []) as { run_id: string; rank: number }[]) {
    if (!selfRankByRun.has(c.run_id)) selfRankByRun.set(c.run_id, c.rank);
  }

  return runs.map(r => ({ ...r, self_geo_rank: selfRankByRun.get(r.id) }));
}

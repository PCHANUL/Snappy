// GEO 노이즈 바닥 측정 Edge Function (기획서 7-5)
// 같은 질문을 N회 호출해 AI 인용의 본질적 변동성을 잰다.
// "변했다"를 말하려면 먼저 "가만히 둬도 이만큼 흔들린다"는 바닥을 알아야 한다.
//
// POST { user_id, keyword, intent?, runs?, keyword_id? }
//   1. 사용자 + 쿼터 확인
//   2. 동일 질문을 N회 병렬 호출 (Claude web_search)
//   3. 쌍별 Jaccard·RBO로 변동성 집계 + 코어/노이즈 도메인 분류
//   4. keyword_id가 있으면 batch로 묶어 DB 저장

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, errorToResponse, ValidationError, AppError } from '../_core/errors.ts';
import { env } from '../_core/env.ts';
import { logger } from '../_core/logger.ts';
import { getUserAndCheckQuota, incrementUsage } from '../_core/db.ts';
import { queryClaudeGeo } from '../_geo/claude-engine.ts';
import { buildQuestion } from '../_geo/question-template.ts';
import type { QuestionIntent } from '../_geo/question-template.ts';
import { computeNoiseFloor } from '../_geo/variability.ts';
import { saveGeoRun, saveNoiseFloor } from '../_geo/db.ts';
import type { NormalizedResult } from '../_geo/types.ts';

const DEFAULT_RUNS = 3;
const MAX_RUNS = 5;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const userId = typeof body?.user_id === 'string' ? body.user_id.trim() : '';
    const keyword = typeof body?.keyword === 'string' ? body.keyword.trim() : '';
    const intent: QuestionIntent = body?.intent ?? 'recommend';
    const keywordId = typeof body?.keyword_id === 'string' ? body.keyword_id.trim() : undefined;
    const runs = clampRuns(body?.runs);

    if (!userId) throw new ValidationError('user_id is required', '사용자 정보가 누락되었습니다.');
    if (!keyword) throw new ValidationError('keyword is required', '키워드를 입력해주세요.');
    if (!env.anthropic.apiKey) {
      throw new AppError('ANTHROPIC_API_KEY not set', 'CONFIG_ERROR', 503, 'AI 측정 기능이 설정되지 않았어요.');
    }

    await getUserAndCheckQuota(userId);

    const question = buildQuestion(keyword, intent);

    // N회 병렬 호출 — 일부 실패해도 성공분으로 변동성 계산
    const settled = await Promise.allSettled(
      Array.from({ length: runs }, () => queryClaudeGeo(env.anthropic.apiKey, question)),
    );

    const results: NormalizedResult[] = [];
    for (const s of settled) {
      if (s.status === 'fulfilled') results.push(s.value);
      else logger.warn('GEO noise: run failed', { error: String(s.reason) });
    }

    if (results.length < 2) {
      throw new AppError(
        'Not enough successful runs for variability',
        'MEASURE_FAILED', 502,
        '변동성을 계산하려면 최소 2회 호출이 성공해야 해요. 잠시 후 다시 시도해주세요.',
      );
    }

    const floor = computeNoiseFloor(results);

    await incrementUsage(userId).catch(() => { /* 비치명적 */ });

    // 추적 키워드면 batch로 묶어 저장 (비치명적, 백그라운드)
    let batchId: string | undefined;
    if (keywordId) {
      batchId = crypto.randomUUID();
      persistBatch(keywordId, batchId, results, floor, question)
        .catch(err => logger.warn('Failed to persist noise batch', { error: String(err) }));
    }

    return jsonRes({
      keyword,
      question,
      engine: results[0].engine,
      model: results[0].model,
      requested_runs: runs,
      successful_runs: results.length,
      floor: {
        avg_jaccard: floor.avgJaccard,
        avg_rbo: floor.avgRbo,
        stable_domains: floor.stableDomains,
        volatile_domains: floor.volatileDomains,
        domain_frequency: floor.domainFrequency,
      },
      // 호출별 인용 (UI에서 회차 비교용)
      per_run: results.map((r, i) => ({
        run: i + 1,
        citations: r.citations.map(c => ({ rank: c.rank, rootDomain: c.rootDomain, url: c.url, title: c.title })),
      })),
      saved: !!keywordId,
      notice: 'AI 인용은 호출마다 달라집니다. 위 안정성 지표가 그 변동의 바닥값이에요.',
    });
  } catch (error) {
    logger.error('geo-noise failed', error);
    return errorToResponse(error);
  }
});

async function persistBatch(
  keywordId: string,
  batchId: string,
  results: NormalizedResult[],
  floor: ReturnType<typeof computeNoiseFloor>,
  question: string,
): Promise<void> {
  // N개 run을 batch로 묶어 저장
  for (const r of results) {
    await saveGeoRun({
      keywordId,
      engine: r.engine,
      model: r.model,
      question: r.question,
      answer: r.answer,
      citations: r.citations,
      seoSnapshots: [],
      batchId,
    });
  }
  await saveNoiseFloor({
    batchId,
    keywordId,
    engine: results[0].engine,
    model: results[0].model,
    question,
    floor,
  });
}

function clampRuns(v: unknown): number {
  const n = typeof v === 'number' ? Math.floor(v) : parseInt(String(v ?? ''), 10);
  if (isNaN(n)) return DEFAULT_RUNS;
  return Math.min(MAX_RUNS, Math.max(2, n));
}

function jsonRes(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

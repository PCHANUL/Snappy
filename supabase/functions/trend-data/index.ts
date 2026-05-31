import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, errorToResponse, ValidationError } from '../_shared/errors.ts';
import { env } from '../_shared/env.ts';
import { logger } from '../_shared/logger.ts';
import { fetchNaverTrendTopics } from '../_shared/naver-trends.ts';
import { fetchGoogleInterestOverTime } from '../_shared/google-trends.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');

    if (action === 'daily') return await handleDailyTrends();
    if (action === 'keyword') {
      const keyword = url.searchParams.get('keyword') || '';
      if (!keyword) throw new ValidationError('keyword is required', '키워드를 입력해주세요.');
      return await handleKeywordTrend(keyword);
    }
    if (action === 'google-keyword') {
      const keyword = url.searchParams.get('keyword') || '';
      if (!keyword) throw new ValidationError('keyword is required', '키워드를 입력해주세요.');
      return await handleGoogleKeywordTrend(keyword);
    }
    throw new ValidationError(`Unknown action: ${action}`);
  } catch (error) {
    logger.error('trend-data error', error);
    return errorToResponse(error);
  }
});

// 네이버 데이터랩 — 후보 키워드 검색량 트렌드
async function handleDailyTrends(): Promise<Response> {
  try {
    return jsonRes({
      topics: await fetchNaverTrendTopics(
        env.naver.clientId,
        env.naver.clientSecret,
        Deno.env.get('NAVER_TREND_KEYWORDS') || '',
      ),
    });
  } catch (error) {
    logger.warn('Naver trend unavailable', { error: String(error) });
    return jsonRes({ topics: [], error: 'trends_unavailable' });
  }
}

// 네이버 데이터랩 — 키워드 검색량 트렌드 (최근 3개월, 주 단위)
async function handleKeywordTrend(keyword: string): Promise<Response> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 3);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const res = await fetch('https://openapi.naver.com/v1/datalab/search', {
    method: 'POST',
    headers: {
      'X-Naver-Client-Id': env.naver.clientId,
      'X-Naver-Client-Secret': env.naver.clientSecret,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      startDate: fmt(startDate),
      endDate: fmt(endDate),
      timeUnit: 'week',
      keywordGroups: [{ groupName: keyword, keywords: [keyword] }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    logger.warn('Naver DataLab failed', { status: res.status, body: body.slice(0, 200) });
    // DataLab 권한 미설정 등 — 그레이스풀 처리
    return jsonRes({ trend: null });
  }

  const data = await res.json();
  const result = (data.results as any[])?.[0];
  if (!result) return jsonRes({ trend: null });

  const points: Array<{ period: string; ratio: number }> = result.data || [];
  if (points.length < 4) return jsonRes({ trend: null });

  const recent = avg(points.slice(-2).map((d) => d.ratio));
  const prev = avg(points.slice(-4, -2).map((d) => d.ratio));
  const direction: 'up' | 'down' | 'stable' =
    recent > prev * 1.1 ? 'up' : recent < prev * 0.9 ? 'down' : 'stable';
  const changePercent = prev > 0 ? Math.round(((recent - prev) / prev) * 100) : 0;

  return jsonRes({
    trend: {
      direction,
      changePercent,
      points: points.map((d) => ({ period: d.period, ratio: Math.round(d.ratio) })),
    },
  });
}

// 구글 트렌드 — 키워드 시계열 방향 (pytrends: interest_over_time)
async function handleGoogleKeywordTrend(keyword: string): Promise<Response> {
  try {
    const result = await fetchGoogleInterestOverTime(keyword);
    return jsonRes({ trend: result });
  } catch (error) {
    logger.warn('Google keyword trend failed', { keyword, error: String(error) });
    return jsonRes({ trend: null });
  }
}

function avg(arr: number[]): number {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

function jsonRes(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

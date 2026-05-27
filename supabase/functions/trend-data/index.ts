import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, errorToResponse, ValidationError } from '../_shared/errors.ts';
import { env } from '../_shared/env.ts';
import { logger } from '../_shared/logger.ts';

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
    throw new ValidationError(`Unknown action: ${action}`);
  } catch (error) {
    logger.error('trend-data error', error);
    return errorToResponse(error);
  }
});

// Google 트렌드 — 한국 오늘의 인기 검색어
async function handleDailyTrends(): Promise<Response> {
  try {
    const res = await fetch(
      'https://trends.google.com/trends/api/dailytrends?hl=ko&tz=-540&geo=KR&ns=15',
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) throw new Error(`Google Trends ${res.status}`);

    const text = await res.text();
    // Google Trends 응답 앞의 ")]}'\n" 제거
    const json = JSON.parse(text.replace(/^\)\]\}'\n/, ''));
    const searches = (json.default?.trendingSearchesDays?.[0]?.trendingSearches as any[]) || [];

    const topics = searches
      .slice(0, 10)
      .map((item: any) => ({
        keyword: item.title?.query || '',
        traffic: item.formattedTraffic || '',
      }))
      .filter((t) => t.keyword);

    return jsonRes({ topics });
  } catch (error) {
    logger.warn('Google Trends unavailable', { error: String(error) });
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

function avg(arr: number[]): number {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

function jsonRes(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

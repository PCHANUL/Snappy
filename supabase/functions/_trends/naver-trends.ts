export interface DailyTrendTopic {
  keyword: string;
  traffic: string;
}

export interface RankedKeyword {
  keyword: string;
  ratio: number; // 0–100, 해당 키워드의 기간 내 최고값 대비 최신 주차 상대값
}

interface NaverTrendPoint {
  period: string;
  ratio: number;
}

interface NaverTrendResult {
  title: string;
  keywords: string[];
  data: NaverTrendPoint[];
}

const DEFAULT_TREND_KEYWORDS = [
  'AI',
  '숏폼',
  '유튜브',
  '블로그',
  '커머스',
];

export async function fetchNaverTrendTopics(
  clientId: string,
  clientSecret: string,
  rawKeywords = '',
): Promise<DailyTrendTopic[]> {
  const keywords = trendKeywords(rawKeywords);
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 28);

  const res = await fetch('https://openapi.naver.com/v1/datalab/search', {
    method: 'POST',
    headers: {
      'X-Naver-Client-Id': clientId,
      'X-Naver-Client-Secret': clientSecret,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
      timeUnit: 'week',
      keywordGroups: keywords.map((keyword) => ({
        groupName: keyword,
        keywords: [keyword],
      })),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Naver DataLab ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const results = (data.results || []) as NaverTrendResult[];

  return results
    .map((result) => {
      const latest = result.data.at(-1)?.ratio || 0;
      const previous = avg(result.data.slice(0, -1).map((point) => point.ratio));
      const delta = latest - previous;

      return {
        keyword: result.title || result.keywords?.[0] || '',
        traffic: `${Math.round(latest)}`,
        score: latest + Math.max(delta, 0),
      };
    })
    .filter((topic) => topic.keyword)
    .sort((a, b) => b.score - a.score)
    .map(({ keyword, traffic }) => ({ keyword, traffic }));
}

// 후보 키워드 상위 5개를 각각 1그룹(1키워드)으로 묶어 1회 호출 → 개별 ratio 반환
// keywordGroups는 요청당 최대 5개이므로 1회 호출로 개별 비교 가능한 최대치가 5개
export async function rankCandidatesByTrend(
  clientId: string,
  clientSecret: string,
  candidates: string[],
): Promise<RankedKeyword[]> {
  if (!candidates.length) return [];

  const batch = candidates.slice(0, 5); // 1회 호출 = 최대 5그룹
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 28);

  try {
    const res = await fetch('https://openapi.naver.com/v1/datalab/search', {
      method: 'POST',
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startDate: formatDate(startDate),
        endDate: formatDate(endDate),
        timeUnit: 'week',
        keywordGroups: batch.map((kw) => ({ groupName: kw, keywords: [kw] })),
      }),
    });

    if (!res.ok) return [];

    const data = await res.json();
    return ((data.results ?? []) as NaverTrendResult[])
      .map((result) => ({
        keyword: result.title || result.keywords?.[0] || '',
        ratio: Math.round(result.data.at(-1)?.ratio ?? 0),
      }))
      .filter((r) => r.keyword)
      .sort((a, b) => b.ratio - a.ratio);
  } catch {
    return [];
  }
}

function trendKeywords(rawKeywords: string): string[] {
  const values = rawKeywords
    .split(',')
    .map((keyword) => keyword.trim())
    .filter(Boolean);

  return Array.from(new Set(values.length ? values : DEFAULT_TREND_KEYWORDS)).slice(0, 5);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function avg(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

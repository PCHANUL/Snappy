export interface DailyTrendTopic {
  keyword: string;
  traffic: string;
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
  '인스타그램',
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

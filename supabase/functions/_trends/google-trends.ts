// Google Trends API 래퍼 — pytrends 주요 메서드를 TypeScript/Deno로 재현
//
// pytrends 동작 방식:
//   trending_searches()   → RSS 피드 (인증 불필요, 가장 안정적)
//   related_queries()     → explore → widgetdata/multirange (2단계)
//   interest_over_time()  → explore → widgetdata/multiline  (2단계)
//
// 응답은 모두 )]}'\n 접두사로 시작하는 JSONP 형식 → stripGT()로 제거

const GT_BASE = 'https://trends.google.com/trends/api';
const RSS_URL = 'https://trends.google.com/trends/trendingsearches/daily/rss';

// 일반 브라우저 UA — 없으면 403 반환
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const COMMON_HEADERS = {
  'User-Agent': UA,
  'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
  'Accept': 'application/json, text/plain, */*',
};

// Google Trends 응답 앞의 )]}'\n 제거 후 JSON 파싱
function stripGT(text: string): any {
  const idx = text.indexOf('{');
  if (idx === -1) throw new Error('Google Trends: unexpected response format');
  return JSON.parse(text.slice(idx));
}

export interface GoogleTrendTopic {
  keyword: string;
  traffic: string; // "100K+", "1,000,000+" 형식
}

export interface GoogleRisingQuery {
  query: string;
  value: string; // "+250%" 또는 "급상승" (value ≥ 5000)
}

export interface GoogleTrendDirection {
  direction: 'up' | 'down' | 'stable';
  changePercent: number;
  points: Array<{ period: string; value: number }>;
}

// ── 1. 오늘의 인기 검색어 (pytrends: trending_searches) ────────────────────────
// RSS 피드 사용 — 인증 불필요, 가장 안정적
export async function fetchGoogleDailyTrends(geo = 'KR'): Promise<GoogleTrendTopic[]> {
  const res = await fetch(`${RSS_URL}?geo=${geo}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Google Trends RSS ${res.status}`);

  const xml = await res.text();
  const topics: GoogleTrendTopic[] = [];

  // <item>...</item> 블록 순서대로 파싱
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const item = m[1];
    // <title>키워드</title> 또는 <title><![CDATA[키워드]]></title>
    const titleM = /<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s.exec(item);
    const trafficM = /<ht:approx_traffic>(.*?)<\/ht:approx_traffic>/s.exec(item);
    const keyword = titleM?.[1]?.trim();
    if (keyword) {
      topics.push({ keyword, traffic: trafficM?.[1]?.replace(/,/g, '') || '' });
    }
    if (topics.length >= 10) break;
  }
  return topics;
}

// ── 공통: explore 엔드포인트 → widget 목록 획득 ──────────────────────────────
// pytrends: build_payload() 후 내부적으로 호출
async function fetchWidgets(keyword: string, geo: string, timeframe = 'today 3-m'): Promise<any[]> {
  const req = JSON.stringify({
    comparisonItem: [{ keyword, geo, time: timeframe }],
    category: 0,
    property: '',
  });
  const params = new URLSearchParams({ hl: 'ko', tz: '-540', req });

  const res = await fetch(`${GT_BASE}/explore?${params}`, { headers: COMMON_HEADERS });
  if (!res.ok) throw new Error(`Google Trends explore ${res.status}`);

  const data = stripGT(await res.text());
  return (data.widgets as any[]) ?? [];
}

// ── 공통: widget 토큰으로 실제 데이터 요청 ───────────────────────────────────
async function fetchWidgetData(widget: any, endpoint: string): Promise<any> {
  const params = new URLSearchParams({
    hl: 'ko',
    tz: '-540',
    req: JSON.stringify(widget.request),
    token: widget.token,
  });
  const res = await fetch(`${GT_BASE}/${endpoint}?${params}`, { headers: COMMON_HEADERS });
  if (!res.ok) throw new Error(`Google Trends ${endpoint} ${res.status}`);
  return stripGT(await res.text());
}

// ── 2. 상승 관련 검색어 (pytrends: related_queries → 'rising') ────────────────
// explore → widgetdata/multirange
export async function fetchGoogleRelatedQueries(
  keyword: string,
  geo = 'KR',
): Promise<GoogleRisingQuery[]> {
  const widgets = await fetchWidgets(keyword, geo);
  const rqWidget = widgets.find((w) => w.id === 'RELATED_QUERIES');
  if (!rqWidget) return [];

  const data = await fetchWidgetData(rqWidget, 'widgetdata/multirange');
  // rankedList[0] = TOP, rankedList[1] = RISING
  const rising: any[] = data.default?.rankedList?.[1]?.rankedKeyword ?? [];

  return rising.slice(0, 10).map((item) => ({
    query: String(item.query),
    value: item.value >= 5000 ? '급상승' : `+${item.value}%`,
  }));
}

// ── 3. 키워드 시계열 트렌드 (pytrends: interest_over_time) ────────────────────
// explore → widgetdata/multiline
export async function fetchGoogleInterestOverTime(
  keyword: string,
  geo = 'KR',
): Promise<GoogleTrendDirection | null> {
  const widgets = await fetchWidgets(keyword, geo);
  const tsWidget = widgets.find((w) => w.id === 'TIMESERIES');
  if (!tsWidget) return null;

  const data = await fetchWidgetData(tsWidget, 'widgetdata/multiline');
  const timeline: any[] = data.default?.timelineData ?? [];
  if (timeline.length < 4) return null;

  const points = timeline.map((d) => ({
    period: d.formattedTime ?? d.formattedAxisTime ?? '',
    value: d.value?.[0] ?? 0,
  }));

  const values = points.map((p) => p.value);
  const recent = avg(values.slice(-2));
  const prev = avg(values.slice(-4, -2));
  const direction: GoogleTrendDirection['direction'] =
    recent > prev * 1.1 ? 'up' : recent < prev * 0.9 ? 'down' : 'stable';
  const changePercent = prev > 0 ? Math.round(((recent - prev) / prev) * 100) : 0;

  return { direction, changePercent, points };
}

function avg(arr: number[]): number {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

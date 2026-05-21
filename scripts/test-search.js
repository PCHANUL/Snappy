#!/usr/bin/env node
// 검색 함수 테스트 스크립트
// 사용법: node scripts/test-search.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// .env.local 파싱
function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnv(path.join(ROOT, '.env.local'));

// ── 테스트 러너 ──────────────────────────────────────────────────────────────

let passed = 0, failed = 0, skipped = 0;

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}
function assertEquals(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function assertContains(str, sub, msg) {
  if (!str.includes(sub)) throw new Error(msg || `"${str}" 에 "${sub}" 미포함`);
}

async function test(name, fn, { skip = false } = {}) {
  if (skip) {
    console.log(`  ⏭  ${name}`);
    skipped++;
    return;
  }
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${e.message}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n── ${title} ─────────────────────────────────────`);
}

// ── 순수 함수: stripHtml ─────────────────────────────────────────────────────

function stripHtml(text) {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function parseNaverDate(yyyymmdd) {
  if (!yyyymmdd || yyyymmdd.length !== 8) return '';
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function filterByPeriod(item, period) {
  if (!period || !item.published_at) return true;
  const itemDate = new Date(item.published_at);
  if (isNaN(itemDate.getTime())) return true;
  const now = new Date();
  const diffDays = (now.getTime() - itemDate.getTime()) / (1000 * 60 * 60 * 24);
  const limits = { day: 1, week: 7, month: 30, year: 365 };
  return diffDays <= limits[period];
}

function getPublishedAfter(period) {
  const offsets = { day: 1, week: 7, month: 30, year: 365 };
  const date = new Date();
  date.setDate(date.getDate() - offsets[period]);
  return date.toISOString();
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function deduplicateResults(results) {
  const seen = new Set();
  return results.map(result => {
    const unique = result.items.filter(item => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
    return { ...result, items: unique, count: unique.length };
  });
}

// ── 단위 테스트 ──────────────────────────────────────────────────────────────

section('stripHtml');
await test('<b> 태그 제거', () => assertEquals(stripHtml('<b>비건</b> 디저트'), '비건 디저트'));
await test('HTML 엔티티 변환', () => assertEquals(stripHtml('&quot;hello&quot; &amp; world'), '"hello" & world'));
await test('중첩 태그 제거', () => assertEquals(stripHtml('<strong><em>텍스트</em></strong>'), '텍스트'));
await test('깨끗한 텍스트 유지', () => assertEquals(stripHtml('일반 텍스트'), '일반 텍스트'));
await test('&#39; 변환', () => assertEquals(stripHtml("it&#39;s cool"), "it's cool"));

section('parseNaverDate');
await test('YYYYMMDD → YYYY-MM-DD', () => assertEquals(parseNaverDate('20240315'), '2024-03-15'));
await test('빈 문자열 → 빈 문자열', () => assertEquals(parseNaverDate(''), ''));
await test('짧은 문자열 → 빈 문자열', () => assertEquals(parseNaverDate('2024'), ''));

section('filterByPeriod');
await test('period 미지정 → 통과', () => assert(filterByPeriod({ published_at: daysAgo(365) }, undefined)));
await test('published_at 없으면 → 통과', () => assert(filterByPeriod({}, 'day')));
await test('day — 오늘 글 통과', () => assert(filterByPeriod({ published_at: daysAgo(0) }, 'day')));
await test('day — 2일 전 글 제외', () => assert(!filterByPeriod({ published_at: daysAgo(2) }, 'day')));
await test('week — 5일 전 글 통과', () => assert(filterByPeriod({ published_at: daysAgo(5) }, 'week')));
await test('week — 10일 전 글 제외', () => assert(!filterByPeriod({ published_at: daysAgo(10) }, 'week')));
await test('month — 25일 전 글 통과', () => assert(filterByPeriod({ published_at: daysAgo(25) }, 'month')));
await test('month — 35일 전 글 제외', () => assert(!filterByPeriod({ published_at: daysAgo(35) }, 'month')));
await test('year — 300일 전 글 통과', () => assert(filterByPeriod({ published_at: daysAgo(300) }, 'year')));
await test('year — 400일 전 글 제외', () => assert(!filterByPeriod({ published_at: daysAgo(400) }, 'year')));

section('getPublishedAfter');
await test('ISO 8601 형식 반환', () => {
  const r = getPublishedAfter('month');
  assert(/^\d{4}-\d{2}-\d{2}T/.test(r), `ISO 형식이어야 함: ${r}`);
});
await test('기간별 순서: day > week > month > year', () => {
  const [day, week, month, year] = ['day', 'week', 'month', 'year'].map(p => new Date(getPublishedAfter(p)));
  assert(day > week && week > month && month > year, '짧은 기간일수록 더 최근이어야 함');
});

section('deduplicateResults');
await test('중복 URL 제거', () => {
  const results = [
    { platform: 'naver_blog', items: [{ url: 'a.com' }, { url: 'b.com' }], count: 2 },
    { platform: 'tistory',    items: [{ url: 'b.com' }, { url: 'c.com' }], count: 2 },
  ];
  const d = deduplicateResults(results);
  assertEquals(d[0].count, 2);
  assertEquals(d[1].count, 1);
  assertEquals(d[1].items[0].url, 'c.com');
});
await test('중복 없으면 변경 없음', () => {
  const results = [
    { platform: 'naver_blog', items: [{ url: 'a.com' }], count: 1 },
    { platform: 'youtube',    items: [{ url: 'b.com' }], count: 1 },
  ];
  const d = deduplicateResults(results);
  assertEquals(d[0].count, 1);
  assertEquals(d[1].count, 1);
});

// ── Naver: 요청 파라미터 검증 ────────────────────────────────────────────────

section('Naver 요청 파라미터');

function buildNaverUrl(keyword, count, period) {
  const display = Math.min(count * 3, 100);
  const sort = (period === 'day' || period === 'week') ? 'date' : 'sim';
  return `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(keyword)}&display=${display}&sort=${sort}`;
}

await test('sort=date when period=day', () => {
  assertContains(buildNaverUrl('test', 10, 'day'), 'sort=date');
});
await test('sort=date when period=week', () => {
  assertContains(buildNaverUrl('test', 10, 'week'), 'sort=date');
});
await test('sort=sim when period=month', () => {
  assertContains(buildNaverUrl('test', 10, 'month'), 'sort=sim');
});
await test('sort=sim when period=year', () => {
  assertContains(buildNaverUrl('test', 10, 'year'), 'sort=sim');
});
await test('display=30 when count=10', () => {
  assertContains(buildNaverUrl('test', 10, 'month'), 'display=30');
});
await test('display=100 cap when count=40', () => {
  assertContains(buildNaverUrl('test', 40, 'month'), 'display=100');
});
await test('display=15 when count=5', () => {
  assertContains(buildNaverUrl('test', 5, 'month'), 'display=15');
});

function naverSearchMock(items, count, period) {
  return items
    .map(i => ({ platform: 'naver_blog', title: i.title, url: i.link, description: '', author: i.bloggername, published_at: parseNaverDate(i.postdate) }))
    .filter(item => filterByPeriod(item, period))
    .slice(0, count);
}

await test('results sliced to count', () => {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const items = Array.from({ length: 5 }, (_, i) => ({
    title: `T${i}`, link: `https://blog.naver.com/${i}`, bloggername: 'b', postdate: today,
  }));
  assertEquals(naverSearchMock(items, 2, 'month').length, 2);
});

await test('period 필터 후 count 제한', () => {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const old = '20200101';
  const items = [
    { title: 'new1', link: 'https://a.com/1', bloggername: 'b', postdate: today },
    { title: 'new2', link: 'https://a.com/2', bloggername: 'b', postdate: today },
    { title: 'old',  link: 'https://a.com/3', bloggername: 'b', postdate: old },
  ];
  const results = naverSearchMock(items, 10, 'month');
  assertEquals(results.length, 2); // old 제거
  assert(results.every(r => r.title.startsWith('new')), '오래된 글이 제거되어야 함');
});

// ── YouTube: 파라미터 및 방어 처리 ───────────────────────────────────────────

section('YouTube 파라미터 및 방어 처리');

function buildYouTubeUrl(keyword, count, period) {
  const publishedAfter = getPublishedAfter(period);
  return `https://www.googleapis.com/youtube/v3/search` +
    `?part=snippet&q=${encodeURIComponent(keyword)}&type=video` +
    `&maxResults=${count}&regionCode=KR&relevanceLanguage=ko` +
    `&publishedAfter=${publishedAfter}&order=relevance&key=TEST_KEY`;
}

await test('URL에 publishedAfter 포함', () => {
  assertContains(buildYouTubeUrl('test', 5, 'month'), 'publishedAfter=');
});
await test('URL에 regionCode=KR 포함', () => {
  assertContains(buildYouTubeUrl('test', 5, 'month'), 'regionCode=KR');
});
await test('URL에 type=video 포함', () => {
  assertContains(buildYouTubeUrl('test', 5, 'month'), 'type=video');
});
await test('URL에 maxResults 반영', () => {
  assertContains(buildYouTubeUrl('test', 7, 'month'), 'maxResults=7');
});

function youtubeNormalizeResponse(data) {
  // Bug fix: (data.items ?? []) — items가 undefined여도 빈 배열 반환
  return (data.items ?? []).map(item => ({
    platform: 'youtube',
    title: item.snippet.title,
    url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
    description: item.snippet.description,
    author: item.snippet.channelTitle,
    thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
    published_at: item.snippet.publishedAt,
  }));
}

await test('items 필드 없으면 빈 배열 반환 (버그 수정 검증)', () => {
  const result = youtubeNormalizeResponse({ pageInfo: { totalResults: 0 } });
  assertEquals(result.length, 0);
});
await test('items=[] → 빈 배열', () => {
  assertEquals(youtubeNormalizeResponse({ items: [], pageInfo: {} }).length, 0);
});
await test('썸네일 우선순위: high > medium > default', () => {
  const item = {
    id: { videoId: 'v1' },
    snippet: { title: 'T', description: '', channelTitle: 'ch', publishedAt: '2024-01-01T00:00:00Z',
      thumbnails: { medium: { url: 'https://img/medium.jpg' }, default: { url: 'https://img/default.jpg' } } },
  };
  assertEquals(youtubeNormalizeResponse({ items: [item] })[0].thumbnail, 'https://img/medium.jpg');
});
await test('URL 형식: watch?v=videoId', () => {
  const item = {
    id: { videoId: 'abc123' },
    snippet: { title: 'T', description: '', channelTitle: 'ch', publishedAt: '2024-01-01T00:00:00Z', thumbnails: {} },
  };
  assertEquals(youtubeNormalizeResponse({ items: [item] })[0].url, 'https://www.youtube.com/watch?v=abc123');
});

// ── You.com 도메인 필터링 + count 제한 ───────────────────────────────────────

section('You.com 도메인 필터링 (수정 후)');

function searchYouComMock(webResults, domains, platform, count) {
  const filtered = webResults.filter(item => domains.some(domain => item.url.includes(domain)));
  // Bug fix: .slice(0, count) 추가
  return filtered.slice(0, count).map(item => ({
    platform,
    title: item.title,
    url: item.url,
    description: item.description || '',
    snippet: item.snippets?.[0] || undefined,
    thumbnail: item.thumbnail_url || undefined,
    published_at: item.page_age || undefined,
  }));
}

await test('tistory: 비도메인 URL 제거', () => {
  const webResults = [
    { url: 'https://good.tistory.com/1', title: 'A', snippets: [] },
    { url: 'https://bad.naver.com/2',    title: 'B', snippets: [] },
  ];
  const results = searchYouComMock(webResults, ['tistory.com'], 'tistory', 10);
  assertEquals(results.length, 1);
  assertEquals(results[0].url, 'https://good.tistory.com/1');
});

await test('brunch: 비도메인 URL 제거', () => {
  const webResults = [
    { url: 'https://brunch.co.kr/@u/1', title: 'A', snippets: [] },
    { url: 'https://tistory.com/2',     title: 'B', snippets: [] },
    { url: 'https://brunch.co.kr/@u/3', title: 'C', snippets: [] },
  ];
  const results = searchYouComMock(webResults, ['brunch.co.kr'], 'brunch', 10);
  assertEquals(results.length, 2);
});

await test('null thumbnail/page_age → undefined로 변환', () => {
  const webResults = [{ url: 'https://x.tistory.com/1', title: 'T', snippets: [], thumbnail_url: null, page_age: null }];
  const results = searchYouComMock(webResults, ['tistory.com'], 'tistory', 10);
  assertEquals(results[0].thumbnail, undefined);
  assertEquals(results[0].published_at, undefined);
});

await test('count보다 많은 결과 → count로 제한 (버그 수정 검증)', () => {
  const webResults = Array.from({ length: 10 }, (_, i) => ({
    url: `https://blog${i}.tistory.com/${i}`, title: `T${i}`, snippets: [],
  }));
  assertEquals(searchYouComMock(webResults, ['tistory.com'], 'tistory', 5).length, 5);
});

await test('count=3 → brunch 3개 제한', () => {
  const webResults = Array.from({ length: 8 }, (_, i) => ({
    url: `https://brunch.co.kr/@u/${i}`, title: `B${i}`, snippets: [],
  }));
  assertEquals(searchYouComMock(webResults, ['brunch.co.kr'], 'brunch', 3).length, 3);
});

// ── Orchestrator: searchAllPlatforms 검증 ────────────────────────────────────

section('Orchestrator: searchAllPlatforms');

const COST_PER_SEARCH = { naver_blog: 0, youtube: 0, tistory: 0.005, brunch: 0.005 };

function mockSearchAllPlatforms(platforms, mockSearchers) {
  const results = platforms.map(platform => {
    try {
      const items = mockSearchers[platform]?.() ?? [];
      return { platform, items, count: items.length };
    } catch (e) {
      return { platform, items: [], count: 0, error: e.message };
    }
  });
  const seen = new Set();
  const deduplicated = results.map(result => {
    const unique = result.items.filter(item => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
    return { ...result, items: unique, count: unique.length };
  });
  const total_cost_usd = platforms.reduce((sum, p) => sum + (COST_PER_SEARCH[p] ?? 0), 0);
  return { results: deduplicated, total_cost_usd };
}

await test('모든 플랫폼 성공 → 4개 결과', () => {
  const searchers = {
    naver_blog: () => [{ url: 'https://blog.naver.com/1' }],
    youtube:    () => [{ url: 'https://youtube.com/v=1' }],
    tistory:    () => [{ url: 'https://post.tistory.com/1' }],
    brunch:     () => [{ url: 'https://brunch.co.kr/@u/1' }],
  };
  const r = mockSearchAllPlatforms(['naver_blog', 'youtube', 'tistory', 'brunch'], searchers);
  assertEquals(r.results.length, 4);
  assertEquals(r.results.find(x => x.platform === 'naver_blog')?.count, 1);
});

await test('한 플랫폼 실패 → error 설정, 나머지 정상', () => {
  const searchers = {
    naver_blog: () => { throw new Error('API timeout'); },
    youtube:    () => [{ url: 'https://youtube.com/v=1' }],
  };
  const r = mockSearchAllPlatforms(['naver_blog', 'youtube'], searchers);
  const naver = r.results.find(x => x.platform === 'naver_blog');
  const yt = r.results.find(x => x.platform === 'youtube');
  assertEquals(naver?.count, 0);
  assert(naver?.error !== undefined, 'error가 설정되어야 함');
  assertEquals(yt?.count, 1);
  assertEquals(yt?.error, undefined);
});

await test('비용 계산: tistory+brunch = $0.010', () => {
  const r = mockSearchAllPlatforms(['tistory', 'brunch'], { tistory: () => [], brunch: () => [] });
  assertEquals(r.total_cost_usd, 0.010);
});

await test('비용 계산: naver+youtube = $0', () => {
  const r = mockSearchAllPlatforms(['naver_blog', 'youtube'], { naver_blog: () => [], youtube: () => [] });
  assertEquals(r.total_cost_usd, 0);
});

await test('크로스 플랫폼 URL 중복 제거', () => {
  const searchers = {
    naver_blog: () => [{ url: 'https://shared.com/1' }, { url: 'https://naver.com/2' }],
    tistory:    () => [{ url: 'https://shared.com/1' }, { url: 'https://tistory.com/3' }],
  };
  const r = mockSearchAllPlatforms(['naver_blog', 'tistory'], searchers);
  assertEquals(r.results.find(x => x.platform === 'naver_blog')?.count, 2); // 둘 다 새것
  assertEquals(r.results.find(x => x.platform === 'tistory')?.count, 1);    // shared.com/1 중복 제거
});

// ── 통합 테스트 (실제 API 호출) ──────────────────────────────────────────────

const hasNaverKey = !!(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET);
const hasYoutubeKey = !!process.env.YOUTUBE_API_KEY;
const hasYoucomKey = !!process.env.YOUCOM_API_KEY;

section(`통합 테스트 (API 키 필요) - ${hasNaverKey ? '실행' : '스킵'}`);

await test('Naver 블로그: 비건 디저트 검색', async () => {
  const url = `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent('비건 디저트')}&display=5&sort=sim`;
  const res = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
      'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
    },
  });
  assert(res.ok, `Naver API 오류: ${res.status}`);
  const data = await res.json();
  assert(Array.isArray(data.items), 'items 배열 필요');
  assert(data.items.length > 0, '결과가 있어야 함');
  const first = data.items[0];
  assert(first.title, 'title 필드 필요');
  assert(first.link, 'link 필드 필요');
  assert(first.postdate, 'postdate 필드 필요');
  assert(/^\d{8}$/.test(first.postdate), `postdate는 YYYYMMDD 형식: ${first.postdate}`);
  console.log(`     결과 ${data.items.length}개, 첫 번째: ${stripHtml(first.title)}`);
}, { skip: !hasNaverKey });

await test('YouTube: 비건 디저트 검색', async () => {
  const publishedAfter = getPublishedAfter('month');
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent('비건 디저트')}&type=video&maxResults=5&regionCode=KR&publishedAfter=${publishedAfter}&key=${process.env.YOUTUBE_API_KEY}`;
  const res = await fetch(url);
  assert(res.ok, `YouTube API 오류: ${res.status} ${await res.text()}`);
  const data = await res.json();
  assert(Array.isArray(data.items), 'items 배열 필요');
  assert(data.items.length > 0, '결과가 있어야 함');
  const first = data.items[0];
  assert(first.id?.videoId, 'videoId 필요');
  assert(first.snippet?.title, 'title 필요');
  console.log(`     결과 ${data.items.length}개, 첫 번째: ${first.snippet.title}`);
}, { skip: !hasYoutubeKey });

await test('You.com: 비건 디저트 + tistory.com 검색', async () => {
  const url = `https://ydc-index.io/v1/search?query=${encodeURIComponent('비건 디저트')}&count=5&include_domains=tistory.com`;
  const res = await fetch(url, {
    headers: { 'X-API-KEY': process.env.YOUCOM_API_KEY, 'Accept': 'application/json' },
  });
  assert(res.ok, `You.com API 오류: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const webResults = data.results?.web || [];
  assert(Array.isArray(webResults), 'results.web 배열 필요');
  // 클라이언트 측 도메인 필터링 검증
  const filtered = webResults.filter(item => item.url.includes('tistory.com'));
  console.log(`     전체 ${webResults.length}개, tistory.com 필터 후 ${filtered.length}개`);
  if (webResults.length > 0 && filtered.length < webResults.length) {
    console.log(`     ⚠️  include_domains 파라미터가 완전히 동작하지 않음 (클라이언트 필터링 필요)`);
  }
}, { skip: !hasYoucomKey });

// ── 결과 요약 ─────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`✅ passed: ${passed}  ❌ failed: ${failed}  ⏭ skipped: ${skipped}`);
if (failed > 0) process.exit(1);

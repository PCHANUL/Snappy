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

// ── errors: 에러 클래스 + errorToResponse ────────────────────────────────────

section('에러 클래스');

class AppError extends Error {
  constructor(message, code, statusCode = 500, userMessage) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.userMessage = userMessage;
  }
}
class ValidationError extends AppError {
  constructor(message, userMessage) {
    super(message, 'VALIDATION_ERROR', 400, userMessage ?? message);
  }
}
class AuthError extends AppError {
  constructor(msg = 'Authentication failed') {
    super(msg, 'AUTH_ERROR', 401, '인증에 실패했습니다.');
  }
}
class QuotaExceededError extends AppError {
  constructor(limit) {
    super(`Daily quota exceeded: ${limit}`, 'QUOTA_EXCEEDED', 429, `일일 검색 한도(${limit}회)를 초과했습니다.`);
  }
}
class ExternalApiError extends AppError {
  constructor(api, message) {
    super(`${api} API error: ${message}`, 'EXTERNAL_API_ERROR', 502);
  }
}

function errorToResponse(error) {
  if (error instanceof AppError) {
    return { status: error.statusCode, body: { error: error.code, message: error.userMessage ?? error.message } };
  }
  return { status: 500, body: { error: 'INTERNAL_ERROR', message: '서버 오류가 발생했습니다.' } };
}

await test('ValidationError: statusCode=400', () => assertEquals(new ValidationError('bad').statusCode, 400));
await test('AuthError: statusCode=401', () => assertEquals(new AuthError().statusCode, 401));
await test('QuotaExceededError: statusCode=429', () => assertEquals(new QuotaExceededError(5).statusCode, 429));
await test('ExternalApiError: statusCode=502', () => assertEquals(new ExternalApiError('Naver', 'err').statusCode, 502));
await test('ValidationError: userMessage 분리', () => {
  const e = new ValidationError('internal', '사용자 안내');
  assertEquals(e.userMessage, '사용자 안내');
});
await test('QuotaExceededError: 한도 수 포함', () => {
  assert(new QuotaExceededError(3).userMessage?.includes('3'), '한도 3 포함');
});
await test('errorToResponse: ValidationError → 400 + VALIDATION_ERROR', () => {
  const r = errorToResponse(new ValidationError('bad', '잘못된 요청'));
  assertEquals(r.status, 400);
  assertEquals(r.body.error, 'VALIDATION_ERROR');
  assertEquals(r.body.message, '잘못된 요청');
});
await test('errorToResponse: 알 수 없는 Error → 500 + INTERNAL_ERROR', () => {
  const r = errorToResponse(new Error('unexpected'));
  assertEquals(r.status, 500);
  assertEquals(r.body.error, 'INTERNAL_ERROR');
});

// ── types: getEffectiveTier ───────────────────────────────────────────────────

section('getEffectiveTier');

function getEffectiveTier(tier, expiresAt) {
  if (!expiresAt) return tier;
  const GRACE_MS = 7 * 24 * 60 * 60 * 1000;
  if (Date.now() > new Date(expiresAt).getTime() + GRACE_MS) return 'free';
  return tier;
}
function daysFromNow(n) {
  const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString();
}

await test('만료일 없으면 원래 티어', () => assertEquals(getEffectiveTier('premium', null), 'premium'));
await test('유효한 구독 → 원래 티어', () => assertEquals(getEffectiveTier('standard', daysFromNow(30)), 'standard'));
await test('만료 직후 (1일) → 유예 기간 내 → 원래 티어', () => assertEquals(getEffectiveTier('standard', daysAgo(1)), 'standard'));
await test('만료 후 6일 → 유예 기간 내 → 원래 티어', () => assertEquals(getEffectiveTier('premium', daysAgo(6)), 'premium'));
await test('만료 후 8일 → 유예 기간 초과 → free', () => assertEquals(getEffectiveTier('standard', daysAgo(8)), 'free'));
await test('만료 후 365일 → free', () => assertEquals(getEffectiveTier('premium', daysAgo(365)), 'free'));

// ── crypto: encrypt/decrypt (WebCrypto) ──────────────────────────────────────

section('crypto: encryptNotionKey / decryptNotionKey');

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function getTestKey() {
  const secret = 'test-secret-32-chars-long-abcdefg';
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptKey(value) {
  const key = await getTestKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(value));
  const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
  return `v1:${toB64(iv)}:${toB64(new Uint8Array(encrypted))}`;
}

async function decryptKey(value) {
  const parts = value.split(':');
  if (parts.length !== 3 || parts[0] !== 'v1') throw new Error('Unsupported encrypted Notion key format');
  const key = await getTestKey();
  const fromB64 = (s) => { const b = atob(s); return Uint8Array.from(b, c => c.charCodeAt(0)); };
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(parts[1]) }, key, fromB64(parts[2]));
  return decoder.decode(decrypted);
}

await test('encryptKey: v1:iv:ciphertext 형식 반환', async () => {
  const result = await encryptKey('test-api-key');
  const parts = result.split(':');
  assertEquals(parts.length, 3);
  assertEquals(parts[0], 'v1');
  assert(parts[1].length > 0);
  assert(parts[2].length > 0);
});
await test('encryptKey: 동일 입력도 매번 다른 결과 (랜덤 IV)', async () => {
  const r1 = await encryptKey('key');
  const r2 = await encryptKey('key');
  assert(r1 !== r2, '랜덤 IV로 인해 다른 결과여야 함');
});
await test('라운드트립: 암호화 → 복호화 = 원본', async () => {
  const original = 'secret:notion:api:key';
  assertEquals(await decryptKey(await encryptKey(original)), original);
});
await test('라운드트립: 한국어 문자열', async () => {
  const original = '비건디저트secret키';
  assertEquals(await decryptKey(await encryptKey(original)), original);
});
await test('잘못된 형식 → 에러', async () => {
  let threw = false;
  try { await decryptKey('invalid'); } catch { threw = true; }
  assert(threw, '잘못된 형식은 에러 필요');
});
await test('v2 접두어 → 에러', async () => {
  let threw = false;
  try { await decryptKey('v2:abc:def'); } catch { threw = true; }
  assert(threw, '지원 안 하는 버전은 에러 필요');
});

// ── notion/blocks: buildResultBlocks 구조 검증 ───────────────────────────────

section('notion/blocks: 블록 생성');

function makeBlock(platform, items, error) {
  return { platform, items: items || [], count: (items || []).length, error };
}
function makeItem(platform, overrides = {}) {
  return { platform, title: `${platform} 제목`, url: `https://ex.com/${platform}`, description: '설명', ...overrides };
}

function buildCallout(text, emoji) {
  return { object: 'block', type: 'callout', callout: { rich_text: [{ type: 'text', text: { content: text } }], icon: { type: 'emoji', emoji }, color: 'gray_background' } };
}
function buildHeading2(text) {
  return { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: text } }] } };
}
function buildDivider() { return { object: 'block', type: 'divider', divider: {} }; }
function buildParagraph(text, color) {
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: text } }], ...(color && { color }) } };
}
function buildToggle(title, children) {
  return { object: 'block', type: 'toggle', toggle: { rich_text: [{ type: 'text', text: { content: title }, annotations: { bold: true } }], children } };
}

const PLATFORM_INFO = {
  naver_blog: { name: '네이버 블로그', emoji: '📝' },
  youtube:    { name: '유튜브', emoji: '🎥' },
  tistory:    { name: '티스토리', emoji: '📚' },
  brunch:     { name: '브런치', emoji: '✍️' },
};

function buildResultBlocksMock(keyword, results, meta) {
  const totalCount = results.reduce((s, r) => s + r.count, 0);
  const summaryParts = results.map(r => {
    const info = PLATFORM_INFO[r.platform];
    return r.error ? `${info.emoji} ${info.name} ⚠️` : `${info.emoji} ${info.name} ${r.count}개`;
  });
  const blocks = [
    buildCallout(`🔍 "${keyword}" — ${totalCount}개 발견 | ${(meta.duration_ms / 1000).toFixed(1)}초`, '🔍'),
    buildParagraph(summaryParts.join('  ·  '), 'gray'),
    buildDivider(),
  ];
  for (const result of results) {
    const info = PLATFORM_INFO[result.platform];
    if (result.items.length === 0) {
      const msg = result.error ? `⚠️ 검색 실패: ${result.error}` : '결과를 찾지 못했습니다.';
      blocks.push(buildToggle(`${info.emoji} ${info.name}`, [buildParagraph(msg, 'gray')]));
    } else {
      blocks.push(buildHeading2(`${info.emoji} ${info.name} (${result.count}개)`));
      for (const item of result.items) {
        blocks.push({ type: 'bulleted_list_item', title: item.title });
        if (item.thumbnail) blocks.push({ type: 'image', image: { type: 'external', external: { url: item.thumbnail } } });
      }
      blocks.push(buildDivider());
    }
  }
  return blocks;
}

await test('buildResultBlocks: 배열 반환', () => {
  const r = buildResultBlocksMock('키워드', [makeBlock('naver_blog', [makeItem('naver_blog')])], { duration_ms: 1500, cost_usd: 0 });
  assert(Array.isArray(r) && r.length > 0);
});
await test('buildResultBlocks: 첫 블록 callout에 키워드 포함', () => {
  const r = buildResultBlocksMock('비건 디저트', [makeBlock('youtube', [makeItem('youtube')])], { duration_ms: 1000, cost_usd: 0 });
  assertEquals(r[0].type, 'callout');
  assert(r[0].callout.rich_text[0].text.content.includes('비건 디저트'));
});
await test('buildResultBlocks: 빈 플랫폼 → toggle 블록', () => {
  const r = buildResultBlocksMock('test', [makeBlock('naver_blog', [])], { duration_ms: 500, cost_usd: 0 });
  assert(r.some(b => b.type === 'toggle'), 'toggle 블록 존재');
});
await test('buildResultBlocks: 오류 플랫폼 → ⚠️ 메시지', () => {
  const r = buildResultBlocksMock('test', [makeBlock('naver_blog', [], '서버 오류')], { duration_ms: 500, cost_usd: 0 });
  const toggles = r.filter(b => b.type === 'toggle');
  assert(toggles[0].toggle.children[0].paragraph.rich_text[0].text.content.includes('검색 실패'));
});
await test('buildResultBlocks: 결과 있는 플랫폼 → heading_2 블록', () => {
  const r = buildResultBlocksMock('test', [makeBlock('tistory', [makeItem('tistory')])], { duration_ms: 500, cost_usd: 0 });
  assert(r.some(b => b.type === 'heading_2'), 'heading_2 존재');
});
await test('buildResultBlocks: 썸네일 있으면 image 블록', () => {
  const item = makeItem('youtube', { thumbnail: 'https://img.yt/th.jpg' });
  const r = buildResultBlocksMock('test', [makeBlock('youtube', [item])], { duration_ms: 500, cost_usd: 0 });
  assert(r.some(b => b.type === 'image'), 'image 블록 존재');
});

function buildLoadMoreCalloutMock(remaining) {
  return buildCallout(`📄 ${remaining}개 결과가 더 있습니다 — DB에서 '📄 더보기' 버튼을 클릭하세요`, '📄');
}

await test('buildLoadMoreCallout: callout 블록 반환', () => {
  assertEquals(buildLoadMoreCalloutMock(10).type, 'callout');
});
await test('buildLoadMoreCallout: 남은 개수 포함', () => {
  assert(buildLoadMoreCalloutMock(7).callout.rich_text[0].text.content.includes('7'));
});

// ── 통합 테스트 (실제 API 호출) ──────────────────────────────────────────────

const hasNaverKey = !!(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET);
const hasYoutubeKey = !!process.env.YOUTUBE_API_KEY;
const hasYoucomKey = !!process.env.YOUCOM_API_KEY;
const hasNotionKey = !!process.env.NOTION_API_KEY;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const NOTION_STATUS_FALLBACK = {
  '대기': 'Not started',
  '검색중': 'In progress',
  '완료': 'Done',
  '실패': 'Done',
};

function toNotionUuid(id) {
  const s = id.replace(/-/g, '');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

function extractNotionId(value) {
  const raw = String(value || '');
  const uuidMatch = raw.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  if (uuidMatch) return toNotionUuid(uuidMatch[0]);

  const compactMatch = raw.match(/[0-9a-fA-F]{32}/);
  return compactMatch ? toNotionUuid(compactMatch[0]) : '';
}

function getConfiguredTemplatePageId() {
  try {
    const configPath = path.join(ROOT, 'docs', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return extractNotionId(config.template_url);
  } catch {
    return '';
  }
}

async function notionRequest(endpoint, init = {}, retries = 2) {
  const body = typeof init.body === 'string'
    ? init.body
    : init.body === undefined
      ? undefined
      : JSON.stringify(init.body);

  const res = await fetch(`https://api.notion.com/v1/${endpoint}`, {
    ...init,
    body,
    headers: {
      'Authorization': `Bearer ${process.env.NOTION_API_KEY}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
      ...(init.headers || {}),
    },
  });

  if (!res.ok) {
    if (retries > 0 && (res.status === 429 || res.status >= 500)) {
      await sleep(res.status === 429 ? 1500 : 800);
      return notionRequest(endpoint, init, retries - 1);
    }
    throw new Error(`Notion API 오류: ${res.status} ${await res.text()}`);
  }
  if (res.status === 204) return null;
  return await res.json();
}

async function notionFetch(endpoint) {
  return notionRequest(endpoint);
}

async function getAllNotionChildren(blockId) {
  const children = [];
  let cursor = '';
  do {
    const qs = new URLSearchParams({ page_size: '100' });
    if (cursor) qs.set('start_cursor', cursor);
    const data = await notionFetch(`blocks/${blockId}/children?${qs.toString()}`);
    children.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : '';
  } while (cursor);
  return children;
}

async function ensureSearchDatabaseId() {
  if (notionContext.searchDbId) return notionContext.searchDbId;
  const children = notionContext.children || await getAllNotionChildren(notionTemplatePageId);
  notionContext.children = children;
  const searchDb = children.find(block =>
    block.type === 'child_database' && block.child_database?.title === '검색 DB'
  );
  assert(searchDb, '검색 DB child_database 블록이 필요합니다.');
  notionContext.searchDbId = searchDb.id;
  return searchDb.id;
}

function notionText(content) {
  return [{ type: 'text', text: { content: String(content || '') } }];
}

function notionParagraph(content, color) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: notionText(content),
      ...(color && { color }),
    },
  };
}

function notionCallout(content, emoji) {
  return {
    object: 'block',
    type: 'callout',
    callout: {
      rich_text: notionText(content),
      icon: { type: 'emoji', emoji },
      color: 'gray_background',
    },
  };
}

function notionDivider() {
  return { object: 'block', type: 'divider', divider: {} };
}

function truncateNotionText(value, max = 1900) {
  const text = String(value || '').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function getNotionTitle(page, propertyName = '키워드') {
  const title = page.properties?.[propertyName]?.title || [];
  return title.map(part => part.plain_text || part.text?.content || '').join('');
}

async function fetchNaverResultForNotionTest(keyword) {
  const url = `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(keyword)}&display=1&sort=sim`;
  const res = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
      'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
    },
  });
  if (!res.ok) {
    throw new Error(`Naver API 오류: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const first = data.items?.[0];
  assert(first, 'Notion 생성에 사용할 Naver 검색 결과가 필요합니다.');
  return {
    platform: 'naver_blog',
    title: truncateNotionText(stripHtml(first.title || 'Naver 검색 결과')),
    url: first.link || 'https://example.com/snappy-test-result',
    description: truncateNotionText(stripHtml(first.description || ''), 500),
    author: stripHtml(first.bloggername || ''),
    published_at: parseNaverDate(first.postdate),
  };
}

async function createNotionSearchEntryForTest(databaseId, keyword) {
  const statusName = await getNotionStatusNameForTest(databaseId, '검색중');
  const data = await notionRequest('pages', {
    method: 'POST',
    body: {
      parent: { database_id: toNotionUuid(databaseId) },
      icon: { type: 'emoji', emoji: '🔍' },
      properties: {
        '키워드': { title: notionText(keyword) },
        '상태': { status: { name: statusName } },
        '매체': { multi_select: [{ name: '네이버블로그' }] },
        '기간': { select: { name: '1개월' } },
      },
    },
  });
  return data.id;
}

async function createNotionResultSubPageForTest(parentPageId, item) {
  const metaParts = ['📝 네이버 블로그'];
  if (item.author) metaParts.push(`👤 ${item.author}`);
  if (item.published_at) metaParts.push(`📅 ${item.published_at}`);

  const children = [
    notionParagraph(metaParts.join('  •  '), 'gray'),
    { object: 'block', type: 'bookmark', bookmark: { url: item.url } },
  ];
  if (item.description) children.push(notionParagraph(item.description));

  return notionRequest('pages', {
    method: 'POST',
    body: {
      parent: { page_id: parentPageId },
      icon: { type: 'emoji', emoji: '📝' },
      properties: {
        title: { title: notionText(item.title) },
      },
      children,
    },
  });
}

async function getNotionStatusNameForTest(databaseId, status) {
  if (!notionContext.statusOptions) {
    const db = await notionFetch(`databases/${databaseId}`);
    notionContext.statusOptions = db.properties?.['상태']?.status?.options?.map(option => option.name) || [];
  }

  if (notionContext.statusOptions.includes(status)) return status;

  const fallback = NOTION_STATUS_FALLBACK[status];
  if (fallback && notionContext.statusOptions.includes(fallback)) return fallback;

  return status;
}

async function completeNotionSearchEntryForTest(databaseId, pageId, keyword, item) {
  const statusName = await getNotionStatusNameForTest(databaseId, '완료');
  await notionRequest(`pages/${pageId}`, {
    method: 'PATCH',
    body: {
      properties: {
        '상태': { status: { name: statusName } },
        '발견 콘텐츠 수': { number: 1 },
      },
    },
  });

  await notionRequest(`blocks/${pageId}/children`, {
    method: 'PATCH',
    body: {
      children: [
        notionCallout(`🔍 "${keyword}" — 1개 발견 | 통합 테스트`, '🔍'),
        notionParagraph('📝 네이버 블로그 1개', 'gray'),
        notionDivider(),
      ],
    },
  });

  const resultPage = await createNotionResultSubPageForTest(pageId, item);
  return { statusName, resultPage };
}

async function archiveNotionPage(pageId) {
  await notionRequest(`pages/${pageId}`, {
    method: 'PATCH',
    body: { archived: true },
  });
}

const notionTemplatePageId = getConfiguredTemplatePageId();
const shouldSkipNotion = !hasNotionKey || !notionTemplatePageId;
const notionContext = { children: null, searchDbId: '', statusOptions: null };

section('통합 테스트 (실제 API 호출)');

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
  if (!res.ok) {
    throw new Error(`YouTube API 오류: ${res.status} ${await res.text()}`);
  }
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
  if (!res.ok) {
    throw new Error(`You.com API 오류: ${res.status} ${await res.text()}`);
  }
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

await test('Notion: config 템플릿 페이지 조회', async () => {
  const page = await notionFetch(`pages/${notionTemplatePageId}`);
  assertEquals(page.object, 'page');
  assert(page.id === notionTemplatePageId, `페이지 ID 불일치: ${page.id}`);
  console.log(`     페이지 조회 성공: ${page.id}`);
}, { skip: shouldSkipNotion });

await test('Notion: 템플릿 children에 검색 embed와 검색 DB 존재', async () => {
  const children = await getAllNotionChildren(notionTemplatePageId);
  notionContext.children = children;

  const searchEmbed = children.find(block =>
    block.type === 'embed' && typeof block.embed?.url === 'string' && block.embed.url.includes('search.html')
  );
  const searchDb = children.find(block =>
    block.type === 'child_database' && block.child_database?.title === '검색 DB'
  );

  assert(searchEmbed, 'search.html embed 블록이 필요합니다.');
  assert(searchDb, '검색 DB child_database 블록이 필요합니다.');

  notionContext.searchDbId = searchDb.id;
  console.log(`     children ${children.length}개, 검색 DB: ${searchDb.id}`);
}, { skip: shouldSkipNotion });

await test('Notion: 검색 DB 스키마 확인', async () => {
  const searchDbId = await ensureSearchDatabaseId();

  const db = await notionFetch(`databases/${searchDbId}`);
  assertEquals(db.object, 'database');

  const props = db.properties || {};
  const expected = {
    '키워드': 'title',
    '매체': 'multi_select',
    '기간': 'select',
    '상태': 'status',
    '발견 콘텐츠 수': 'number',
    '검색일시': 'created_time',
  };

  for (const [name, type] of Object.entries(expected)) {
    assert(props[name], `검색 DB 속성 누락: ${name}`);
    assertEquals(props[name].type, type, `${name} 속성 타입`);
  }
  notionContext.statusOptions = props['상태']?.status?.options?.map(option => option.name) || [];

  console.log(`     검색 DB 속성 ${Object.keys(props).length}개 확인`);
}, { skip: shouldSkipNotion });

await test('Notion: 검색 결과를 검색 DB 페이지와 하위 결과 페이지로 생성', async () => {
  const searchDbId = await ensureSearchDatabaseId();
  const searchKeyword = '비건 디저트';
  const testKeyword = `[TEST] ${searchKeyword} ${new Date().toISOString()}`;
  let searchPageId = '';

  try {
    const item = await fetchNaverResultForNotionTest(searchKeyword);

    searchPageId = await createNotionSearchEntryForTest(searchDbId, testKeyword);
    const { statusName } = await completeNotionSearchEntryForTest(searchDbId, searchPageId, testKeyword, item);

    const page = await notionFetch(`pages/${searchPageId}`);
    assertEquals(page.properties?.['상태']?.status?.name, statusName, '검색 페이지 상태');
    assertEquals(page.properties?.['발견 콘텐츠 수']?.number, 1, '발견 콘텐츠 수');
    assert(getNotionTitle(page).includes(testKeyword), '검색 DB 행 제목에 테스트 키워드가 필요합니다.');

    const children = await getAllNotionChildren(searchPageId);
    const summary = children.find(block =>
      block.type === 'callout' &&
      block.callout?.rich_text?.some(part => (part.plain_text || '').includes(testKeyword))
    );
    const resultPage = children.find(block => block.type === 'child_page');

    assert(summary, '검색 요약 callout 블록이 필요합니다.');
    assert(resultPage, '검색 결과 child_page가 필요합니다.');
    assert(resultPage.child_page?.title, '검색 결과 child_page 제목이 필요합니다.');

    console.log(`     임시 검색 페이지 생성/검증 후 archive 예정: ${searchPageId}`);
  } finally {
    if (searchPageId) {
      await archiveNotionPage(searchPageId);
      console.log(`     임시 검색 페이지 archive 완료: ${searchPageId}`);
    }
  }
}, { skip: shouldSkipNotion || !hasNaverKey });

// ── 결과 요약 ─────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`✅ passed: ${passed}  ❌ failed: ${failed}  ⏭ skipped: ${skipped}`);
if (failed > 0) process.exit(1);

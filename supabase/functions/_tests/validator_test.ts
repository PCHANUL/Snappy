import { assertEquals, assertThrows } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { validateMinimalRequest, validateSearchRequest } from '../_core/validator.ts';

// ── validateMinimalRequest ────────────────────────────────────────────────────

Deno.test('validateMinimalRequest: 정상 입력', () => {
  const result = validateMinimalRequest({ user_id: 'abc', notion_page_id: 'page1' });
  assertEquals(result.user_id, 'abc');
  assertEquals(result.notion_page_id, 'page1');
});

Deno.test('validateMinimalRequest: user_id 누락 → 에러', () => {
  assertThrows(
    () => validateMinimalRequest({ notion_page_id: 'page1' }),
    Error,
    'user_id',
  );
});

Deno.test('validateMinimalRequest: notion_page_id 누락 → 에러', () => {
  assertThrows(
    () => validateMinimalRequest({ user_id: 'abc' }),
    Error,
    'notion_page_id',
  );
});

Deno.test('validateMinimalRequest: null body → 에러', () => {
  assertThrows(() => validateMinimalRequest(null), Error);
});

// ── validateSearchRequest ─────────────────────────────────────────────────────

Deno.test('validateSearchRequest: 정상 입력 (기본값 적용)', () => {
  const result = validateSearchRequest({
    user_id: 'u1',
    notion_page_id: 'p1',
    keyword: '비건 디저트',
    platforms: ['naver_blog', 'youtube', 'youtube_shorts'],
  });
  assertEquals(result.keyword, '비건 디저트');
  assertEquals(result.platforms, ['naver_blog', 'youtube', 'youtube_shorts']);
  assertEquals(result.period, 'month');       // 기본값
  assertEquals(result.result_count, 10);      // 기본값
});

Deno.test('validateSearchRequest: 키워드 앞뒤 공백 제거', () => {
  const result = validateSearchRequest({
    user_id: 'u1',
    notion_page_id: 'p1',
    keyword: '  테스트  ',
    platforms: ['youtube'],
  });
  assertEquals(result.keyword, '테스트');
});

Deno.test('validateSearchRequest: 키워드 100자 초과 → 에러', () => {
  assertThrows(
    () => validateSearchRequest({
      user_id: 'u1',
      notion_page_id: 'p1',
      keyword: 'a'.repeat(101),
      platforms: ['youtube'],
    }),
    Error,
  );
});

Deno.test('validateSearchRequest: 잘못된 platform 필터링 후 유효값 없으면 에러', () => {
  assertThrows(
    () => validateSearchRequest({
      user_id: 'u1',
      notion_page_id: 'p1',
      keyword: '테스트',
      platforms: ['instagram', 'facebook'],
    }),
    Error,
  );
});

Deno.test('validateSearchRequest: 잘못된 platform 혼재 시 유효값만 남김', () => {
  const result = validateSearchRequest({
    user_id: 'u1',
    notion_page_id: 'p1',
    keyword: '테스트',
    platforms: ['youtube', 'invalid_platform'],
  });
  assertEquals(result.platforms, ['youtube']);
});

Deno.test('validateSearchRequest: 유효한 period 값', () => {
  for (const period of ['day', 'week', 'month', 'year']) {
    const result = validateSearchRequest({
      user_id: 'u1',
      notion_page_id: 'p1',
      keyword: '테스트',
      platforms: ['youtube'],
      period,
    });
    assertEquals(result.period, period);
  }
});

Deno.test('validateSearchRequest: 잘못된 period → 에러', () => {
  assertThrows(
    () => validateSearchRequest({
      user_id: 'u1',
      notion_page_id: 'p1',
      keyword: '테스트',
      platforms: ['youtube'],
      period: 'hour',
    }),
    Error,
  );
});

Deno.test('validateSearchRequest: 유효한 result_count 값', () => {
  for (const count of [5, 10, 20]) {
    const result = validateSearchRequest({
      user_id: 'u1',
      notion_page_id: 'p1',
      keyword: '테스트',
      platforms: ['youtube'],
      result_count: count,
    });
    assertEquals(result.result_count, count);
  }
});

Deno.test('validateSearchRequest: 잘못된 result_count → 에러', () => {
  assertThrows(
    () => validateSearchRequest({
      user_id: 'u1',
      notion_page_id: 'p1',
      keyword: '테스트',
      platforms: ['youtube'],
      result_count: 15,
    }),
    Error,
  );
});

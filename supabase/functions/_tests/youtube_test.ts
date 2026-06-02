import './setup.ts';
import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { getPublishedAfter } from '../_search/youtube.ts';

// ── getPublishedAfter ─────────────────────────────────────────────────────────

Deno.test('getPublishedAfter: ISO 8601 형식 반환', () => {
  const result = getPublishedAfter('month');
  // ISO 8601 형식 확인 (예: "2024-02-15T12:00:00.000Z")
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(result), `ISO 형식이어야 함: ${result}`);
});

Deno.test('getPublishedAfter: day → 어제 이후', () => {
  const result = new Date(getPublishedAfter('day'));
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 2); // 여유 1일
  assert(result > yesterday, `day 기준은 약 1일 전이어야 함`);
});

Deno.test('getPublishedAfter: year → 약 1년 전', () => {
  const result = new Date(getPublishedAfter('year'));
  const expected = new Date();
  expected.setFullYear(expected.getFullYear() - 1);
  expected.setDate(expected.getDate() - 2); // 여유
  assert(result > expected, `year 기준은 약 1년 전이어야 함`);
});

Deno.test('getPublishedAfter: 기간별 순서 보장 (짧은 기간 > 긴 기간)', () => {
  const day   = new Date(getPublishedAfter('day'));
  const week  = new Date(getPublishedAfter('week'));
  const month = new Date(getPublishedAfter('month'));
  const year  = new Date(getPublishedAfter('year'));

  assert(day > week,   'day 기준 > week 기준 (더 최근)');
  assert(week > month, 'week 기준 > month 기준');
  assert(month > year, 'month 기준 > year 기준');
});

// ── searchYouTube mock 테스트 ─────────────────────────────────────────────────

Deno.test('searchYouTube: 정상 응답 파싱', async () => {
  const mockResponse = {
    items: [
      {
        id: { videoId: 'abc123' },
        snippet: {
          title: '비건 디저트 만들기',
          description: '쉽고 맛있는 비건 레시피',
          channelTitle: '요리채널',
          publishedAt: '2024-03-01T10:00:00Z',
          thumbnails: {
            high: { url: 'https://img.youtube.com/vi/abc123/hqdefault.jpg' },
          },
        },
      },
    ],
    pageInfo: { totalResults: 1, resultsPerPage: 1 },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(mockResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  try {
    const { searchYouTube } = await import('../search/youtube.ts');
    const results = await searchYouTube('비건 디저트', 5, 'month');

    assertEquals(results.length, 1);
    assertEquals(results[0].title, '비건 디저트 만들기');
    assertEquals(results[0].url, 'https://www.youtube.com/watch?v=abc123');
    assertEquals(results[0].author, '요리채널');
    assertEquals(results[0].thumbnail, 'https://img.youtube.com/vi/abc123/hqdefault.jpg');
    assertEquals(results[0].published_at, '2024-03-01T10:00:00Z');
    assertEquals(results[0].platform, 'youtube');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('searchYouTube: 빈 결과 처리', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ items: [], pageInfo: { totalResults: 0 } }), { status: 200 });

  try {
    const { searchYouTube } = await import('../search/youtube.ts');
    const results = await searchYouTube('없는키워드xyz', 5, 'day');
    assertEquals(results.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('searchYouTube: API 오류 시 ExternalApiError 발생', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { code: 403, message: 'quotaExceeded' } }), { status: 403 });
  try {
    const { searchYouTube } = await import('../search/youtube.ts');
    let threw = false;
    try {
      await searchYouTube('test', 5, 'month');
    } catch (e) {
      threw = true;
      assert((e as Error).message.includes('YouTube'), `에러 메시지에 YouTube 포함 필요: ${(e as Error).message}`);
    }
    assert(threw, 'API 오류 시 예외를 던져야 합니다');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('searchYouTube: items 필드 없으면 빈 배열 반환 (방어 처리)', async () => {
  // 할당량 초과 등으로 200이지만 items 없는 경우
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ pageInfo: { totalResults: 0 } }), { status: 200 });
  try {
    const { searchYouTube } = await import('../search/youtube.ts');
    const results = await searchYouTube('test', 5, 'month');
    assertEquals(results.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('searchYouTube: publishedAfter, regionCode, type=video 파라미터 포함', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  globalThis.fetch = async (url: string | URL | Request) => {
    capturedUrl = url.toString();
    return new Response(JSON.stringify({ items: [], pageInfo: {} }), { status: 200 });
  };
  try {
    const { searchYouTube } = await import('../search/youtube.ts');
    await searchYouTube('test', 5, 'month');
    assert(capturedUrl.includes('publishedAfter='), `publishedAfter 파라미터 필요: ${capturedUrl}`);
    assert(capturedUrl.includes('regionCode=KR'), `regionCode=KR 필요: ${capturedUrl}`);
    assert(capturedUrl.includes('type=video'), `type=video 필요: ${capturedUrl}`);
    assert(capturedUrl.includes('part=snippet'), `part=snippet 필요: ${capturedUrl}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('searchYouTube: maxResults 파라미터 반영', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  globalThis.fetch = async (url: string | URL | Request) => {
    capturedUrl = url.toString();
    return new Response(JSON.stringify({ items: [], pageInfo: {} }), { status: 200 });
  };
  try {
    const { searchYouTube } = await import('../search/youtube.ts');
    await searchYouTube('test', 7, 'month');
    assert(capturedUrl.includes('maxResults=7'), `maxResults=7 필요: ${capturedUrl}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('searchYouTube: 썸네일 우선순위 (high > medium > default)', async () => {
  const mockResponse = {
    items: [{
      id: { videoId: 'v1' },
      snippet: {
        title: 'test',
        description: '',
        channelTitle: 'ch',
        publishedAt: '2024-01-01T00:00:00Z',
        thumbnails: {
          default: { url: 'https://img/default.jpg' },
          medium:  { url: 'https://img/medium.jpg' },
          // high 없음
        },
      },
    }],
    pageInfo: { totalResults: 1 },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(mockResponse), { status: 200 });

  try {
    const { searchYouTube } = await import('../search/youtube.ts');
    const results = await searchYouTube('test', 5, 'month');
    assertEquals(results[0].thumbnail, 'https://img/medium.jpg'); // medium 사용
  } finally {
    globalThis.fetch = originalFetch;
  }
});

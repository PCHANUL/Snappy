import './setup.ts';
import { assert, assertEquals, assertArrayIncludes } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { stripHtml, parseNaverDate, filterByPeriod } from '../_search/naver.ts';
import type { ContentItem } from '../_core/types.ts';

// ── stripHtml ─────────────────────────────────────────────────────────────────

Deno.test('stripHtml: <b> 태그 제거', () => {
  assertEquals(stripHtml('<b>비건</b> 디저트'), '비건 디저트');
});

Deno.test('stripHtml: HTML 엔티티 변환', () => {
  assertEquals(stripHtml('&quot;hello&quot; &amp; &lt;world&gt;'), '"hello" & <world>');
  assertEquals(stripHtml('it&#39;s &nbsp;cool'), "it's  cool");
});

Deno.test('stripHtml: 중첩 태그 제거', () => {
  assertEquals(stripHtml('<strong><em>텍스트</em></strong>'), '텍스트');
});

Deno.test('stripHtml: 이미 깨끗한 텍스트 유지', () => {
  assertEquals(stripHtml('일반 텍스트'), '일반 텍스트');
});

// ── parseNaverDate ────────────────────────────────────────────────────────────

Deno.test('parseNaverDate: YYYYMMDD → YYYY-MM-DD', () => {
  assertEquals(parseNaverDate('20240315'), '2024-03-15');
  assertEquals(parseNaverDate('20231201'), '2023-12-01');
});

Deno.test('parseNaverDate: 빈 문자열 → 빈 문자열', () => {
  assertEquals(parseNaverDate(''), '');
});

Deno.test('parseNaverDate: 잘못된 형식 → 빈 문자열', () => {
  assertEquals(parseNaverDate('2024-03'), '');
  assertEquals(parseNaverDate('abcdefgh'), 'abcd-ef-gh'); // 형식 변환만 수행
});

// ── filterByPeriod ────────────────────────────────────────────────────────────

function makeItem(published_at: string): ContentItem {
  return { platform: 'naver_blog', title: 'T', url: 'http://x.com', description: '', published_at };
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

Deno.test('filterByPeriod: period 미지정 → 항상 통과', () => {
  assertEquals(filterByPeriod(makeItem(daysAgo(365)), undefined), true);
});

Deno.test('filterByPeriod: published_at 없으면 → 통과', () => {
  const item: ContentItem = { platform: 'naver_blog', title: 'T', url: 'http://x.com', description: '' };
  assertEquals(filterByPeriod(item, 'day'), true);
});

Deno.test('filterByPeriod: day — 오늘 글 통과', () => {
  assertEquals(filterByPeriod(makeItem(daysAgo(0)), 'day'), true);
});

Deno.test('filterByPeriod: day — 2일 전 글 제외', () => {
  assertEquals(filterByPeriod(makeItem(daysAgo(2)), 'day'), false);
});

Deno.test('filterByPeriod: week — 5일 전 글 통과', () => {
  assertEquals(filterByPeriod(makeItem(daysAgo(5)), 'week'), true);
});

Deno.test('filterByPeriod: week — 10일 전 글 제외', () => {
  assertEquals(filterByPeriod(makeItem(daysAgo(10)), 'week'), false);
});

Deno.test('filterByPeriod: month — 25일 전 글 통과', () => {
  assertEquals(filterByPeriod(makeItem(daysAgo(25)), 'month'), true);
});

Deno.test('filterByPeriod: month — 35일 전 글 제외', () => {
  assertEquals(filterByPeriod(makeItem(daysAgo(35)), 'month'), false);
});

Deno.test('filterByPeriod: year — 300일 전 글 통과', () => {
  assertEquals(filterByPeriod(makeItem(daysAgo(300)), 'year'), true);
});

Deno.test('filterByPeriod: year — 400일 전 글 제외', () => {
  assertEquals(filterByPeriod(makeItem(daysAgo(400)), 'year'), false);
});

// ── searchNaverBlog mock 테스트 ───────────────────────────────────────────────

Deno.test('searchNaverBlog: 정상 응답 파싱', async () => {
  const mockResponse = {
    items: [
      {
        title: '<b>비건</b> 디저트 레시피',
        link: 'https://blog.naver.com/test/123',
        description: '맛있는 <b>비건</b> 디저트를 만들어봤습니다.',
        bloggername: '요리블로거',
        bloggerlink: 'https://blog.naver.com/test',
        postdate: daysAgo(0).replace(/-/g, ''),
      },
      {
        title: '오래된 글',
        link: 'https://blog.naver.com/old/456',
        description: '오래된 내용',
        bloggername: '블로거',
        bloggerlink: 'https://blog.naver.com/old',
        postdate: '20200101',  // 5년 전 → month 필터에서 제외
      },
    ],
    total: 2,
    start: 1,
    display: 2,
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(mockResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  try {
    const { searchNaverBlog } = await import('../_search/naver.ts');
    const results = await searchNaverBlog('비건 디저트', 10, 'month');

    // 오래된 글은 month 필터에서 제외되어야 함
    assertEquals(results.length, 1);
    assertEquals(results[0].title, '비건 디저트 레시피');  // <b> 태그 제거
    assertEquals(results[0].url, 'https://blog.naver.com/test/123');
    assertEquals(results[0].description, '맛있는 비건 디저트를 만들어봤습니다.');
    assertEquals(results[0].author, '요리블로거');
    assertEquals(results[0].published_at, daysAgo(0));
    assertEquals(results[0].platform, 'naver_blog');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('searchNaverBlog: API 오류 시 ExternalApiError 발생', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ errorCode: '010', errorMessage: 'Not Authorized' }), {
      status: 401,
    });

  try {
    const { searchNaverBlog } = await import('../_search/naver.ts');
    let threw = false;
    try {
      await searchNaverBlog('테스트', 5, 'month');
    } catch (e) {
      threw = true;
      assertEquals((e as Error).message.includes('Naver'), true);
    }
    assertEquals(threw, true, 'API 오류 시 예외를 던져야 합니다');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── 요청 파라미터 검증 ────────────────────────────────────────────────────────

Deno.test('searchNaverBlog: sort=date when period=day', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  globalThis.fetch = async (url: string | URL | Request) => {
    capturedUrl = url.toString();
    return new Response(JSON.stringify({ items: [], total: 0, start: 1, display: 0 }), { status: 200 });
  };
  try {
    const { searchNaverBlog } = await import('../_search/naver.ts');
    await searchNaverBlog('test', 10, 'day');
    assert(capturedUrl.includes('sort=date'), `day period → date 정렬이어야 함: ${capturedUrl}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('searchNaverBlog: sort=date when period=week', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  globalThis.fetch = async (url: string | URL | Request) => {
    capturedUrl = url.toString();
    return new Response(JSON.stringify({ items: [], total: 0, start: 1, display: 0 }), { status: 200 });
  };
  try {
    const { searchNaverBlog } = await import('../_search/naver.ts');
    await searchNaverBlog('test', 10, 'week');
    assert(capturedUrl.includes('sort=date'), `week period → date 정렬이어야 함: ${capturedUrl}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('searchNaverBlog: sort=sim when period=month', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  globalThis.fetch = async (url: string | URL | Request) => {
    capturedUrl = url.toString();
    return new Response(JSON.stringify({ items: [], total: 0, start: 1, display: 0 }), { status: 200 });
  };
  try {
    const { searchNaverBlog } = await import('../_search/naver.ts');
    await searchNaverBlog('test', 10, 'month');
    assert(capturedUrl.includes('sort=sim'), `month period → sim 정렬이어야 함: ${capturedUrl}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('searchNaverBlog: sort=sim when period=year', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  globalThis.fetch = async (url: string | URL | Request) => {
    capturedUrl = url.toString();
    return new Response(JSON.stringify({ items: [], total: 0, start: 1, display: 0 }), { status: 200 });
  };
  try {
    const { searchNaverBlog } = await import('../_search/naver.ts');
    await searchNaverBlog('test', 10, 'year');
    assert(capturedUrl.includes('sort=sim'), `year period → sim 정렬이어야 함: ${capturedUrl}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('searchNaverBlog: display=30 when count=10', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  globalThis.fetch = async (url: string | URL | Request) => {
    capturedUrl = url.toString();
    return new Response(JSON.stringify({ items: [], total: 0, start: 1, display: 0 }), { status: 200 });
  };
  try {
    const { searchNaverBlog } = await import('../_search/naver.ts');
    await searchNaverBlog('test', 10, 'month');
    assert(capturedUrl.includes('display=30'), `count=10이면 display=30: ${capturedUrl}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('searchNaverBlog: display=100 cap when count=40', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  globalThis.fetch = async (url: string | URL | Request) => {
    capturedUrl = url.toString();
    return new Response(JSON.stringify({ items: [], total: 0, start: 1, display: 0 }), { status: 200 });
  };
  try {
    const { searchNaverBlog } = await import('../_search/naver.ts');
    await searchNaverBlog('test', 40, 'month');
    // 40*3=120 → 100으로 상한
    assert(capturedUrl.includes('display=100'), `display 상한=100: ${capturedUrl}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('searchNaverBlog: results sliced to count', async () => {
  const originalFetch = globalThis.fetch;
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const mockItems = Array.from({ length: 5 }, (_, i) => ({
    title: `Title ${i}`,
    link: `https://blog.naver.com/${i}`,
    description: '',
    bloggername: `blogger${i}`,
    bloggerlink: '',
    postdate: today,
  }));
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ items: mockItems, total: 5, start: 1, display: 5 }), { status: 200 });
  try {
    const { searchNaverBlog } = await import('../_search/naver.ts');
    const results = await searchNaverBlog('test', 2, 'month');
    assertEquals(results.length, 2, `count=2이면 2개만 반환: 실제 ${results.length}개`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('searchNaverBlog: X-Naver-Client-Id 헤더 전송', async () => {
  const originalFetch = globalThis.fetch;
  let capturedHeaders: Record<string, string> = {};
  globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    capturedHeaders = Object.fromEntries(new Headers(init?.headers as HeadersInit).entries());
    return new Response(JSON.stringify({ items: [], total: 0, start: 1, display: 0 }), { status: 200 });
  };
  try {
    const { searchNaverBlog } = await import('../_search/naver.ts');
    await searchNaverBlog('test', 5, 'month');
    assert('x-naver-client-id' in capturedHeaders, 'X-Naver-Client-Id 헤더 필요');
    assert('x-naver-client-secret' in capturedHeaders, 'X-Naver-Client-Secret 헤더 필요');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

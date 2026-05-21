import './setup.ts';
import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts';

// You.com API 응답 구조: { results: { web: [...] } }
// 각 web item: { url, title, description, snippets, thumbnail_url, page_age }

Deno.test('searchTistory: 정상 응답 파싱', async () => {
  const mockResponse = {
    results: {
      web: [
        {
          url: 'https://myblog.tistory.com/123',
          title: '비건 디저트 레시피',
          description: '맛있는 디저트 만들기',
          snippets: ['첫 번째 스니펫', '두 번째 스니펫'],
          thumbnail_url: 'https://img.tistory.com/thumb.jpg',
          page_age: '2024-03-01',
        },
        {
          url: 'https://other.tistory.com/456',
          title: '다른 글',
          description: '',
          snippets: [],
          thumbnail_url: null,
          page_age: null,
        },
      ],
    },
    metadata: { query: '비건 디저트', search_uuid: 'uuid-1', latency: 0.5 },
  };

  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  globalThis.fetch = async (url: string | URL | Request) => {
    capturedUrl = url.toString();
    return new Response(JSON.stringify(mockResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const { searchTistory } = await import('../search/youcom.ts');
    const results = await searchTistory('비건 디저트', 5, 'month');

    // 응답 파싱 검증
    assertEquals(results.length, 2);
    assertEquals(results[0].title, '비건 디저트 레시피');
    assertEquals(results[0].url, 'https://myblog.tistory.com/123');
    assertEquals(results[0].description, '맛있는 디저트 만들기');
    assertEquals(results[0].snippet, '첫 번째 스니펫');
    assertEquals(results[0].thumbnail, 'https://img.tistory.com/thumb.jpg');
    assertEquals(results[0].published_at, '2024-03-01');
    assertEquals(results[0].platform, 'tistory');

    // 두 번째 결과 (빈 값 처리)
    assertEquals(results[1].snippet, undefined);
    assertEquals(results[1].thumbnail, undefined);

    // 요청 URL 검증
    assert(capturedUrl.includes('tistory.com'), `include_domains에 tistory.com 포함 필요: ${capturedUrl}`);
    assert(capturedUrl.includes('비건'), `query에 키워드 포함 필요: ${capturedUrl}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('searchBrunch: 도메인이 brunch.co.kr로 설정됨', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  globalThis.fetch = async (url: string | URL | Request) => {
    capturedUrl = url.toString();
    return new Response(
      JSON.stringify({ results: { web: [] }, metadata: { query: '', search_uuid: '', latency: 0 } }),
      { status: 200 },
    );
  };

  try {
    const { searchBrunch } = await import('../search/youcom.ts');
    await searchBrunch('테스트', 5, 'week');
    assert(capturedUrl.includes('brunch.co.kr'), `include_domains에 brunch.co.kr 포함 필요: ${capturedUrl}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('searchTistory: results.web 없으면 빈 배열 반환', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ results: {}, metadata: {} }),
      { status: 200 },
    );

  try {
    const { searchTistory } = await import('../search/youcom.ts');
    const results = await searchTistory('테스트', 5, 'month');
    assertEquals(results.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('searchTistory: 도메인 필터링 — tistory.com이 아닌 URL 제거', async () => {
  // include_domains 파라미터가 API에서 무시될 경우를 대비한 클라이언트 필터링 검증
  const mockResponse = {
    results: {
      web: [
        { url: 'https://good.tistory.com/1', title: 'Good', description: '', snippets: [] },
        { url: 'https://bad.naver.com/2',    title: 'Bad',  description: '', snippets: [] },
        { url: 'https://also.tistory.com/3', title: 'Also', description: '', snippets: [] },
      ],
    },
    metadata: {},
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(mockResponse), { status: 200 });

  try {
    const { searchTistory } = await import('../search/youcom.ts');
    const results = await searchTistory('테스트', 10, 'month');

    // tistory.com 도메인만 포함되어야 함
    for (const item of results) {
      assert(
        item.url.includes('tistory.com'),
        `tistory.com이 아닌 URL이 포함됨: ${item.url}`,
      );
    }
    assertEquals(results.length, 2); // naver.com 제거, tistory 2개만
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('searchBrunch: 도메인 필터링 — brunch.co.kr이 아닌 URL 제거', async () => {
  const mockResponse = {
    results: {
      web: [
        { url: 'https://brunch.co.kr/@user/1',  title: 'Good',   description: '', snippets: [] },
        { url: 'https://tistory.com/unwanted/2', title: 'Bad',    description: '', snippets: [] },
        { url: 'https://brunch.co.kr/@user/3',  title: 'Also Good', description: '', snippets: [] },
      ],
    },
    metadata: {},
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(mockResponse), { status: 200 });

  try {
    const { searchBrunch } = await import('../search/youcom.ts');
    const results = await searchBrunch('테스트', 10, 'month');

    for (const item of results) {
      assert(
        item.url.includes('brunch.co.kr'),
        `brunch.co.kr이 아닌 URL이 포함됨: ${item.url}`,
      );
    }
    assertEquals(results.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

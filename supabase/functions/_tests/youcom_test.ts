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
          title: '비건 식단 가이드',  // 키워드 "비건" 포함 → 관련성 필터 통과
          description: '비건 디저트 외 식단 정보',
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
    const { searchTistory } = await import('../_search/youcom.ts');
    const results = await searchTistory('비건 디저트', 5, 'month');

    // 관련성 필터를 통과한 항목만 반환
    assertEquals(results.length, 2);
    // 점수가 높은 항목이 첫 번째 (제목에 두 단어 모두 포함)
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
    assertEquals(new URL(capturedUrl).searchParams.get('query'), '비건 디저트');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('searchTistory: 관련성 필터 — 키워드 없는 항목 제거', async () => {
  const mockResponse = {
    results: {
      web: [
        { url: 'https://a.tistory.com/1', title: '비건 디저트 맛집', description: '비건 카페', snippets: [] },
        { url: 'https://b.tistory.com/2', title: '관련없는 글', description: '전혀 다른 내용', snippets: [] },
        { url: 'https://c.tistory.com/3', title: '디저트 추천', description: '달콤한 디저트', snippets: [] },
      ],
    },
    metadata: {},
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(mockResponse), { status: 200 });

  try {
    const { searchTistory } = await import('../_search/youcom.ts');
    const results = await searchTistory('비건 디저트', 10, 'month');

    // 키워드("비건" 또는 "디저트") 없는 항목은 제외
    assertEquals(results.length, 2);
    assert(results.every(r => r.url !== 'https://b.tistory.com/2'), '무관 항목이 포함되면 안 됨');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('searchTistory: 관련성 필터 — 전부 0점이면 폴백(원본 순서 유지)', async () => {
  // 키워드가 영어라 한국어 타이틀과 매칭 안 됨 → 전부 0점 → 폴백
  const mockResults = Array.from({ length: 3 }, (_, i) => ({
    url: `https://blog${i}.tistory.com/${i}`,
    title: `한국어 글 ${i}`,
    description: '',
    snippets: [],
  }));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ results: { web: mockResults }, metadata: {} }), { status: 200 });

  try {
    const { searchTistory } = await import('../_search/youcom.ts');
    const results = await searchTistory('abc', 3, 'month');
    // 폴백: 전부 반환 (필터 없이)
    assertEquals(results.length, 3);
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
    const { searchBrunch } = await import('../_search/youcom.ts');
    await searchBrunch('테스트', 5, 'week');
    assert(capturedUrl.includes('brunch.co.kr'), `include_domains에 brunch.co.kr 포함 필요: ${capturedUrl}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('searchTikTok: www.tiktok.com/@user/video URL만 반환', async () => {
  const mockResponse = {
    results: {
      web: [
        {
          url: 'https://www.tiktok.com/@creator/video/7350000000000000000',
          title: '댄스 챌린지 영상',
          description: '틱톡 댄스 콘텐츠',
          snippets: ['댄스 영상 스니펫'],
          thumbnail_url: 'https://p16-sign.tiktokcdn.com/thumb.jpg',
          page_age: '2024-03-10',
        },
        {
          url: 'https://www.tiktok.com/@creator',
          title: '댄스 크리에이터 프로필',
          description: '프로필 페이지',
          snippets: [],
        },
        {
          url: 'https://www.tiktok.com/discover/dance',
          title: '댄스 검색 페이지',
          description: '검색 페이지',
          snippets: [],
        },
        {
          url: 'https://www.tiktok.com/@creator/photo/7350000000000000001',
          title: '댄스 포토 콘텐츠',
          description: '',
          snippets: [],
        },
        {
          url: 'https://www.tiktok.com/t/ZT123abc/',
          title: '댄스 공유 링크',
          description: '',
          snippets: [],
        },
        {
          url: 'https://tiktok.com/@creator/video/7350000000000000002',
          title: 'www 없는 영상 링크',
          description: '',
          snippets: [],
        },
        {
          url: 'https://m.tiktok.com/@creator/video/7350000000000000003',
          title: '모바일 영상 링크',
          description: '',
          snippets: [],
        },
        {
          url: 'https://example.com/not-tiktok',
          title: '댄스 외부 링크',
          description: '',
          snippets: [],
        },
      ],
    },
    metadata: {},
  };

  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  globalThis.fetch = async (url: string | URL | Request) => {
    capturedUrl = url.toString();
    return new Response(JSON.stringify(mockResponse), { status: 200 });
  };

  try {
    const { searchTikTok } = await import('../_search/youcom.ts');
    const results = await searchTikTok('댄스', 10, 'month');
    const urls = new Set(results.map(r => r.url));

    assertEquals(results.length, 1);
    assert(urls.has('https://www.tiktok.com/@creator/video/7350000000000000000'), '영상 URL 포함');
    assert(!urls.has('https://www.tiktok.com/@creator/photo/7350000000000000001'), '포토 URL 제외');
    assert(!urls.has('https://www.tiktok.com/t/ZT123abc/'), '공유 URL 제외');
    assert(!urls.has('https://tiktok.com/@creator/video/7350000000000000002'), 'www 없는 URL 제외');
    assert(!urls.has('https://m.tiktok.com/@creator/video/7350000000000000003'), '모바일 URL 제외');
    assert(!urls.has('https://www.tiktok.com/@creator'), '프로필 URL 제외');
    assert(!urls.has('https://www.tiktok.com/discover/dance'), '검색 URL 제외');
    assert(results.every(r => r.platform === 'tiktok'), 'platform=tiktok 필요');
    assertEquals(results.find(r => r.url.includes('/video/'))?.author, '@creator');
    assert(capturedUrl.includes('tiktok.com'), `include_domains에 tiktok.com 포함 필요: ${capturedUrl}`);
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
    const { searchTistory } = await import('../_search/youcom.ts');
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
    const { searchTistory } = await import('../_search/youcom.ts');
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

Deno.test('searchTistory: API 오류 시 ExternalApiError 발생', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response('{"error":"unauthorized"}', { status: 401 });
  try {
    const { searchTistory } = await import('../_search/youcom.ts');
    let threw = false;
    try {
      await searchTistory('test', 5, 'month');
    } catch (e) {
      threw = true;
      assert((e as Error).message.includes('You.com'), `에러 메시지에 You.com 포함 필요: ${(e as Error).message}`);
    }
    assert(threw, 'API 오류 시 예외를 던져야 합니다');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('searchTistory: X-API-KEY 헤더 전송', async () => {
  const originalFetch = globalThis.fetch;
  let capturedHeaders: Record<string, string> = {};
  globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    capturedHeaders = Object.fromEntries(new Headers(init?.headers as HeadersInit).entries());
    return new Response(JSON.stringify({ results: { web: [] }, metadata: {} }), { status: 200 });
  };
  try {
    const { searchTistory } = await import('../_search/youcom.ts');
    await searchTistory('test', 5, 'month');
    assert('x-api-key' in capturedHeaders, 'X-API-KEY 헤더 필요');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('searchTistory: count, freshness, country 파라미터 포함', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  globalThis.fetch = async (url: string | URL | Request) => {
    capturedUrl = url.toString();
    return new Response(JSON.stringify({ results: { web: [] }, metadata: {} }), { status: 200 });
  };
  try {
    const { searchTistory } = await import('../_search/youcom.ts');
    await searchTistory('test', 7, 'week');
    // 관련성 필터용 여유분: count*3=21 을 요청
    assert(capturedUrl.includes('count=21'), `여유분 포함 count=21 필요: ${capturedUrl}`);
    assert(capturedUrl.includes('freshness=week'), `freshness=week 필요: ${capturedUrl}`);
    assert(capturedUrl.includes('country=KR'), `country=KR 필요: ${capturedUrl}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('searchTistory: count보다 많은 결과 → count로 제한 (도메인 필터 후)', async () => {
  // API가 count param을 무시하고 10개를 반환해도 count=5로 제한되어야 함
  const mockResults = Array.from({ length: 10 }, (_, i) => ({
    url: `https://blog${i}.tistory.com/${i}`,
    title: `Title ${i}`,
    description: '',
    snippets: [],
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ results: { web: mockResults }, metadata: {} }), { status: 200 });
  try {
    const { searchTistory } = await import('../_search/youcom.ts');
    const results = await searchTistory('test', 5, 'month');
    assertEquals(results.length, 5, `count=5이면 5개로 제한: 실제 ${results.length}개`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('searchBrunch: count보다 많은 결과 → count로 제한', async () => {
  const mockResults = Array.from({ length: 8 }, (_, i) => ({
    url: `https://brunch.co.kr/@user/${i}`,
    title: `Brunch ${i}`,
    description: '',
    snippets: [],
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ results: { web: mockResults }, metadata: {} }), { status: 200 });
  try {
    const { searchBrunch } = await import('../_search/youcom.ts');
    const results = await searchBrunch('test', 3, 'month');
    assertEquals(results.length, 3, `count=3이면 3개로 제한: 실제 ${results.length}개`);
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
    const { searchBrunch } = await import('../_search/youcom.ts');
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

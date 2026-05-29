import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { fetchNaverTrendTopics } from '../_shared/naver-trends.ts';

Deno.test('fetchNaverTrendTopics: Naver DataLab response sorted by trend score', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    assertEquals(String(input), 'https://openapi.naver.com/v1/datalab/search');
    assertEquals(init?.method, 'POST');

    const body = JSON.parse(String(init?.body));
    assertEquals(body.keywordGroups.map((group: any) => group.groupName), ['AI', '숏폼']);

    return Promise.resolve(new Response(JSON.stringify({
      results: [
        { title: 'AI', keywords: ['AI'], data: [{ period: '2026-05-04', ratio: 20 }, { period: '2026-05-11', ratio: 80 }] },
        { title: '숏폼', keywords: ['숏폼'], data: [{ period: '2026-05-04', ratio: 40 }, { period: '2026-05-11', ratio: 45 }] },
      ],
    }), { status: 200 }));
  }) as typeof fetch;

  try {
    assertEquals(await fetchNaverTrendTopics('client-id', 'client-secret', 'AI, 숏폼'), [
      { keyword: 'AI', traffic: '80' },
      { keyword: '숏폼', traffic: '45' },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

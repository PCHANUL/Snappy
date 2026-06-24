import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { fetchNaverAutocomplete } from '../_trends/naver-autocomplete.ts';

Deno.test('fetchNaverAutocomplete extracts keywords and drops the seed/dupes', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    items: [[
      ['비건', 'meta'],
      ['비건빵', 'meta'],
      ['비건화장품', 'meta'],
      ['비건빵', 'meta'],
      ['비건레시피', 'meta'],
    ]],
  }))) as typeof fetch;

  try {
    const suggestions = await fetchNaverAutocomplete('비건');
    assertEquals(suggestions, ['비건빵', '비건화장품', '비건레시피']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('fetchNaverAutocomplete returns empty for blank input without fetching', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => { called = true; return new Response('{}'); }) as typeof fetch;

  try {
    assertEquals(await fetchNaverAutocomplete('   '), []);
    assertEquals(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('fetchNaverAutocomplete returns up to 20 suggestions', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    items: [[
      ['테스트', 'meta'],
      ...Array.from({ length: 25 }, (_, index) => [`테스트 ${index + 1}`, 'meta']),
    ]],
  }))) as typeof fetch;

  try {
    const suggestions = await fetchNaverAutocomplete('테스트');
    assertEquals(suggestions.length, 20);
    assertEquals(suggestions[0], '테스트 1');
    assertEquals(suggestions[19], '테스트 20');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

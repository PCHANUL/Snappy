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

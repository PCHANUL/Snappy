// 네이버 검색 자동완성 — 시드 키워드로 사람들이 실제 검색하는 연관 키워드 발굴
// 비공식 엔드포인트라 CORS가 막혀 있어 Edge Function(서버)에서만 호출 가능

const AC_ENDPOINT = 'https://ac.search.naver.com/nx/ac';

// 봇 차단 회피용 일반 브라우저 User-Agent
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export async function fetchNaverAutocomplete(keyword: string): Promise<string[]> {
  const trimmed = keyword.trim();
  if (!trimmed) return [];

  const params = new URLSearchParams({
    q: trimmed,
    st: '100',
    frm: 'nv',
    r_format: 'json',
    r_enc: 'UTF-8',
    r_unicode: '0',
    ans: '2',
    q_enc: 'UTF-8',
  });

  const res = await fetch(`${AC_ENDPOINT}?${params.toString()}`, {
    headers: {
      'User-Agent': BROWSER_UA,
      'Accept': 'application/json',
      'Referer': 'https://search.naver.com/',
    },
  });

  if (!res.ok) {
    throw new Error(`Naver autocomplete ${res.status}`);
  }

  const data = await res.json();
  // 응답 구조: { items: [ [ ["키워드", ...meta], ... ] ] }
  const group = (data.items as any[])?.[0];
  if (!Array.isArray(group)) return [];

  const seen = new Set<string>();
  const suggestions: string[] = [];
  for (const entry of group) {
    const word = Array.isArray(entry) ? entry[0] : entry;
    if (typeof word !== 'string') continue;
    const clean = word.trim();
    // 시드 키워드 자체와 중복 제거
    if (!clean || clean === trimmed || seen.has(clean)) continue;
    seen.add(clean);
    suggestions.push(clean);
  }

  return suggestions.slice(0, 20);
}

// 도메인 정규화 — SEO/GEO 측정의 조인 기준
// URL에서 루트 도메인을 동일 규칙으로 추출해, "같은 출처"를 한 키로 묶는다.
//
// 규칙 (SEO 적재·GEO 적재가 반드시 공유):
//   - 프로토콜·경로·쿼리 제거
//   - www. / m. / 모바일·블로그 서브도메인 제거
//   - 멀티파트 TLD(co.kr, or.kr, ne.jp 등) 보존
//   - 플랫폼 호스팅 도메인은 루트로 통합 (blog.naver.com → naver.com)

// 한국 + 주요 국가의 2단계 TLD. 이 목록에 걸리면 마지막 3개 라벨을 루트로 본다.
const MULTI_PART_TLDS = new Set([
  'co.kr', 'or.kr', 'ne.kr', 'go.kr', 're.kr', 'pe.kr', 'ac.kr',
  'co.jp', 'or.jp', 'ne.jp', 'go.jp', 'ac.jp',
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk',
  'com.cn', 'net.cn', 'org.cn',
  'com.au', 'net.au', 'org.au',
]);

// 본문이 서브도메인에 호스팅되지만 같은 출처로 봐야 하는 플랫폼.
// (예: 네이버 블로그는 blog/m.blog/post.blog 등 여러 서브도메인을 쓰지만 모두 naver.com)
const PLATFORM_ROOTS: Record<string, string> = {
  'naver.com': 'naver.com',
  'tistory.com': 'tistory.com', // username.tistory.com → tistory.com
  'brunch.co.kr': 'brunch.co.kr',
  'youtube.com': 'youtube.com',
  'youtu.be': 'youtube.com',
  'tiktok.com': 'tiktok.com',
};

// URL → 루트 도메인. 실패 시 빈 문자열.
export function rootDomain(url: string): string {
  const host = extractHost(url);
  if (!host) return '';

  // 1. 알려진 플랫폼 루트로 통합
  for (const suffix of Object.keys(PLATFORM_ROOTS)) {
    if (host === suffix || host.endsWith('.' + suffix)) {
      return PLATFORM_ROOTS[suffix];
    }
  }

  // 2. 멀티파트 TLD 고려해 등록 가능 도메인(루트) 추출
  const labels = host.split('.');
  if (labels.length <= 2) return host;

  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_PART_TLDS.has(lastTwo)) {
    // 예: foo.bar.co.kr → bar.co.kr (마지막 3개 라벨)
    return labels.slice(-3).join('.');
  }

  // 예: blog.example.com → example.com
  return labels.slice(-2).join('.');
}

// URL → 호스트명 (소문자, www./m. 제거). 스킴 없는 입력도 허용.
function extractHost(url: string): string {
  if (!url) return '';
  let host: string;
  try {
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    host = new URL(normalized).hostname.toLowerCase();
  } catch {
    return '';
  }
  // 흔한 접두 서브도메인 제거 (www, m, mobile)
  return host.replace(/^(www|m|mobile)\./, '');
}

// 두 URL/도메인이 같은 루트 출처인지 (자기-귀속 판정용)
export function isSameDomain(a: string, b: string): boolean {
  const ra = a.includes('://') || a.includes('/') ? rootDomain(a) : rootDomain('https://' + a);
  const rb = b.includes('://') || b.includes('/') ? rootDomain(b) : rootDomain('https://' + b);
  return ra !== '' && ra === rb;
}

// 블로그 본문 크롤러
// naver_blog / tistory / brunch 지원 — YouTube는 JS 렌더링 필요로 스킵

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const TIMEOUT_MS = 10_000;
const MAX_TEXT   = 10_000;

export type CrawlStatus = 'done' | 'failed' | 'skip';

export interface CrawlResult {
  status: CrawlStatus;
  full_text?: string;
  word_count?: number;
}

// YouTube는 JS 렌더링이 필요하므로 크롤링 불가 → skip
const SKIP_PLATFORMS = new Set(['youtube']);

// 플랫폼별 본문 클래스명 후보 (앞쪽 우선)
const SELECTORS: Record<string, string[]> = {
  naver_blog: ['se-main-container', 'post-view', 'postViewArea', 'post_ct'],
  tistory:    ['article-view', 'entry-content', 'tt_article_useless_p_margin', 'contents_style'],
  brunch:     ['wrap_body', 'article_view', 'wrap_article_body'],
};

export async function crawlUrl(url: string, platform: string): Promise<CrawlResult> {
  if (SKIP_PLATFORMS.has(platform)) return { status: 'skip' };

  let html: string;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,*/*' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { status: 'failed' };
    html = await res.text();
  } catch {
    return { status: 'failed' };
  }

  const text = extractText(html, platform);
  if (!text || text.length < 100) return { status: 'failed' };

  return {
    status: 'done',
    full_text: text,
    word_count: countWords(text),
  };
}

function extractText(html: string, platform: string): string {
  const classes = SELECTORS[platform] ?? [];

  for (const cls of classes) {
    const text = extractByClass(html, cls);
    if (text) return text;
  }

  // 범용 폴백: <article>, <main>
  for (const tag of ['article', 'main']) {
    const text = extractByTag(html, tag);
    if (text) return text;
  }

  return '';
}

function extractByClass(html: string, className: string): string {
  // class 속성에 정확히 className이 포함된 첫 번째 태그를 찾음
  const candidates = [
    `class="${className}"`,
    `class="${className} `,
    ` ${className}"`,
    ` ${className} `,
  ];

  for (const pattern of candidates) {
    const attrIdx = html.indexOf(pattern);
    if (attrIdx === -1) continue;

    const tagEnd = html.indexOf('>', attrIdx);
    if (tagEnd === -1) continue;

    const raw = html.slice(tagEnd + 1, tagEnd + 25_001);
    const text = cleanHtml(raw);
    if (text.length >= 100) return text;
  }
  return '';
}

function extractByTag(html: string, tagName: string): string {
  const lower  = html.toLowerCase();
  const startIdx = lower.indexOf(`<${tagName}`);
  if (startIdx === -1) return '';

  const tagEnd = html.indexOf('>', startIdx);
  if (tagEnd === -1) return '';

  const raw = html.slice(tagEnd + 1, tagEnd + 25_001);
  return cleanHtml(raw);
}

function cleanHtml(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT);
}

function countWords(text: string): number {
  // 한국어: 공백 기준 어절 수. 영어 혼합이면 공백 분리가 그대로 적용됨.
  return text.split(/\s+/).filter(Boolean).length;
}

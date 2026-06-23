// 블로그/유튜브 콘텐츠 크롤러
// - naver_blog: m.blog.naver.com 모바일 URL로 변환 후 크롤 (iframe 우회)
// - youtube: Data API v3 videos.list 로 설명 + 태그 취득
// - tistory / brunch: 직접 크롤
// - tiktok / instagram_reels: 임베드/검색 설명 기반으로 분석하므로 직접 크롤 생략
// - 공통 폴백: OG/description 메타 태그

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const TIMEOUT_MS = 10_000;
const MAX_TEXT   = 10_000;

export type CrawlStatus = 'done' | 'failed' | 'skip';

export interface CrawlResult {
  status: CrawlStatus;
  full_text?: string;
  word_count?: number;
}

export interface CrawlOptions {
  youtubeApiKey?: string;
}

// 플랫폼별 본문 클래스명 후보 (앞쪽 우선)
const SELECTORS: Record<string, string[]> = {
  naver_blog: ['se-main-container', 'post-view', 'postViewArea', 'post_ct'],
  tistory:    ['article-view', 'entry-content', 'tt_article_useless_p_margin', 'contents_style'],
  brunch:     ['wrap_body', 'article_view', 'wrap_article_body'],
};

export async function crawlUrl(url: string, platform: string, options?: CrawlOptions): Promise<CrawlResult> {
  if (platform === 'youtube' || platform === 'youtube_shorts') {
    return fetchYouTubeContent(url, options?.youtubeApiKey);
  }
  if (platform === 'tiktok' || platform === 'instagram_reels') {
    return { status: 'skip' };
  }

  // 네이버 블로그: 데스크톱 URL은 iframe 내부에 본문이 있어 직접 크롤 불가.
  // m.blog.naver.com 모바일 버전은 서버사이드 렌더링으로 본문이 직접 노출됨.
  const fetchUrl = platform === 'naver_blog' ? toNaverMobileUrl(url) ?? url : url;

  let html: string;
  try {
    const res = await fetch(fetchUrl, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,*/*' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { status: 'failed' };
    html = await res.text();
  } catch {
    return { status: 'failed' };
  }

  const text = extractText(html, platform);
  if (text && text.length >= 100) {
    return { status: 'done', full_text: text, word_count: countWords(text) };
  }

  // 본문 CSS 셀렉터 실패 → OG/description 메타 태그 폴백
  const ogText = extractOgMeta(html);
  if (ogText && ogText.length >= 20) {
    return { status: 'done', full_text: ogText, word_count: countWords(ogText) };
  }

  return { status: 'failed' };
}

// blog.naver.com/user/postid → m.blog.naver.com/user/postid
function toNaverMobileUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith('blog.naver.com')) return null;
    return `https://m.blog.naver.com${u.pathname}`;
  } catch {
    return null;
  }
}

// YouTube Data API v3 — videos.list (snippet) → description + tags
async function fetchYouTubeContent(url: string, apiKey?: string): Promise<CrawlResult> {
  if (!apiKey) return { status: 'failed' };

  const videoId = extractYouTubeId(url);
  if (!videoId) return { status: 'failed' };

  try {
    const apiUrl = `https://www.googleapis.com/youtube/v3/videos` +
      `?part=snippet&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(apiKey)}`;

    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return { status: 'failed' };

    const data = await res.json();
    const snippet = data.items?.[0]?.snippet;
    if (!snippet) return { status: 'failed' };

    const tags: string = (snippet.tags ?? []).join(' ');
    const text = [snippet.title, snippet.description, tags]
      .filter(Boolean)
      .join('\n')
      .trim()
      .slice(0, MAX_TEXT);

    if (text.length < 20) return { status: 'failed' };

    return { status: 'done', full_text: text, word_count: countWords(text) };
  } catch {
    return { status: 'failed' };
  }
}

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1) || null;
    const shortsMatch = u.pathname.match(/^\/shorts\/([^/?#]+)/);
    if (shortsMatch) return shortsMatch[1];
    return u.searchParams.get('v');
  } catch {
    return null;
  }
}

// OG description 또는 <meta name="description"> 태그에서 텍스트 추출
function extractOgMeta(html: string): string {
  const patterns = [
    /property=["']og:description["'][^>]+content=["']([^"']{20,})["']/i,
    /content=["']([^"']{20,})["'][^>]+property=["']og:description["']/i,
    /name=["']description["'][^>]+content=["']([^"']{20,})["']/i,
    /content=["']([^"']{20,})["'][^>]+name=["']description["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      return m[1]
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
    }
  }
  return '';
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
  return text.split(/\s+/).filter(Boolean).length;
}

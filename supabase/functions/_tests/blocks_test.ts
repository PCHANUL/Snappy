import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  buildResultBlocks,
  buildSummaryBlocks,
  buildLoadMoreCallout,
  buildSubPageBlocks,
  buildTabItemBlocks,
} from '../_notion/blocks.ts';
import type { SearchResult, FlatResult, SearchMetadata } from '../_core/types.ts';

const META: SearchMetadata = { duration_ms: 1500, cost_usd: 0.01 };

function makeResult(platform: string, items: FlatResult[], error?: string): SearchResult {
  return { platform: platform as any, items, count: items.length, error };
}

function makeItem(platform: string, overrides: Partial<FlatResult> = {}): FlatResult {
  return {
    platform: platform as any,
    title: `${platform} 글 제목`,
    url: `https://example.com/${platform}/1`,
    description: '설명 텍스트입니다.',
    ...overrides,
  };
}

// ── buildResultBlocks ─────────────────────────────────────────────────────────

Deno.test('buildResultBlocks: 배열을 반환함', () => {
  const blocks = buildResultBlocks('키워드', [makeResult('naver_blog', [makeItem('naver_blog')])], META);
  assert(Array.isArray(blocks));
  assert(blocks.length > 0);
});

Deno.test('buildResultBlocks: 첫 블록 callout에 키워드 포함', () => {
  const blocks = buildResultBlocks('비건 디저트', [makeResult('naver_blog', [makeItem('naver_blog')])], META);
  assertEquals(blocks[0].type, 'callout');
  assert(
    blocks[0].callout.rich_text[0].text.content.includes('비건 디저트'),
    '키워드 포함',
  );
});

Deno.test('buildResultBlocks: 발견 개수 callout에 표시', () => {
  const items = [makeItem('naver_blog'), makeItem('naver_blog', { url: 'https://example.com/2' })];
  const blocks = buildResultBlocks('test', [makeResult('naver_blog', items)], META);
  assert(blocks[0].callout.rich_text[0].text.content.includes('2개'), '개수 포함');
});

Deno.test('buildResultBlocks: 오류 플랫폼 → toggle + 실패 메시지', () => {
  const blocks = buildResultBlocks('test', [makeResult('naver_blog', [], '서버 오류')], META);
  const toggles = blocks.filter(b => b.type === 'toggle');
  assert(toggles.length > 0, 'toggle 블록 존재');
  const inner = toggles[0].toggle.children[0];
  assert(inner.paragraph.rich_text[0].text.content.includes('검색 실패'), '실패 메시지 포함');
  assert(inner.paragraph.rich_text[0].text.content.includes('서버 오류'), '오류 내용 포함');
});

Deno.test('buildResultBlocks: 결과 없는 플랫폼 → toggle + 빈결과 메시지', () => {
  const blocks = buildResultBlocks('test', [makeResult('youtube', [])], META);
  const toggles = blocks.filter(b => b.type === 'toggle');
  assert(toggles.length > 0, 'toggle 블록 존재');
  const inner = toggles[0].toggle.children[0];
  assert(inner.paragraph.rich_text[0].text.content.includes('결과를 찾지 못했습니다'), '빈결과 메시지');
});

Deno.test('buildResultBlocks: 결과 있는 플랫폼 → heading_2 블록', () => {
  const blocks = buildResultBlocks('test', [makeResult('tistory', [makeItem('tistory')])], META);
  const headings = blocks.filter(b => b.type === 'heading_2');
  assert(headings.length > 0, 'heading_2 존재');
  assert(headings[0].heading_2.rich_text[0].text.content.includes('1개'), '개수 포함');
});

Deno.test('buildResultBlocks: 썸네일 있는 아이템 → image 블록 포함', () => {
  const item = makeItem('youtube', { thumbnail: 'https://img.youtube.com/vi/abc/hq.jpg' });
  const blocks = buildResultBlocks('test', [makeResult('youtube', [item])], META);
  const images = blocks.filter(b => b.type === 'image');
  assert(images.length > 0, 'image 블록 존재');
  assertEquals(images[0].image.external.url, item.thumbnail);
});

Deno.test('buildResultBlocks: 유튜브 숏츠 아이템 → video 블록으로 임베딩', () => {
  const item = makeItem('youtube_shorts', { url: 'https://www.youtube.com/shorts/abc123' });
  const blocks = buildResultBlocks('test', [makeResult('youtube_shorts', [item])], META);
  const videos = blocks.filter(b => b.type === 'video');
  assertEquals(videos.length, 1, '숏츠는 video 블록이어야 함');
  assertEquals(videos[0].video.external.url, item.url);
});

Deno.test('buildResultBlocks: 틱톡 아이템 → embed 블록으로 임베딩', () => {
  const item = makeItem('tiktok', { url: 'https://www.tiktok.com/@creator/video/7350000000000000000' });
  const blocks = buildResultBlocks('test', [makeResult('tiktok', [item])], META);
  const embeds = blocks.filter(b => b.type === 'embed');
  assertEquals(embeds.length, 1, '틱톡은 embed 블록이어야 함');
  assertEquals(embeds[0].embed.url, item.url);
});

Deno.test('buildResultBlocks: 인스타 릴스 아이템 → embed 블록으로 임베딩', () => {
  const item = makeItem('instagram_reels', { url: 'https://www.instagram.com/reel/DRIxfcYkh0I/' });
  const blocks = buildResultBlocks('test', [makeResult('instagram_reels', [item])], META);
  const embeds = blocks.filter(b => b.type === 'embed');
  assertEquals(embeds.length, 1, '인스타 릴스는 embed 블록이어야 함');
  assertEquals(embeds[0].embed.url, item.url);
});

Deno.test('buildResultBlocks: 썸네일 없는 아이템 → image 블록 없음', () => {
  const item = makeItem('naver_blog'); // thumbnail 없음
  const blocks = buildResultBlocks('test', [makeResult('naver_blog', [item])], META);
  const images = blocks.filter(b => b.type === 'image');
  assertEquals(images.length, 0, 'thumbnail 없으면 image 블록 없어야 함');
});

Deno.test('buildResultBlocks: 여러 플랫폼 혼합 처리', () => {
  const results = [
    makeResult('naver_blog', [makeItem('naver_blog')]),
    makeResult('youtube',    []),
    makeResult('tistory',    [makeItem('tistory')], '타임아웃'),
    makeResult('brunch',     [makeItem('brunch'), makeItem('brunch', { url: 'https://b.kr/2' })]),
  ];
  const blocks = buildResultBlocks('복합 테스트', results, META);
  assert(blocks.length > 0);
  // 에러 없이 처리되면 통과
});

// ── buildSummaryBlocks ────────────────────────────────────────────────────────

Deno.test('buildSummaryBlocks: 3개 블록 반환 (callout + paragraph + divider)', () => {
  const blocks = buildSummaryBlocks('test', [makeResult('naver_blog', [makeItem('naver_blog')])], META);
  assertEquals(blocks.length, 3);
  assertEquals(blocks[0].type, 'callout');
  assertEquals(blocks[1].type, 'paragraph');
  assertEquals(blocks[2].type, 'divider');
});

Deno.test('buildSummaryBlocks: callout에 키워드와 개수 포함', () => {
  const blocks = buildSummaryBlocks(
    '비건 레시피',
    [makeResult('youtube', [makeItem('youtube'), makeItem('youtube', { url: 'https://y.com/2' })])],
    META,
  );
  const text = blocks[0].callout.rich_text[0].text.content;
  assert(text.includes('비건 레시피'), '키워드 포함');
  assert(text.includes('2개'), '개수 포함');
});

Deno.test('buildSummaryBlocks: 플랫폼 요약 paragraph에 이모지 포함', () => {
  const blocks = buildSummaryBlocks('test', [
    makeResult('naver_blog', [makeItem('naver_blog')]),
    makeResult('youtube',    [makeItem('youtube')]),
  ], META);
  const text = blocks[1].paragraph.rich_text[0].text.content;
  assert(text.includes('📝'), '네이버 이모지');
  assert(text.includes('🎥'), '유튜브 이모지');
});

Deno.test('buildSummaryBlocks: 오류 플랫폼 → ⚠️ 표시', () => {
  const blocks = buildSummaryBlocks('test', [makeResult('tistory', [], '오류')], META);
  const text = blocks[1].paragraph.rich_text[0].text.content;
  assert(text.includes('⚠️'), '오류 표시');
});

// ── buildLoadMoreCallout ──────────────────────────────────────────────────────

Deno.test('buildLoadMoreCallout: callout 블록 반환', () => {
  const block = buildLoadMoreCallout(15);
  assertEquals(block.type, 'callout');
});

Deno.test('buildLoadMoreCallout: 남은 개수 텍스트에 포함', () => {
  const block = buildLoadMoreCallout(7);
  assert(block.callout.rich_text[0].text.content.includes('7'), '남은 개수 7 포함');
});

Deno.test('buildLoadMoreCallout: ⏬ 이모지 포함', () => {
  const block = buildLoadMoreCallout(3);
  const text = block.callout.rich_text[0].text.content;
  assert(text.startsWith('⏬'), '⏬로 시작');
});

Deno.test('buildTabItemBlocks: 유튜브 숏츠 아이템 → bookmark 대신 video 블록', () => {
  const item = makeItem('youtube_shorts', { url: 'https://www.youtube.com/shorts/tab123' });
  const blocks = buildTabItemBlocks(item);
  assertEquals(blocks[0].type, 'video');
  assertEquals(blocks[0].video.external.url, item.url);
  assertEquals(blocks.filter(b => b.type === 'bookmark').length, 0);
});

Deno.test('buildTabItemBlocks: 틱톡 아이템 → bookmark 대신 embed 블록', () => {
  const item = makeItem('tiktok', { url: 'https://www.tiktok.com/@creator/video/tab123' });
  const blocks = buildTabItemBlocks(item);
  assertEquals(blocks[0].type, 'embed');
  assertEquals(blocks[0].embed.url, item.url);
  assertEquals(blocks.filter(b => b.type === 'bookmark').length, 0);
});

Deno.test('buildTabItemBlocks: 인스타 릴스 아이템 → bookmark 대신 embed 블록', () => {
  const item = makeItem('instagram_reels', { url: 'https://www.instagram.com/reel/tab123/' });
  const blocks = buildTabItemBlocks(item);
  assertEquals(blocks[0].type, 'embed');
  assertEquals(blocks[0].embed.url, item.url);
  assertEquals(blocks.filter(b => b.type === 'bookmark').length, 0);
});

// ── buildSubPageBlocks ────────────────────────────────────────────────────────

Deno.test('buildSubPageBlocks: 배열을 반환함', () => {
  const blocks = buildSubPageBlocks(makeItem('naver_blog'));
  assert(Array.isArray(blocks));
  assert(blocks.length > 0);
});

Deno.test('buildSubPageBlocks: 일반 링크 아이템 → bookmark 블록 포함 + 올바른 URL', () => {
  const item = makeItem('naver_blog');
  const blocks = buildSubPageBlocks(item);
  const bookmarks = blocks.filter(b => b.type === 'bookmark');
  assert(bookmarks.length > 0, 'bookmark 존재');
  assertEquals(bookmarks[0].bookmark.url, item.url);
});

Deno.test('buildSubPageBlocks: 유튜브 아이템 → video 블록으로 임베딩', () => {
  const item = makeItem('youtube', { url: 'https://www.youtube.com/watch?v=watch123' });
  const blocks = buildSubPageBlocks(item);
  const videos = blocks.filter(b => b.type === 'video');
  assertEquals(videos.length, 1, '서브페이지에서 유튜브 video 블록 필요');
  assertEquals(videos[0].video.external.url, item.url);
});

Deno.test('buildSubPageBlocks: 유튜브 숏츠 아이템 → video 블록으로 임베딩', () => {
  const item = makeItem('youtube_shorts', { url: 'https://www.youtube.com/shorts/sub123' });
  const blocks = buildSubPageBlocks(item);
  const videos = blocks.filter(b => b.type === 'video');
  assertEquals(videos.length, 1, '서브페이지에서도 숏츠 video 블록 필요');
  assertEquals(videos[0].video.external.url, item.url);
});

Deno.test('buildSubPageBlocks: 틱톡 아이템 → embed 블록으로 임베딩', () => {
  const item = makeItem('tiktok', { url: 'https://www.tiktok.com/@creator/video/sub123' });
  const blocks = buildSubPageBlocks(item);
  const embeds = blocks.filter(b => b.type === 'embed');
  assertEquals(embeds.length, 1, '서브페이지에서도 틱톡 embed 블록 필요');
  assertEquals(embeds[0].embed.url, item.url);
});

Deno.test('buildSubPageBlocks: 인스타 릴스 아이템 → embed 블록으로 임베딩', () => {
  const item = makeItem('instagram_reels', { url: 'https://www.instagram.com/reel/sub123/' });
  const blocks = buildSubPageBlocks(item);
  const embeds = blocks.filter(b => b.type === 'embed');
  assertEquals(embeds.length, 1, '서브페이지에서도 인스타 릴스 embed 블록 필요');
  assertEquals(embeds[0].embed.url, item.url);
});

Deno.test('buildSubPageBlocks: author + published_at → 첫 paragraph에 포함', () => {
  const item = makeItem('naver_blog', { author: '홍길동', published_at: '2024-03-15' });
  const blocks = buildSubPageBlocks(item);
  const text = blocks[0].paragraph.rich_text[0].text.content;
  assert(text.includes('홍길동'), 'author 포함');
  assert(text.includes('2024-03-15'), 'published_at 포함');
});

Deno.test('buildSubPageBlocks: 500자 초과 description → 잘림 (…)', () => {
  const longDesc = 'x'.repeat(600);
  const item = makeItem('brunch', { description: longDesc, snippet: undefined });
  const blocks = buildSubPageBlocks(item);
  const paragraphs = blocks.filter(b => b.type === 'paragraph');
  const allText = paragraphs.map(p => p.paragraph.rich_text[0].text.content).join('');
  // 500자 + '…' 로 잘려야 함
  assert(allText.includes('…'), '말줄임표 포함');
  assert(!allText.includes('x'.repeat(510)), '600자 그대로 포함되면 안 됨');
});

Deno.test('buildSubPageBlocks: snippet 있으면 description 대신 사용', () => {
  const item = makeItem('tistory', {
    description: '기본 설명',
    snippet: '스니펫 내용',
  });
  const blocks = buildSubPageBlocks(item);
  const paragraphs = blocks.filter(b => b.type === 'paragraph');
  const allText = paragraphs.map(p => p.paragraph.rich_text[0].text.content).join('');
  assert(allText.includes('스니펫 내용'), 'snippet 사용');
});

Deno.test('buildSubPageBlocks: description/snippet 모두 없으면 텍스트 블록 없음', () => {
  const item = makeItem('naver_blog', { description: '', snippet: undefined });
  const blocks = buildSubPageBlocks(item);
  // bookmark + meta paragraph 외에 긴 텍스트 paragraph 없어야 함
  const textParagraphs = blocks
    .filter(b => b.type === 'paragraph')
    .filter(b => b.paragraph.rich_text[0].text.content.length > 50);
  assertEquals(textParagraphs.length, 0, '긴 텍스트 paragraph 없어야 함');
});

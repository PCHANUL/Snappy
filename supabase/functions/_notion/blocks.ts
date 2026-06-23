// 노션 페이지에 추가할 블록 생성
// 매체별 결과를 toggle 블록으로 묶어 페이지를 깔끔하게 유지

import { PLATFORM_INFO } from '../_core/types.ts';
import type { ContentItem, FlatResult, SearchResult, SearchMetadata } from '../_core/types.ts';

type NotionBlock = Record<string, any>;

export function buildResultBlocks(
  keyword: string,
  results: SearchResult[],
  metadata: SearchMetadata,
): NotionBlock[] {
  // 상단 요약은 buildSummaryBlocks와 동일 — 중복 제거
  const blocks: NotionBlock[] = [...buildSummaryBlocks(keyword, results, metadata)];

  for (const result of results) {
    const info = PLATFORM_INFO[result.platform];

    if (result.items.length === 0) {
      // 결과 없거나 오류인 경우 → toggle로 접어서 방해 안 되게
      const msg = result.error ? `⚠️ 검색 실패: ${result.error}` : '결과를 찾지 못했습니다.';
      blocks.push(toggle(`${info.emoji} ${info.name}`, [paragraph(msg, 'gray')]));
      continue;
    }

    // 결과 있는 경우 → heading_2로 바로 표시 (클릭 불필요)
    blocks.push(heading2(`${info.emoji} ${info.name} (${result.count}개)`));
    for (const [idx, item] of result.items.entries()) {
      blocks.push(...buildContentItemBlocks(idx + 1, item));
    }
    blocks.push(divider());
  }

  return blocks;
}

function buildContentItemBlocks(idx: number, item: ContentItem): NotionBlock[] {
  const blocks: NotionBlock[] = [];

  blocks.push({
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [
        { type: 'text', text: { content: `${idx}. ` }, annotations: { bold: true } },
        { type: 'text', text: { content: item.title, link: { url: item.url } }, annotations: { bold: true } },
      ],
    },
  });

  const metaParts: string[] = [];
  if (item.author) metaParts.push(`👤 ${item.author}`);
  if (item.published_at) metaParts.push(`📅 ${item.published_at.slice(0, 10)}`);
  if (metaParts.length > 0) {
    blocks.push(paragraphIndent(metaParts.join('  ·  '), 'gray'));
  }

  const mediaBlock = buildMediaBlock(item);
  if (mediaBlock) blocks.push(mediaBlock);

  const desc = item.snippet || item.description;
  if (desc) {
    const truncated = desc.length > 200 ? desc.slice(0, 200) + '…' : desc;
    blocks.push(paragraphIndent(truncated));
  }

  return blocks;
}

// === 서브페이지 / child DB 방식 ===

// 페이지 상단 요약 블록 — callout(검색어·총개수) + gray paragraph(매체별 개수·소요시간)
export function buildSummaryBlocks(
  keyword: string,
  results: SearchResult[],
  metadata: SearchMetadata,
): NotionBlock[] {
  const totalCount = results.reduce((sum, r) => sum + r.count, 0);
  const duration = (metadata.duration_ms / 1000).toFixed(1);

  const summaryParts = results.map(r => {
    const info = PLATFORM_INFO[r.platform];
    if (r.error) return `${info.emoji} ${info.name} ⚠️`;
    return `${info.emoji} ${info.name} ${r.count}개`;
  });

  return [
    callout(`🔍 "${keyword}" — ${totalCount}개`, '🔍'),
    paragraph(`${summaryParts.join('  ·  ')}  (${duration}초)`, 'gray'),
    divider(),
  ];
}

// 더보기 안내 callout (남은 개수 포함)
export function buildLoadMoreCallout(remaining: number): NotionBlock {
  return callout(
    `⏬ ${remaining}개 결과가 더 있습니다 — '더보기' 버튼을 클릭하세요`,
    '⏬',
  );
}

// 탭 내부 콘텐츠 아이템 블록 (bookmark + 메타데이터)
export function buildTabItemBlocks(item: ContentItem): NotionBlock[] {
  const blocks: NotionBlock[] = [];

  const mediaBlock = buildMediaBlock(item);
  blocks.push(mediaBlock ?? { object: 'block', type: 'bookmark', bookmark: { url: item.url } });

  const metaParts: string[] = [];
  if (item.author) metaParts.push(`👤 ${item.author}`);
  if (item.published_at) metaParts.push(`📅 ${item.published_at.slice(0, 10)}`);
  if (metaParts.length > 0) {
    blocks.push(paragraph(metaParts.join('  ·  '), 'gray'));
  }

  return blocks;
}

// 서브페이지 내부 콘텐츠 블록
export function buildSubPageBlocks(item: FlatResult): NotionBlock[] {
  const info = PLATFORM_INFO[item.platform];
  const blocks: NotionBlock[] = [];

  const metaParts = [`${info.emoji} ${info.name}`];
  if (item.author) metaParts.push(`👤 ${item.author}`);
  if (item.published_at) metaParts.push(`📅 ${item.published_at.slice(0, 10)}`);
  blocks.push(paragraph(metaParts.join('  ·  '), 'gray'));

  // 숏츠/TikTok/Reels는 임베딩하고, 그 외 링크는 bookmark 블록으로 — Notion이 OG 데이터를 자동 로드
  const mediaBlock = buildMediaBlock(item);
  blocks.push(mediaBlock ?? { object: 'block', type: 'bookmark', bookmark: { url: item.url } });

  const desc = item.snippet || item.description;
  if (desc) {
    const truncated = desc.length > 500 ? desc.slice(0, 500) + '…' : desc;
    blocks.push(paragraph(truncated));
  }

  return blocks;
}

// === Helper 함수들 ===

function buildMediaBlock(item: ContentItem): NotionBlock | null {
  if (item.platform === 'youtube_shorts') {
    return {
      object: 'block',
      type: 'video',
      video: { type: 'external', external: { url: item.url } },
    };
  }

  if (item.platform === 'tiktok' || item.platform === 'instagram_reels') {
    return {
      object: 'block',
      type: 'embed',
      embed: { url: item.url },
    };
  }

  if (item.thumbnail) {
    return {
      object: 'block',
      type: 'image',
      image: { type: 'external', external: { url: item.thumbnail } },
    };
  }

  return null;
}

function toggle(title: string, children: NotionBlock[]): NotionBlock {
  return {
    object: 'block',
    type: 'toggle',
    toggle: {
      rich_text: [{ type: 'text', text: { content: title }, annotations: { bold: true } }],
      children,
    },
  };
}

function heading2(text: string): NotionBlock {
  return {
    object: 'block',
    type: 'heading_2',
    heading_2: { rich_text: [{ type: 'text', text: { content: text } }] },
  };
}

function paragraph(text: string, color?: string): NotionBlock {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content: text } }],
      ...(color && { color }),
    },
  };
}

function paragraphIndent(text: string, color: string = 'default'): NotionBlock {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content: `   ${text}` } }],
      color,
    },
  };
}

function callout(text: string, emoji: string): NotionBlock {
  return {
    object: 'block',
    type: 'callout',
    callout: {
      rich_text: [{ type: 'text', text: { content: text } }],
      icon: { type: 'emoji', emoji },
      color: 'gray_background',
    },
  };
}

function divider(): NotionBlock {
  return { object: 'block', type: 'divider', divider: {} };
}

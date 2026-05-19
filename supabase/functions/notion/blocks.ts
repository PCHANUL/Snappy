// 노션 페이지에 추가할 블록 생성
// 매체별 결과를 toggle 블록으로 묶어 페이지를 깔끔하게 유지

import { PLATFORM_INFO } from '../_shared/types.ts';
import type { ContentItem, SearchResult, SearchMetadata } from '../_shared/types.ts';

type NotionBlock = Record<string, any>;

export function buildResultBlocks(
  keyword: string,
  results: SearchResult[],
  metadata: SearchMetadata,
): NotionBlock[] {
  const totalCount = results.reduce((sum, r) => sum + r.count, 0);

  const blocks: NotionBlock[] = [
    callout(
      `🔍 "${keyword}" — ${totalCount}개 발견 | ${(metadata.duration_ms / 1000).toFixed(1)}초`,
      '🔍',
    ),
    divider(),
  ];

  for (const result of results) {
    const info = PLATFORM_INFO[result.platform];

    if (result.items.length === 0) {
      const msg = result.error ? `⚠️ 검색 실패: ${result.error}` : '결과를 찾지 못했습니다.';
      blocks.push(toggle(`${info.emoji} ${info.name}`, [paragraph(msg, 'gray')]));
      continue;
    }

    const children: NotionBlock[] = [];
    for (const [idx, item] of result.items.entries()) {
      children.push(...buildContentItemBlocks(idx + 1, item));
    }
    blocks.push(toggle(`${info.emoji} ${info.name}  (${result.count}개)`, children));
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
    blocks.push(paragraphIndent(metaParts.join('  •  '), 'gray'));
  }

  const desc = item.snippet || item.description;
  if (desc) {
    const truncated = desc.length > 200 ? desc.slice(0, 200) + '…' : desc;
    blocks.push(paragraphIndent(truncated));
  }

  return blocks;
}

// === Helper 함수들 ===

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

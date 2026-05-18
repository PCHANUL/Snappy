// 노션 페이지에 추가할 블록 생성
// API 문서: https://developers.notion.com/reference/block

import { PLATFORM_INFO } from '../_shared/types.ts';
import type { ContentItem, SearchResult, SearchMetadata } from '../_shared/types.ts';

// 노션 블록 타입 (간소화된 형태)
type NotionBlock = Record<string, any>;

export function buildResultBlocks(
  keyword: string,
  results: SearchResult[],
  metadata: SearchMetadata,
): NotionBlock[] {
  const blocks: NotionBlock[] = [];

  // 검색 정보 헤더
  blocks.push(
    callout(
      `🔍 "${keyword}" 검색 결과 | 소요 ${(metadata.duration_ms / 1000).toFixed(1)}초`,
      '🔍',
    ),
  );
  blocks.push(divider());

  // 매체별 결과
  for (const result of results) {
    const info = PLATFORM_INFO[result.platform];

    // 결과가 없거나 에러난 경우
    if (result.items.length === 0) {
      blocks.push(heading2(`${info.emoji} ${info.name}`));
      if (result.error) {
        blocks.push(paragraph(`⚠️ 검색 실패: ${result.error}`));
      } else {
        blocks.push(paragraph('해당 매체에서 결과를 찾지 못했습니다.'));
      }
      blocks.push(divider());
      continue;
    }

    // 정상 결과
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

  // 제목 (링크 포함)
  blocks.push({
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [
        {
          type: 'text',
          text: { content: `${idx}. ` },
          annotations: { bold: true },
        },
        {
          type: 'text',
          text: { content: item.title, link: { url: item.url } },
          annotations: { bold: true },
        },
      ],
    },
  });

  // 메타 정보 (작성자, 발행일)
  const metaParts: string[] = [];
  if (item.author) metaParts.push(`👤 ${item.author}`);
  if (item.published_at) {
    const date = item.published_at.slice(0, 10);
    metaParts.push(`📅 ${date}`);
  }

  if (metaParts.length > 0) {
    blocks.push(paragraphIndent(metaParts.join('  •  '), 'gray'));
  }

  // 설명/스니펫 (최대 200자)
  const desc = item.snippet || item.description;
  if (desc) {
    const truncated = desc.length > 200 ? desc.slice(0, 200) + '...' : desc;
    blocks.push(paragraphIndent(truncated));
  }

  return blocks;
}

// === Helper 함수들 ===

function heading2(text: string): NotionBlock {
  return {
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: text } }],
    },
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

// 들여쓰기된 문단 (리스트 항목의 보조 정보용)
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
  return {
    object: 'block',
    type: 'divider',
    divider: {},
  };
}

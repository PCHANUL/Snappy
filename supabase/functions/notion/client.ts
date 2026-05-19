// 노션 API 클라이언트
// 사용자별 노션 API 키로 인증하여 사용자 워크스페이스의 페이지 업데이트

import { NotionApiError } from '../_shared/errors.ts';
import { logger } from '../_shared/logger.ts';
import { buildResultBlocks } from './blocks.ts';
import type { SearchResult, SearchMetadata, SearchStatus } from '../_shared/types.ts';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_API_VERSION = '2022-06-28';
const MAX_BLOCKS_PER_REQUEST = 100;

export class NotionClient {
  constructor(private apiKey: string) {}

  // 페이지 상태만 업데이트
  async updatePageStatus(
    pageId: string,
    status: SearchStatus,
    errorMessage?: string,
  ): Promise<void> {
    const properties: Record<string, any> = {
      '상태': { status: { name: status } },
    };

    if (errorMessage && status === '실패') {
      // 실패 시 에러 메시지를 페이지 본문에 추가
      await this.appendBlocks(pageId, [
        {
          object: 'block',
          type: 'callout',
          callout: {
            rich_text: [
              { type: 'text', text: { content: `검색 실패: ${errorMessage}` } },
            ],
            icon: { type: 'emoji', emoji: '⚠️' },
            color: 'red_background',
          },
        },
      ]);
    }

    await this.fetchApi(`pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties }),
    });
  }

  // 검색 결과 전체를 페이지에 저장
  async updatePageWithResults(
    pageId: string,
    keyword: string,
    results: SearchResult[],
    metadata: SearchMetadata,
  ): Promise<void> {
    const totalCount = results.reduce((sum, r) => sum + r.count, 0);

    // 1. 속성 업데이트
    await this.fetchApi(`pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        properties: {
          '상태': { status: { name: '완료' } },
          '발견 콘텐츠 수': { number: totalCount },
        },
      }),
    });

    // 2. 페이지 본문에 결과 블록 추가
    const blocks = buildResultBlocks(keyword, results, metadata);
    await this.appendBlocks(pageId, blocks);

    logger.info('Notion page updated', {
      pageId,
      totalCount,
      blockCount: blocks.length,
    });
  }

  // 블록 추가 (100개 단위 분할)
  private async appendBlocks(pageId: string, blocks: any[]): Promise<void> {
    for (let i = 0; i < blocks.length; i += MAX_BLOCKS_PER_REQUEST) {
      const chunk = blocks.slice(i, i + MAX_BLOCKS_PER_REQUEST);
      await this.fetchApi(`blocks/${pageId}/children`, {
        method: 'PATCH',
        body: JSON.stringify({ children: chunk }),
      });

      // Rate limit 회피: 노션 API는 초당 3회 제한
      if (i + MAX_BLOCKS_PER_REQUEST < blocks.length) {
        await sleep(400);
      }
    }
  }

  // 공통 fetch 함수 — 429/5xx 시 최대 2회 재시도
  private async fetchApi(path: string, init: RequestInit, retries = 2): Promise<any> {
    const response = await fetch(`${NOTION_API_BASE}/${path}`, {
      ...init,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Notion-Version': NOTION_API_VERSION,
        ...(init.headers || {}),
      },
    });

    if (!response.ok) {
      if (retries > 0 && (response.status === 429 || response.status >= 500)) {
        const delay = response.status === 429 ? 1500 : 800;
        await sleep(delay);
        return this.fetchApi(path, init, retries - 1);
      }

      const body = await response.text();
      logger.error('Notion API error', undefined, {
        path,
        status: response.status,
        body: body.slice(0, 500),
      });
      throw new NotionApiError(`${response.status}: ${body.slice(0, 200)}`);
    }

    return await response.json();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

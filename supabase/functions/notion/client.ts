// 노션 API 클라이언트
// 사용자별 노션 API 키로 인증하여 사용자 워크스페이스의 페이지 업데이트

import { NotionApiError } from '../_shared/errors.ts';
import { logger } from '../_shared/logger.ts';
import { buildResultBlocks } from './blocks.ts';
import type { Platform, Period, SearchResult, SearchMetadata, SearchStatus } from '../_shared/types.ts';

// Notion DB 옵션값 → 내부 ID 매핑
const PLATFORM_MAP: Record<string, Platform> = {
  '네이버블로그': 'naver_blog', '네이버 블로그': 'naver_blog', 'naver_blog': 'naver_blog',
  '유튜브': 'youtube', 'youtube': 'youtube',
  '티스토리': 'tistory', 'tistory': 'tistory',
  '브런치': 'brunch', 'brunch': 'brunch',
};

const PERIOD_MAP: Record<string, Period> = {
  '1일': 'day', 'day': 'day',
  '1주': 'week', 'week': 'week',
  '1개월': 'month', 'month': 'month',
  '1년': 'year', 'year': 'year',
};

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
    // 검색 시작 시 이전 결과 제거 — 재검색해도 stale 블록이 남지 않도록
    if (status === '검색중') {
      await this.clearPageBlocks(pageId);
    }

    if (errorMessage && status === '실패') {
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
      body: JSON.stringify({ properties: { '상태': { status: { name: status } } } }),
    });
  }

  // 페이지의 모든 블록 삭제 (재검색 전 초기화)
  private async clearPageBlocks(pageId: string): Promise<void> {
    let cursor: string | undefined;
    do {
      const qs = cursor ? `?start_cursor=${cursor}&page_size=100` : '?page_size=100';
      const data = await this.fetchApi(`blocks/${pageId}/children${qs}`, { method: 'GET' });
      const ids: string[] = data.results.map((b: any) => b.id);

      for (let i = 0; i < ids.length; i += 10) {
        await Promise.all(
          ids.slice(i, i + 10).map((id) => this.fetchApi(`blocks/${id}`, { method: 'DELETE' })),
        );
        if (i + 10 < ids.length) await sleep(400);
      }

      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);
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

  // Notion DB 행의 속성에서 검색 파라미터를 읽어온다
  async readSearchParams(pageId: string): Promise<{
    keyword: string;
    platforms: Platform[];
    period: Period;
    result_count: number;
  }> {
    const data = await this.fetchApi(`pages/${pageId}`, { method: 'GET' });
    const props = data.properties || {};

    const keyword = (props['키워드']?.title || [])
      .map((t: any) => t.plain_text).join('').trim();

    const platforms = ((props['매체']?.multi_select || []) as { name: string }[])
      .map(s => PLATFORM_MAP[s.name.trim()])
      .filter((p): p is Platform => Boolean(p));

    const period: Period = PERIOD_MAP[props['기간']?.select?.name?.trim() || ''] || 'month';

    const countRaw = props['결과 개수']?.select?.name;
    const result_count = countRaw ? Math.max(5, Math.min(20, parseInt(countRaw, 10))) : 10;

    // 페이지의 부모 DB ID (소유권 검증용)
    const parentDbId = ((data.parent?.database_id as string) || '').replace(/-/g, '');

    return { keyword, platforms, period, result_count, parentDbId };
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

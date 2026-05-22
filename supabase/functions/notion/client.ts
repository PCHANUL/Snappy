// 노션 API 클라이언트
// 사용자별 노션 API 키로 인증하여 사용자 워크스페이스의 페이지 업데이트

import { NotionApiError } from '../_shared/errors.ts';
import { logger } from '../_shared/logger.ts';
import { buildResultBlocks, buildSummaryBlocks, buildLoadMoreCallout, buildSubPageBlocks } from './blocks.ts';
import type { FlatResult, Platform, Period, SearchResult, SearchMetadata, SearchStatus } from '../_shared/types.ts';
import { PLATFORM_INFO } from '../_shared/types.ts';

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

  // 서브페이지 방식으로 검색 결과를 페이지에 저장 (첫 배치)
  async updatePageWithSubPages(
    pageId: string,
    keyword: string,
    firstBatch: FlatResult[],
    results: SearchResult[],
    metadata: SearchMetadata,
    hasMore: boolean,
    totalCount: number,
  ): Promise<void> {
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

    // 2. 요약 블록 추가 (callout + 플랫폼별 요약 + divider)
    const summaryBlocks = buildSummaryBlocks(keyword, results, metadata);
    await this.appendBlocks(pageId, summaryBlocks);

    // 3. 첫 배치 서브페이지 생성
    await this.createResultSubPages(pageId, firstBatch);

    // 4. 더보기 안내 (남은 항목 있을 때)
    if (hasMore) {
      const remaining = totalCount - firstBatch.length;
      await this.appendBlocks(pageId, [buildLoadMoreCallout(remaining)]);
    }

    logger.info('Notion page updated with sub-pages', { pageId, totalCount, shown: firstBatch.length });
  }

  // 배치 서브페이지 생성 (더보기용)
  async createResultSubPages(parentPageId: string, items: FlatResult[]): Promise<void> {
    for (const item of items) {
      await this.createResultSubPage(parentPageId, item);
      await sleep(350);
    }
  }

  // 더보기 후 안내 callout 교체: 기존 "더보기" callout 삭제 → 새 callout 추가
  async appendLoadMoreCallout(pageId: string, remaining: number): Promise<void> {
    // 마지막 블록이 더보기 callout이면 삭제 후 재추가
    const data = await this.fetchApi(`blocks/${pageId}/children?page_size=100`, { method: 'GET' });
    const blocks = data.results || [];
    const last = blocks[blocks.length - 1];
    if (last?.type === 'callout' && last.callout?.rich_text?.[0]?.text?.content?.startsWith('📄')) {
      await this.fetchApi(`blocks/${last.id}`, { method: 'DELETE' });
    }
    if (remaining > 0) {
      await this.appendBlocks(pageId, [buildLoadMoreCallout(remaining)]);
    }
  }

  private async createResultSubPage(parentPageId: string, item: FlatResult): Promise<void> {
    const info = PLATFORM_INFO[item.platform];
    const body: Record<string, any> = {
      parent: { page_id: parentPageId },
      icon: { type: 'emoji', emoji: info.emoji },
      properties: {
        title: { title: [{ type: 'text', text: { content: item.title } }] },
      },
      children: buildSubPageBlocks(item),
    };
    if (item.thumbnail) {
      body.cover = { type: 'external', external: { url: item.thumbnail } };
    }
    await this.fetchApi('pages', { method: 'POST', body: JSON.stringify(body) });
  }

  // 검색 DB의 부모 페이지와 그 하위 페이지에서 search.html embed URL에 user_id를 삽입
  // 노션 템플릿 셋업 완료 시 1회 호출됨
  async updateSearchEmbeds(databaseId: string, userId: string): Promise<number> {
    const db = await this.fetchApi(`databases/${databaseId}`, { method: 'GET' });
    const rawParentId: string = db.parent?.page_id || '';
    if (!rawParentId) return 0;

    let count = 0;

    // 메인 페이지의 embed 업데이트
    count += await this.updateEmbedsOnPage(rawParentId, userId);

    // 직계 child_page (설정 페이지 등)의 embed도 업데이트
    const blocksData = await this.fetchApi(`blocks/${rawParentId}/children?page_size=100`, { method: 'GET' });
    for (const block of (blocksData.results as any[])) {
      if (block.type === 'child_page') {
        count += await this.updateEmbedsOnPage(block.id as string, userId);
        await sleep(200);
      }
    }

    return count;
  }

  private async updateEmbedsOnPage(pageId: string, userId: string): Promise<number> {
    let count = 0;
    let cursor: string | undefined;

    do {
      const qs = cursor ? `?start_cursor=${cursor}&page_size=100` : '?page_size=100';
      const data = await this.fetchApi(`blocks/${pageId}/children${qs}`, { method: 'GET' });

      for (const block of (data.results as any[])) {
        if (block.type !== 'embed') continue;
        const url: string = block.embed?.url || '';
        if (!url.includes('search.html') || url.includes('user_id=')) continue;

        const base = url.split('?')[0];
        await this.fetchApi(`blocks/${block.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ embed: { url: `${base}?user_id=${encodeURIComponent(userId)}` } }),
        });
        count++;
        await sleep(300);
      }

      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    return count;
  }

  // 사용자의 검색 DB에 새 행을 생성하고 페이지 ID를 반환
  async createSearchPage(
    databaseId: string,
    params: {
      keyword: string;
      platforms: Platform[];
      period: Period;
      result_count: number;
      user_id: string;
    },
  ): Promise<string> {
    const PLATFORM_NAMES: Record<Platform, string> = {
      naver_blog: '네이버블로그',
      youtube: '유튜브',
      tistory: '티스토리',
      brunch: '브런치',
    };
    const PERIOD_NAMES: Record<Period, string> = {
      day: '1일', week: '1주', month: '1개월', year: '1년',
    };

    const page = await this.fetchApi('pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties: {
          '키워드':     { title: [{ type: 'text', text: { content: params.keyword } }] },
          '매체':       { multi_select: params.platforms.map(p => ({ name: PLATFORM_NAMES[p] })) },
          '기간':       { select: { name: PERIOD_NAMES[params.period] } },
          '결과 개수':  { select: { name: String(params.result_count) } },
          '상태':       { status: { name: '대기' } },
          'user_id':    { rich_text: [{ type: 'text', text: { content: params.user_id } }] },
        },
      }),
    });
    return page.id as string;
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

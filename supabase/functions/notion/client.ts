// 노션 API 클라이언트
// 사용자별 노션 API 키로 인증하여 사용자 워크스페이스의 페이지 업데이트

import { NotionApiError } from '../_shared/errors.ts';
import { logger } from '../_shared/logger.ts';
import { buildResultBlocks, buildSummaryBlocks, buildLoadMoreCallout, buildSubPageBlocks, buildTabItemBlocks } from './blocks.ts';
import type { FlatResult, Platform, Period, SearchResult, SearchMetadata, SearchStatus } from '../_shared/types.ts';
import { PLATFORM_INFO } from '../_shared/types.ts';

// 내부 ID → Notion DB 옵션값 매핑 (검색 DB 행 생성 시 사용)
const PLATFORM_TO_NOTION: Record<Platform, string> = {
  naver_blog: '네이버블로그',
  youtube: '유튜브',
  tistory: '티스토리',
  brunch: '브런치',
};

const PERIOD_TO_NOTION: Record<Period, string> = {
  day: '1일',
  week: '1주',
  month: '1개월',
  year: '1년',
};

const STATUS_FALLBACK: Record<SearchStatus, string> = {
  '대기': 'Not started',
  '검색중': 'In progress',
  '완료': 'Done',
  '실패': 'Done',
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

    await this.fetchApiWithStatusFallback(`pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties: { '상태': statusValue(status) } }),
    }, status);
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
    await this.fetchApiWithStatusFallback(`pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        properties: {
          '상태': statusValue('완료'),
          '발견 콘텐츠 수': { number: totalCount },
        },
      }),
    }, '완료');

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
    await this.fetchApiWithStatusFallback(`pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        properties: {
          '상태': statusValue('완료'),
          '발견 콘텐츠 수': { number: totalCount },
        },
      }),
    }, '완료');

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

  // 매체별 탭 + 콘텐츠 블록으로 검색 결과를 페이지에 저장
  async updatePageWithTabs(
    pageId: string,
    keyword: string,
    results: SearchResult[],
    metadata: SearchMetadata,
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

    // 2. 요약 callout 추가
    const summaryBlocks = buildSummaryBlocks(keyword, results, metadata);
    await this.appendBlocks(pageId, summaryBlocks);

    // 3. 결과가 있는 매체만 탭으로 생성
    const nonEmpty = results.filter(r => r.items.length > 0);
    if (nonEmpty.length === 0) return;

    // 4. tab 블록 생성 — 매체 이름을 paragraph 텍스트(탭 라벨)로, children은 이후 추가
    const tabBlock = {
      type: 'tab',
      tab: {},
      children: nonEmpty.map(r => {
        const info = PLATFORM_INFO[r.platform];
        return {
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: `${info.emoji} ${info.name}` } }],
          },
        };
      }),
    };

    const tabResult = await this.fetchApi(`blocks/${pageId}/children`, {
      method: 'PATCH',
      body: JSON.stringify({ children: [tabBlock] }),
    });

    const createdTabId = tabResult.results?.[0]?.id as string | undefined;
    if (!createdTabId) {
      logger.error('Failed to get created tab block id', undefined, { pageId });
      return;
    }

    // 5. 생성된 탭의 paragraph block ID 목록 조회
    await sleep(300);
    const tabChildren = await this.fetchApi(`blocks/${createdTabId}/children`, { method: 'GET' });
    const panelBlocks = (tabChildren.results as any[]) ?? [];

    // 6. 각 패널(paragraph)에 해당 매체 콘텐츠 블록 추가
    for (let i = 0; i < panelBlocks.length; i++) {
      const panelId = panelBlocks[i].id as string;
      const contentBlocks = nonEmpty[i].items.flatMap(item => buildTabItemBlocks(item));
      await this.appendBlocks(panelId, contentBlocks);
      if (i < panelBlocks.length - 1) await sleep(350);
    }

    logger.info('Notion page updated with tabs', { pageId, platforms: nonEmpty.length, totalCount });
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

  // 검색 DB에 새 행(페이지)을 생성한다 — 검색 파라미터를 속성으로 기록, 상태=검색중
  // 생성된 페이지 ID를 반환 (결과 서브페이지의 부모로 사용)
  async createSearchEntry(
    databaseId: string,
    params: { keyword: string; platforms: Platform[]; period: Period },
  ): Promise<string> {
    const res = await this.fetchApiWithStatusFallback('pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { database_id: toUuid(databaseId) },
        icon: { type: 'emoji', emoji: '🔍' },
        properties: {
          '키워드': { title: [{ type: 'text', text: { content: params.keyword } }] },
          '상태': statusValue('검색중'),
          '매체': { multi_select: params.platforms.map((p) => ({ name: PLATFORM_TO_NOTION[p] })) },
          '기간': { select: { name: PERIOD_TO_NOTION[params.period] } },
        },
      }),
    }, '검색중');
    return res.id as string;
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

  private async fetchApiWithStatusFallback(
    path: string,
    init: RequestInit,
    status: SearchStatus,
  ): Promise<any> {
    try {
      return await this.fetchApi(path, init);
    } catch (error) {
      if (!isInvalidStatusOption(error)) throw error;

      const fallback = STATUS_FALLBACK[status];
      if (!fallback || fallback === status || !init.body) throw error;

      const body = JSON.parse(String(init.body));
      if (!body.properties?.['상태']) throw error;

      body.properties['상태'] = statusValue(fallback);
      logger.info('Notion status option fallback applied', { path, status, fallback });

      return await this.fetchApi(path, {
        ...init,
        body: JSON.stringify(body),
      });
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

  // 노션 DB 부모 페이지의 search.html 임베드 블록 URL을 user_id + page_id 포함 URL로 교체
  async updateSearchEmbed(databaseId: string, userId: string): Promise<string> {
    try {
      const parentPageId = await this.getDatabaseParentPageId(databaseId);
      const embed = await this.findSearchEmbedInPage(parentPageId);
      const newUrl = `https://pchanul.github.io/Snappy/search.html?user_id=${userId}&page_id=${parentPageId}`;

      if (embed) {
        await this.fetchApi(`blocks/${embed.blockId}`, {
          method: 'PATCH',
          body: JSON.stringify({ embed: { url: newUrl } }),
        });
      } else {
        await this.appendBlocks(parentPageId, [
          {
            object: 'block',
            type: 'embed',
            embed: { url: newUrl },
          },
        ]);
      }

      logger.info('Search embed updated', { userId, parentPageId, created: !embed });
      return newUrl;
    } catch (error) {
      if (error instanceof NotionApiError) {
        const message = error.message.replace(/^Notion API error: /, '');
        throw new NotionApiError(
          message,
          '검색 버튼 자동 연결에 실패했습니다. Notion 연결을 다시 진행하면서 복제한 Snappy 메인 페이지를 선택해주세요.',
        );
      }
      throw error;
    }
  }

  // 검색 진행 중 상태를 임베드 URL 파라미터로 표현
  // searching=true  → URL에 &searching=1 추가
  // searching=false → &searching=1 제거 (완료/실패 후 복원)
  async setSearchEmbedStatus(databaseId: string, searching: boolean): Promise<void> {
    const parentPageId = await this.getDatabaseParentPageId(databaseId);
    const embed = await this.findSearchEmbedInPage(parentPageId);
    if (!embed) return; // 임베드 블록 없으면 무시 (non-fatal)

    const url = new URL(embed.currentUrl);
    if (searching) {
      url.searchParams.set('searching', '1');
    } else {
      url.searchParams.delete('searching');
    }
    const newUrl = url.toString();
    if (newUrl === embed.currentUrl) return; // 변경 불필요

    await this.fetchApi(`blocks/${embed.blockId}`, {
      method: 'PATCH',
      body: JSON.stringify({ embed: { url: newUrl } }),
    });

    logger.info('Search embed status updated', { searching, newUrl });
  }

  // 통합이 접근 가능한 객체(페이지/DB)가 하나라도 있는지 조회 — 연결 검증용
  async searchAccessible(): Promise<any[]> {
    const data = await this.fetchApi('search', {
      method: 'POST',
      body: JSON.stringify({ page_size: 5 }),
    });
    return (data.results as any[]) || [];
  }

  // 통합이 접근 가능한 모든 페이지의 제목 목록 조회 (연결된 페이지 표시용)
  async listAccessiblePages(): Promise<{ id: string; title: string }[]> {
    const data = await this.fetchApi('search', {
      method: 'POST',
      body: JSON.stringify({
        filter: { value: 'page', property: 'object' },
        page_size: 50,
      }),
    });
    return ((data.results as any[]) || [])
      .filter((obj) => obj.parent?.type === 'workspace')
      .map((obj) => {
        const titleProp = Object.values(obj.properties || {})
          .find((p: any) => (p as any)?.type === 'title') as { title?: any[] } | undefined;
        const title = (titleProp?.title || []).map((t: any) => t.plain_text).join('').trim();
        return { id: (obj.id as string).replace(/-/g, ''), title };
      })
      .filter((p) => p.title);
  }

  // 제목 쿼리로 검색 — 연결된 객체 중 해당 이름이 있는지 확인용
  // 반환값: 결과 배열, 또는 접근 가능한 객체가 아예 없으면 null
  async searchByTitle(title: string): Promise<any[] | null> {
    // 먼저 전체 접근 가능 객체 수 확인
    const all = await this.fetchApi('search', {
      method: 'POST',
      body: JSON.stringify({ page_size: 1 }),
    });
    if (!((all.results as any[]) || []).length) return null;

    // 제목 쿼리로 검색
    const data = await this.fetchApi('search', {
      method: 'POST',
      body: JSON.stringify({ query: title, page_size: 20 }),
    });
    return (data.results as any[]) || [];
  }

  // duplicated_template_id로부터 검색 DB ID 해석
  // 템플릿 루트가 페이지일 수도(내부 인라인 DB), 데이터베이스 자체일 수도 있어 둘 다 처리
  async resolveSearchDatabase(duplicatedId: string): Promise<string | null> {
    const id = duplicatedId.replace(/-/g, '');

    // 1. duplicated_template_id 자체가 데이터베이스인 경우
    try {
      const db = await this.fetchApi(`databases/${toUuid(id)}`, { method: 'GET' });
      if (db?.object === 'database') return id;
    } catch { /* 페이지일 수 있으므로 무시 */ }

    // 2. 페이지인 경우 → 내부 자식 데이터베이스 탐색
    return await this.findChildDatabaseId(id);
  }

  // 페이지 내 자식 데이터베이스 ID 탐색 (템플릿 복제 후 검색 DB 자동 연동용)
  async findChildDatabaseId(pageId: string): Promise<string | null> {
    let cursor: string | undefined;
    do {
      const qs = new URLSearchParams({ page_size: '100' });
      if (cursor) qs.set('start_cursor', cursor);

      const data = await this.fetchApi(`blocks/${pageId.replace(/-/g, '')}/children?${qs.toString()}`, { method: 'GET' });
      const block = (data.results as any[]).find((b) => b.type === 'child_database');
      if (block) return (block.id as string).replace(/-/g, '');

      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    return null;
  }

  private async getDatabaseParentPageId(databaseId: string): Promise<string> {
    const dbInfo = await this.fetchApi(`databases/${toUuid(databaseId)}`, { method: 'GET' });
    const rawParentId: string | undefined = dbInfo.parent?.page_id;
    if (!rawParentId) {
      throw new NotionApiError(
        'database parent page not found',
        '검색 DB의 부모 페이지를 찾을 수 없습니다. 복제한 Snappy 메인 페이지를 선택해 다시 연결해주세요.',
      );
    }
    return rawParentId.replace(/-/g, '');
  }

  // DB 부모 페이지에서 search.html 임베드 블록 탐색 (공통 헬퍼)
  private async findSearchEmbedInPage(
    parentPageId: string,
  ): Promise<{ blockId: string; currentUrl: string } | null> {
    let cursor: string | undefined;
    do {
      const qs = new URLSearchParams({ page_size: '100' });
      if (cursor) qs.set('start_cursor', cursor);

      const data = await this.fetchApi(`blocks/${parentPageId}/children?${qs.toString()}`, { method: 'GET' });
      const block = (data.results as any[]).find(
        (b) => b.type === 'embed' && typeof b.embed?.url === 'string' && b.embed.url.includes('search.html'),
      );
      if (block) {
        return {
          blockId: block.id,
          currentUrl: block.embed.url as string,
        };
      }

      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    return null;
  }
}

function toUuid(id: string): string {
  const s = id.replace(/-/g, '');
  return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
}

function statusValue(status: string): { status: { name: string } } {
  return { status: { name: status } };
}

function isInvalidStatusOption(error: unknown): boolean {
  return error instanceof NotionApiError && error.message.includes('Invalid status option');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

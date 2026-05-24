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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 노션 API 클라이언트
// 사용자별 노션 API 키로 인증하여 사용자 워크스페이스의 페이지 업데이트

import { NotionApiError } from '../_core/errors.ts';
import { logger } from '../_core/logger.ts';
import { buildResultBlocks, buildSummaryBlocks, buildLoadMoreCallout, buildSubPageBlocks, buildTabItemBlocks } from './blocks.ts';
import type { FlatResult, Platform, Period, SearchResult, SearchMetadata, SearchStatus } from '../_core/types.ts';
import { PLATFORM_INFO } from '../_core/types.ts';
import type { AnalysisResult } from '../_analysis/content-analyzer.ts';

// 검색 결과 행에 추가된 콘텐츠 — 분석 루프 대상
export interface CreatedRow {
  rowId: string;
  url: string;
  platform: Platform;
  title: string;
}

// 콘텐츠 분석 결과를 담는 DB 속성 이름 (템플릿/프로그램 DB 공통)
const ANALYSIS_PROPS = {
  summary: '요약',
  keywords: '키워드',
  status: '분석 상태',
} as const;

const ANALYSIS_STATUS = { analyzing: '분석중', done: '완료', failed: '실패' } as const;

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
const NOTION_TEMPLATE_API_VERSION = '2026-03-11';
const MAX_BLOCKS_PER_REQUEST = 100;
const SEARCH_DATABASE_TITLE = '검색 DB';
const SEARCH_TEMPLATE_PAGE_TITLE = '검색 결과 템플릿';

export class NotionClient {
  private pagesCreatedWithTemplate = new Set<string>();

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
    // 1. 속성 업데이트 (status fallback 포함)
    await this.fetchApiWithStatusFallback(`pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        properties: {
          '상태': statusValue('완료'),
          '발견 콘텐츠 수': { number: totalCount },
        },
      }),
    }, '완료');

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

  // 검색 결과 페이지 내에 콘텐츠 child database 생성 — 매체별 보드 뷰용
  async createContentDatabase(pageId: string, keyword: string): Promise<string> {
    const res = await this.fetchApi('databases', {
      method: 'POST',
      body: JSON.stringify({
        parent: { page_id: toUuid(pageId) },
        is_inline: true,
        title: [{ type: 'text', text: { content: `콘텐츠 — ${keyword}` } }],
        properties: {
          '제목': { title: {} },
          '매체': {
            select: {
              options: [
                { name: '네이버블로그', color: 'green' },
                { name: '유튜브', color: 'red' },
                { name: '티스토리', color: 'orange' },
                { name: '브런치', color: 'purple' },
              ],
            },
          },
          'URL': { url: {} },
          '작성자': { rich_text: {} },
          '날짜': { date: {} },
          // 콘텐츠 분석 결과 컬럼 — 테이블 뷰에서 정렬·필터·비교 가능
          [ANALYSIS_PROPS.summary]: { rich_text: {} },
          [ANALYSIS_PROPS.keywords]: { multi_select: {} },
          [ANALYSIS_PROPS.status]: {
            select: {
              options: [
                { name: ANALYSIS_STATUS.analyzing, color: 'yellow' },
                { name: ANALYSIS_STATUS.done, color: 'green' },
                { name: ANALYSIS_STATUS.failed, color: 'red' },
              ],
            },
          },
        },
      }),
    });
    return (res.id as string).replace(/-/g, '');
  }

  // 연결된 페이지 안에 Snappy 검색 DB를 보장한다.
  // 이미 같은 DB가 있으면 재사용하고, 없으면 인라인 데이터베이스를 생성한다.
  async ensureSearchDatabase(parentPageId: string): Promise<{ id: string; title: string; created: boolean }> {
    const existing = await this.findSearchDatabaseOnPage(parentPageId);
    if (existing) {
      return { ...existing, created: false };
    }

    let res: any;
    try {
      res = await this.fetchApi('databases', {
        method: 'POST',
        body: JSON.stringify(searchDatabaseBody(parentPageId, true)),
      });
    } catch (error) {
      if (!isUnsupportedButtonProperty(error)) throw error;

      logger.warn('Notion button property is not creatable; retrying search DB without load-more button', {
        parentPageId,
        error: error instanceof Error ? error.message : String(error),
      });
      res = await this.fetchApi('databases', {
        method: 'POST',
        body: JSON.stringify(searchDatabaseBody(parentPageId, false)),
      });
    }

    return {
      id: (res.id as string).replace(/-/g, ''),
      title: getObjectTitle(res) || SEARCH_DATABASE_TITLE,
      created: true,
    };
  }

  // 콘텐츠 행(page)의 부모 DB 속성 맵 조회 — 재분석 시 분석 컬럼 확인용
  async getRowAnalysisProps(rowId: string): Promise<Map<string, string>> {
    try {
      const page = await this.fetchApi(`pages/${toUuid(rowId)}`, { method: 'GET' });
      const dbId = page.parent?.database_id as string | undefined;
      if (!dbId) return new Map();
      return await this.getDatabaseProperties(dbId);
    } catch (error) {
      logger.warn('Failed to read row parent database', {
        rowId, error: error instanceof Error ? error.message : String(error),
      });
      return new Map();
    }
  }

  // DB 속성 맵(이름 → 타입) 조회 — 분석 컬럼 존재 및 타입 검증용
  // 타입을 함께 보는 이유: 잘못된 타입으로 PATCH하면 요청 전체가 실패하므로
  async getDatabaseProperties(databaseId: string): Promise<Map<string, string>> {
    try {
      const db = await this.fetchApi(`databases/${toUuid(databaseId)}`, { method: 'GET' });
      const map = new Map<string, string>();
      for (const [name, def] of Object.entries(db.properties ?? {})) {
        map.set(name, (def as any)?.type ?? '');
      }
      return map;
    } catch (error) {
      logger.warn('Failed to read database properties', {
        databaseId, error: error instanceof Error ? error.message : String(error),
      });
      return new Map();
    }
  }

  // 콘텐츠 아이템을 child DB에 페이지(행)로 추가 — Notion 속도 제한 고려 직렬 처리
  // analysisProps에 '분석 상태'가 있으면 각 행을 '분석중'으로 표시한다.
  // 생성된 행 정보를 반환 — 이후 백그라운드 분석 루프의 대상이 된다.
  async addItemsToDatabase(
    databaseId: string,
    items: FlatResult[],
    onProgress?: (message: string) => Promise<void>,
    analysisProps?: Map<string, string>,
  ): Promise<CreatedRow[]> {
    const hasStatus = analysisProps?.get(ANALYSIS_PROPS.status) === 'select';
    const rows: CreatedRow[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const info = PLATFORM_INFO[item.platform];
      const properties: Record<string, any> = {
        '제목': { title: [{ type: 'text', text: { content: item.title } }] },
        '매체': { select: { name: PLATFORM_TO_NOTION[item.platform] } },
      };
      if (item.url) properties['URL'] = { url: item.url };
      if (item.author) properties['작성자'] = { rich_text: [{ type: 'text', text: { content: item.author } }] };
      if (item.published_at) properties['날짜'] = { date: { start: item.published_at.slice(0, 10) } };
      if (hasStatus) properties[ANALYSIS_PROPS.status] = { select: { name: ANALYSIS_STATUS.analyzing } };

      const body: Record<string, any> = {
        parent: { database_id: toUuid(databaseId) },
        icon: { type: 'emoji', emoji: info.emoji },
        properties,
      };
      if (item.thumbnail) body.cover = { type: 'external', external: { url: item.thumbnail } };

      const created = await this.fetchApi('pages', { method: 'POST', body: JSON.stringify(body) });
      if (item.url) {
        rows.push({ rowId: created.id as string, url: item.url, platform: item.platform, title: item.title });
      }

      await onProgress?.(`노션에 콘텐츠 추가 중... (${i + 1}/${items.length})`);
      if (i + 1 < items.length) await sleep(350);
    }

    return rows;
  }

  // 콘텐츠 행의 분석 결과를 DB 속성으로 업데이트 (타입이 일치하는 속성만)
  async updateRowAnalysis(rowId: string, result: AnalysisResult, analysisProps: Map<string, string>): Promise<void> {
    const properties: Record<string, any> = {};

    if (analysisProps.get(ANALYSIS_PROPS.status) === 'select') {
      properties[ANALYSIS_PROPS.status] = {
        select: { name: result.status === 'done' ? ANALYSIS_STATUS.done : ANALYSIS_STATUS.failed },
      };
    }
    if (analysisProps.get(ANALYSIS_PROPS.summary) === 'rich_text' && result.summary) {
      const text = result.summarySource ? `${result.summary}\n(${result.summarySource})` : result.summary;
      properties[ANALYSIS_PROPS.summary] = {
        rich_text: [{ type: 'text', text: { content: text.slice(0, 1990) } }],
      };
    }
    if (analysisProps.get(ANALYSIS_PROPS.keywords) === 'multi_select' && result.keywords.length) {
      // multi_select 옵션명은 쉼표 불가 + 빈 문자열 불가 — 정리 후 최대 5개
      const options = result.keywords
        .slice(0, 5)
        .map((k) => k.replace(/,/g, ' ').trim().slice(0, 100))
        .filter((name) => name.length > 0)
        .map((name) => ({ name }));
      if (options.length) properties[ANALYSIS_PROPS.keywords] = { multi_select: options };
    }
    if (Object.keys(properties).length === 0) return;
    await this.fetchApi(`pages/${toUuid(rowId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties }),
    });
  }

  // 결과 페이지에 분석 진행 상태 callout 추가 → 생성된 block id 반환
  async appendAnalysisStatusCallout(pageId: string, total: number): Promise<string | null> {
    const res = await this.fetchApi(`blocks/${toUuid(pageId)}/children`, {
      method: 'PATCH',
      body: JSON.stringify({
        children: [{
          object: 'block',
          type: 'callout',
          callout: {
            rich_text: [{ type: 'text', text: { content: `🔄 콘텐츠 분석 중... (0/${total})` } }],
            icon: { type: 'emoji', emoji: '🔄' },
            color: 'yellow_background',
          },
        }],
      }),
    });
    return (res.results?.[0]?.id as string) ?? null;
  }

  // 분석 진행 상태 callout 업데이트 (진행률 또는 완료)
  async updateAnalysisStatusCallout(
    blockId: string,
    done: number,
    total: number,
    finished: boolean,
  ): Promise<void> {
    const content = finished
      ? `✅ 콘텐츠 분석 완료 — 총 ${total}개 (테이블에서 요약·키워드를 확인하세요)`
      : `🔄 콘텐츠 분석 중... (${done}/${total})`;
    await this.fetchApi(`blocks/${toUuid(blockId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        callout: {
          rich_text: [{ type: 'text', text: { content } }],
          icon: { type: 'emoji', emoji: finished ? '✅' : '🔄' },
          color: finished ? 'green_background' : 'yellow_background',
        },
      }),
    });
  }

  // 연관 인기 키워드 callout 블록을 페이지에 추가 (키워드별 DataLab ratio 표기)
  async appendRelatedKeywords(
    pageId: string,
    keywords: Array<{ keyword: string; ratio: number }>,
  ): Promise<void> {
    if (!keywords.length) return;
    const chips = keywords.map((k) => `${k.keyword} ${k.ratio}`).join('  ·  ');
    await this.appendBlocks(pageId, [
      {
        object: 'block',
        type: 'callout',
        callout: {
          rich_text: [{ type: 'text', text: { content: `🔗 연관 인기 키워드\n${chips}` } }],
          icon: { type: 'emoji', emoji: '📊' },
          color: 'blue_background',
        },
      },
    ]);
  }

  // 요약 callout + child DB로 검색 결과 페이지 완성
  async updatePageWithChildDatabase(
    pageId: string,
    keyword: string,
    results: SearchResult[],
    metadata: SearchMetadata,
    totalCount: number,
    onProgress?: (message: string) => Promise<void>,
  ): Promise<{ rows: CreatedRow[]; analysisProps: Map<string, string> }> {
    // 1. 속성 업데이트 (상태 → 완료)
    await this.fetchApiWithStatusFallback(`pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        properties: {
          '키워드': { title: [{ type: 'text', text: { content: keyword } }] },
          '상태': statusValue('완료'),
          '발견 콘텐츠 수': { number: totalCount },
        },
      }),
    }, '완료');

    const summaryBlocks = buildSummaryBlocks(keyword, results, metadata);
    const createdWithTemplate = this.pagesCreatedWithTemplate.has(toUuid(pageId));
    let databaseId: string;

    if (createdWithTemplate) {
      // 템플릿 적용은 비동기라, 콘텐츠 DB 복제가 끝난 뒤 결과 블록을 추가한다.
      await onProgress?.('콘텐츠 DB 확인 중...');
      databaseId = await this.findOrCreateContentDatabase(pageId, keyword);

      await onProgress?.('노션에 요약 작성 중...');
      await this.appendBlocks(pageId, summaryBlocks);
    } else {
      await onProgress?.('노션에 요약 작성 중...');
      await this.appendBlocks(pageId, summaryBlocks);

      await onProgress?.('콘텐츠 DB 확인 중...');
      databaseId = await this.findOrCreateContentDatabase(pageId, keyword);
    }

    // 4. DB에 분석 컬럼이 있는지 확인 (없으면 분석 단계 스킵)
    const analysisProps = await this.getDatabaseProperties(databaseId);

    // 5. 모든 콘텐츠 아이템을 DB에 추가 (매체 순서 유지), 분석중 상태로 표시
    const allItems: FlatResult[] = results.flatMap(r =>
      r.items.map(item => ({ ...item, platform: r.platform }))
    );
    const rows = await this.addItemsToDatabase(databaseId, allItems, onProgress, analysisProps);

    logger.info('Notion page updated with child database', { pageId, totalCount, databaseId, rows: rows.length });
    return { rows, analysisProps };
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
    if (last?.type === 'callout' && last.callout?.rich_text?.[0]?.text?.content?.startsWith('⏬')) {
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
    try {
      const dataSourceId = await this.getDataSourceId(databaseId);
      const templatePageId = await this.findSearchEntryTemplatePage(databaseId);

      if (templatePageId) {
        return await this.createSearchEntryWithTemplate(databaseId, dataSourceId, templatePageId, params);
      }

      logger.warn('Search entry template page not found; trying Notion default template', {
        databaseId,
        templateTitle: SEARCH_TEMPLATE_PAGE_TITLE,
      });
      return await this.createSearchEntryWithDefaultTemplate(databaseId, dataSourceId, params);
    } catch (error) {
      logger.warn('Notion template was not applied; falling back to direct page creation', {
        databaseId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const res = await this.fetchApiWithStatusFallback('pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { database_id: toUuid(databaseId) },
        icon: { type: 'emoji', emoji: '🔍' },
        properties: searchEntryProperties(params),
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

  private async getDataSourceId(databaseId: string): Promise<string> {
    const db = await this.fetchApi(`databases/${toUuid(databaseId)}`, {
      method: 'GET',
      headers: { 'Notion-Version': NOTION_TEMPLATE_API_VERSION },
    });
    const dataSourceId = db.data_sources?.[0]?.id;
    if (!dataSourceId) {
      throw new NotionApiError('data source not found for database');
    }
    return dataSourceId as string;
  }

  private async findSearchEntryTemplatePage(databaseId: string): Promise<string | null> {
    const settingsTemplatePageId = await this.findSettingsTemplatePage(databaseId);
    if (settingsTemplatePageId) return settingsTemplatePageId;

    // 이전 템플릿 구조 호환: 검색 DB 안에 템플릿용 행이 있으면 계속 사용한다.
    const data = await this.fetchApi(`databases/${toUuid(databaseId)}/query`, {
      method: 'POST',
      body: JSON.stringify({
        page_size: 1,
        filter: {
          property: '키워드',
          title: { equals: SEARCH_TEMPLATE_PAGE_TITLE },
        },
      }),
    });

    const templatePage = ((data.results as any[]) || [])[0];
    return typeof templatePage?.id === 'string' ? templatePage.id : null;
  }

  private async findSettingsTemplatePage(databaseId: string): Promise<string | null> {
    const parentPageId = await this.getDatabaseParentPageId(databaseId);
    const settingsPageId = await this.findChildPageIdByTitle(parentPageId, '설정');
    if (!settingsPageId) return null;

    return await this.findChildPageIdByTitle(settingsPageId, SEARCH_TEMPLATE_PAGE_TITLE);
  }

  private async findChildPageIdByTitle(pageId: string, title: string): Promise<string | null> {
    let cursor: string | undefined;
    do {
      const qs = new URLSearchParams({ page_size: '100' });
      if (cursor) qs.set('start_cursor', cursor);

      const data = await this.fetchApi(`blocks/${toUuid(pageId)}/children?${qs.toString()}`, { method: 'GET' });
      const block = ((data.results as any[]) || []).find(
        (b) => b.type === 'child_page' && b.child_page?.title === title,
      );
      if (block?.id) return block.id as string;

      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    return null;
  }

  private async createSearchEntryWithTemplate(
    databaseId: string,
    dataSourceId: string,
    templatePageId: string,
    params: { keyword: string; platforms: Platform[]; period: Period },
  ): Promise<string> {
    const res = await this.createSearchEntryWithNotionTemplate(
      dataSourceId,
      params,
      { type: 'template_id', template_id: toUuid(templatePageId) },
    );

    this.pagesCreatedWithTemplate.add(toUuid(res.id as string));
    logger.info('Notion search entry created with template page', {
      pageId: res.id,
      databaseId,
      dataSourceId,
      templatePageId,
    });
    return res.id as string;
  }

  private async createSearchEntryWithDefaultTemplate(
    databaseId: string,
    dataSourceId: string,
    params: { keyword: string; platforms: Platform[]; period: Period },
  ): Promise<string> {
    const res = await this.createSearchEntryWithNotionTemplate(
      dataSourceId,
      params,
      { type: 'default' },
    );

    this.pagesCreatedWithTemplate.add(toUuid(res.id as string));
    logger.info('Notion search entry created with default template', { pageId: res.id, databaseId, dataSourceId });
    return res.id as string;
  }

  private async createSearchEntryWithNotionTemplate(
    dataSourceId: string,
    params: { keyword: string; platforms: Platform[]; period: Period },
    template: Record<string, unknown>,
  ): Promise<any> {
    return await this.fetchApiWithStatusFallback('pages', {
      method: 'POST',
      headers: { 'Notion-Version': NOTION_TEMPLATE_API_VERSION },
      body: JSON.stringify({
        parent: {
          type: 'data_source_id',
          data_source_id: toUuid(dataSourceId),
        },
        icon: { type: 'emoji', emoji: '🔍' },
        properties: searchEntryProperties(params),
        template,
      }),
    }, '검색중');
  }

  private async findOrCreateContentDatabase(pageId: string, keyword: string): Promise<string> {
    const normalizedPageId = toUuid(pageId);
    const shouldWaitForTemplate = this.pagesCreatedWithTemplate.has(normalizedPageId);

    const existing = shouldWaitForTemplate
      ? await this.waitForTemplateContentDatabase(normalizedPageId)
      : await this.findContentDatabase(normalizedPageId);

    if (existing) {
      this.pagesCreatedWithTemplate.delete(normalizedPageId);
      await this.renameContentDatabase(existing, keyword);
      await this.removeDeprecatedContentDatabaseProperties(existing);
      logger.info('Using content database from template', { pageId, databaseId: existing });
      return existing.replace(/-/g, '');
    }

    this.pagesCreatedWithTemplate.delete(normalizedPageId);
    return await this.createContentDatabase(pageId, keyword);
  }

  private async waitForTemplateContentDatabase(pageId: string): Promise<string | null> {
    const attempts = 30;
    const delayMs = 1000;

    for (let i = 0; i < attempts; i++) {
      const databaseId = await this.findContentDatabase(pageId);
      if (databaseId) return databaseId;
      await sleep(delayMs);
    }

    logger.warn('Timed out waiting for template content database', {
      pageId,
      attempts,
      delayMs,
    });
    return null;
  }

  private async findContentDatabase(pageId: string): Promise<string | null> {
    const databases: Array<{ id: string; title: string }> = [];
    let cursor: string | undefined;

    do {
      const qs = new URLSearchParams({ page_size: '100' });
      if (cursor) qs.set('start_cursor', cursor);

      const data = await this.fetchApi(`blocks/${toUuid(pageId)}/children?${qs.toString()}`, { method: 'GET' });
      for (const block of (data.results as any[]) || []) {
        if (block.type === 'child_database') {
          databases.push({
            id: block.id as string,
            title: block.child_database?.title || '',
          });
        }
      }
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    const contentDb = databases.find(db => isContentDatabaseTitle(db.title));
    if (contentDb) return contentDb.id;

    return databases.length === 1 ? databases[0].id : null;
  }

  private async renameContentDatabase(databaseId: string, keyword: string): Promise<void> {
    try {
      await this.fetchApi(`databases/${toUuid(databaseId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: [{ type: 'text', text: { content: `콘텐츠 — ${keyword}` } }],
        }),
      });
    } catch (error) {
      logger.warn('Failed to rename template content database', {
        databaseId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async removeDeprecatedContentDatabaseProperties(databaseId: string): Promise<void> {
    try {
      const props = await this.getDatabaseProperties(databaseId);
      if (!props.has('SEO 적합도')) return;

      await this.fetchApi(`databases/${toUuid(databaseId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          properties: {
            'SEO 적합도': null,
          },
        }),
      });
    } catch (error) {
      logger.warn('Failed to remove deprecated content database properties', {
        databaseId,
        error: error instanceof Error ? error.message : String(error),
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

  // 노션 DB 부모 페이지의 trends.html 임베드 블록 제거
  async removeTrendsEmbed(databaseId: string): Promise<void> {
    try {
      const parentPageId = await this.getDatabaseParentPageId(databaseId);
      const embeds = await this.findEmbedsInPage(parentPageId, 'trends.html');

      for (const embed of embeds) {
        await this.fetchApi(`blocks/${embed.blockId}`, { method: 'DELETE' });
        await sleep(250);
      }

      if (embeds.length) {
        logger.info('Trends embeds removed', { parentPageId, count: embeds.length });
      }
    } catch (error) {
      logger.warn('Failed to remove trends embed (non-fatal)', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
        const title = getObjectTitle(obj);
        return { id: (obj.id as string).replace(/-/g, ''), title };
      })
      .filter((p) => p.title);
  }

  // 제목으로 접근 가능한 페이지를 찾는다. 셋업 중 사용자가 선택한 Snappy 페이지 식별용.
  async findAccessiblePageByTitle(title: string): Promise<{ id: string; title: string } | null> {
    const results = await this.searchByTitle(title);
    if (!results) return null;

    const expected = normalizeTitle(title);
    const page = results.find((obj: any) =>
      obj.object === 'page' && normalizeTitle(getObjectTitle(obj)).startsWith(expected)
    );
    if (!page?.id) return null;

    return {
      id: (page.id as string).replace(/-/g, ''),
      title: getObjectTitle(page),
    };
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

  private async findSearchDatabaseOnPage(pageId: string): Promise<{ id: string; title: string } | null> {
    const databases: Array<{ id: string; title: string }> = [];
    let cursor: string | undefined;

    do {
      const qs = new URLSearchParams({ page_size: '100' });
      if (cursor) qs.set('start_cursor', cursor);

      const data = await this.fetchApi(`blocks/${toUuid(pageId)}/children?${qs.toString()}`, { method: 'GET' });
      for (const block of (data.results as any[]) || []) {
        if (block.type === 'child_database') {
          databases.push({
            id: (block.id as string).replace(/-/g, ''),
            title: block.child_database?.title || '',
          });
        }
      }

      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    const exact = databases.find((db) => db.title.trim() === SEARCH_DATABASE_TITLE);
    if (exact) return exact;

    for (const db of databases) {
      try {
        const info = await this.fetchApi(`databases/${toUuid(db.id)}`, { method: 'GET' });
        if (isSnappySearchDatabase(info)) {
          return { id: db.id, title: getObjectTitle(info) || db.title || SEARCH_DATABASE_TITLE };
        }
      } catch (error) {
        logger.warn('Failed to inspect child database while finding search DB', {
          databaseId: db.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

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

  // DB 부모 페이지에서 URL fragment가 포함된 임베드 블록 탐색
  private async findEmbedInPage(
    parentPageId: string,
    urlFragment: string,
  ): Promise<{ blockId: string; currentUrl: string } | null> {
    return (await this.findEmbedsInPage(parentPageId, urlFragment))[0] ?? null;
  }

  private async findEmbedsInPage(
    parentPageId: string,
    urlFragment: string,
  ): Promise<Array<{ blockId: string; currentUrl: string }>> {
    const embeds: Array<{ blockId: string; currentUrl: string }> = [];
    let cursor: string | undefined;
    do {
      const qs = new URLSearchParams({ page_size: '100' });
      if (cursor) qs.set('start_cursor', cursor);

      const data = await this.fetchApi(`blocks/${parentPageId}/children?${qs.toString()}`, { method: 'GET' });
      const blocks = ((data.results as any[]) || []).filter(
        (b) => b.type === 'embed' && typeof b.embed?.url === 'string' && b.embed.url.includes(urlFragment),
      );
      for (const block of blocks) {
        embeds.push({ blockId: block.id, currentUrl: block.embed.url as string });
      }

      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    return embeds;
  }

  private async findSearchEmbedInPage(
    parentPageId: string,
  ): Promise<{ blockId: string; currentUrl: string } | null> {
    return this.findEmbedInPage(parentPageId, 'search.html');
  }
}

function toUuid(id: string): string {
  const s = id.replace(/-/g, '');
  return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
}

function getObjectTitle(obj: any): string {
  if (obj.object === 'database') {
    return ((obj.title || []) as any[]).map((t: any) => t.plain_text).join('').trim();
  }

  const titleProp = Object.values(obj.properties || {})
    .find((p: any) => (p as any)?.type === 'title') as { title?: any[] } | undefined;
  return (titleProp?.title || []).map((t: any) => t.plain_text).join('').trim();
}

function normalizeTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim();
}

function statusValue(status: string): { status: { name: string } } {
  return { status: { name: status } };
}

function searchEntryProperties(params: { keyword: string; platforms: Platform[]; period: Period }): Record<string, any> {
  return {
    '키워드': { title: [{ type: 'text', text: { content: params.keyword } }] },
    '상태': statusValue('검색중'),
    '매체': { multi_select: params.platforms.map((p) => ({ name: PLATFORM_TO_NOTION[p] })) },
    '기간': { select: { name: PERIOD_TO_NOTION[params.period] } },
  };
}

function searchDatabaseBody(parentPageId: string, includeLoadMoreButton: boolean): Record<string, any> {
  const properties: Record<string, any> = {
    '키워드': { title: {} },
    '상태': { status: {} },
    '매체': {
      multi_select: {
        options: [
          { name: '네이버블로그', color: 'green' },
          { name: '유튜브', color: 'red' },
          { name: '티스토리', color: 'orange' },
          { name: '브런치', color: 'brown' },
        ],
      },
    },
    '기간': {
      select: {
        options: [
          { name: '1일', color: 'gray' },
          { name: '1주', color: 'blue' },
          { name: '1개월', color: 'purple' },
          { name: '1년', color: 'pink' },
        ],
      },
    },
    '발견 콘텐츠 수': { number: { format: 'number' } },
    '검색일시': { created_time: {} },
  };

  if (includeLoadMoreButton) {
    properties['📄 더보기'] = { button: {} };
  }

  return {
    parent: { page_id: toUuid(parentPageId) },
    is_inline: true,
    icon: { type: 'emoji', emoji: '🔍' },
    title: [{ type: 'text', text: { content: SEARCH_DATABASE_TITLE } }],
    properties,
  };
}

function isContentDatabaseTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  return normalized.startsWith('콘텐츠') || normalized.startsWith('content');
}

function isSnappySearchDatabase(db: any): boolean {
  const props = db.properties || {};
  return (
    props['키워드']?.type === 'title' &&
    props['상태']?.type === 'status' &&
    props['매체']?.type === 'multi_select' &&
    props['기간']?.type === 'select'
  );
}

function isInvalidStatusOption(error: unknown): boolean {
  return error instanceof NotionApiError && error.message.includes('Invalid status option');
}

function isUnsupportedButtonProperty(error: unknown): boolean {
  return error instanceof NotionApiError &&
    (error.message.includes('button') || error.message.includes('📄 더보기'));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

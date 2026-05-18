# 트렌드 콘텐츠 발견기 — Phase별 구현 계획 v4

> 단순 MVP (AI 분석 제거) 기반 단계별 개발 가이드
> 작성일: 2026년 5월
> 기반 기획서: trend-content-finder-spec-v4.md

---

## 전체 개요

### 변경사항 (v3 대비)

| Phase | v3 | v4 |
|---|---|---|
| Phase 3 (AI 분석) | 필수 | **제거 (스탠다드 출시 시 추가)** |
| Phase 5 (통합) | AI 단계 포함 | 검색→노션 단순 흐름 |
| 전체 소요 | 12일 | **8~9일** |

### Phase 구성 (MVP)

| Phase | 영역 | 의존성 | 예상 소요 |
|---|---|---|---|
| Phase 0 | 사전 검증 | 없음 | 1일 |
| Phase 1 | 인프라 셋업 | Phase 0 | 1일 |
| Phase 2 | 검색 모듈 | Phase 1 | 2일 |
| Phase 3 | 노션 연동 | Phase 1 | 1일 |
| Phase 4 | 통합 Edge Function | Phase 2, 3 | 1.5일 |
| Phase 5 | 사용자 관리 + 사용량 | Phase 1 | 1.5일 |
| Phase 6 | 노션 템플릿 제작 | 없음 (병렬) | 1.5일 |
| Phase 7 | 통합 테스트 | Phase 1~6 | 1일 |
| Phase 8 | 베타 출시 | Phase 7 | 0.5일 |

**MVP까지: Phase 0~8 (약 8~9일)**

### 향후 확장 Phase (스탠다드 출시 시)

| Phase | 영역 | 예상 소요 |
|---|---|---|
| Phase 9 | AI 분석 모듈 추가 | 1.5일 |
| Phase 10 | 결제 시스템 | 2일 |
| Phase 11 | 정식 출시 | 0.5일 |

---

## Phase 간 공통 계약

### 공통 타입 정의 (단순화)

```typescript
// types/shared.ts

export interface SearchRequest {
  user_id: string;
  notion_page_id: string;
  keyword: string;
  platforms: Platform[];
  period: Period;
  result_count: number;
}

export type Platform = 'naver_blog' | 'youtube' | 'tistory' | 'brunch';
export type Period = 'day' | 'week' | 'month' | 'year';

export interface ContentItem {
  platform: Platform;
  title: string;
  url: string;
  description: string;
  snippet?: string;
  author?: string;
  thumbnail?: string;
  published_at?: string;
}

export interface SearchResult {
  platform: Platform;
  items: ContentItem[];
  count: number;
  error?: string;
}

// Insights 타입은 v4에서 제거 (스탠다드 출시 시 추가)
```

### 공통 환경 변수 (단순화)

```env
# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# 검색 API
NAVER_CLIENT_ID=
NAVER_CLIENT_SECRET=
YOUTUBE_API_KEY=
YOUCOM_API_KEY=

# OpenAI는 MVP에서 제외 (스탠다드 출시 시 추가)

# 운영
LOG_LEVEL=info
ENVIRONMENT=production
```

---

# Phase 0: 사전 검증

**담당**: 시장/기술 검증
**소요**: 1일
**선행**: 없음

## 0.1. 시장 검증 (반나절)

### 작업 내용

1. **유사 상품 조사**
   - 크몽/탈잉에서 "트렌드 분석", "콘텐츠 리서치" 검색
   - 상위 10개 가격, 판매량, 리뷰 분석

2. **잠재 고객 인터뷰 (5명)**
   - 30분 인터뷰
   - 핵심 질문:
     - 현재 트렌드 리서치 방법?
     - 주당 소요 시간?
     - **단순 검색 결과 정리 도구에 월 1만원 지불 가능한가?**
     - 가장 중요한 매체는?

### GO 기준

- 5명 중 3명 이상 "월 9,900원에 쓰겠다" 답변
- 한국 마케터 노션 사용률 확인

## 0.2. 기술 검증 (반나절)

### 작업 내용

각 API 무료 크레딧으로 테스트:

1. **네이버 검색 API**
   - 10개 키워드 테스트
   - HTML 정리 검증

2. **YouTube Data API**
   - 10개 키워드 테스트
   - regionCode=KR 검증

3. **You.com API**
   - 티스토리 결과 품질 확인
   - 브런치 결과 확인

### 산출물

- 각 API 응답 샘플
- 응답 시간 측정값
- GO/NO-GO 판단

---

# Phase 1: 인프라 셋업

**담당**: 인프라
**소요**: 1일
**선행**: Phase 0 GO

## 1.1. Supabase 프로젝트

```bash
# 프로젝트 생성 (Region: ap-northeast-2)
supabase init
supabase link --project-ref [REF]
```

## 1.2. 디렉토리 구조 (단순화)

```
project-root/
├── supabase/
│   ├── functions/
│   │   ├── _shared/
│   │   │   ├── types.ts
│   │   │   ├── env.ts
│   │   │   ├── logger.ts
│   │   │   └── errors.ts
│   │   ├── search/                # 검색 모듈
│   │   │   ├── naver.ts
│   │   │   ├── youtube.ts
│   │   │   ├── youcom.ts
│   │   │   └── orchestrator.ts
│   │   ├── notion/                # 노션 연동
│   │   │   ├── client.ts
│   │   │   └── blocks.ts
│   │   ├── trigger-search/        # 메인 함수
│   │   │   └── index.ts
│   │   └── manage-user/           # 사용자 관리
│   │       └── index.ts
│   ├── migrations/
│   └── config.toml
└── ...
```

**AI 관련 디렉토리 제거**

## 1.3. DB 스키마

```sql
-- users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  subscription_tier TEXT DEFAULT 'free',
  subscription_expires_at TIMESTAMPTZ,
  notion_api_key_encrypted TEXT,
  notion_database_id TEXT
);

-- search_logs
CREATE TABLE search_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  keyword TEXT NOT NULL,
  platforms TEXT[] NOT NULL,
  period TEXT NOT NULL,
  result_count INT,
  duration_ms INT,
  cost_usd DECIMAL(10, 4),
  status TEXT NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- usage_quotas
CREATE TABLE usage_quotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  date DATE NOT NULL,
  search_count INT DEFAULT 0,
  UNIQUE(user_id, date)
);
```

## 1.4. 시크릿 등록

```bash
supabase secrets set NAVER_CLIENT_ID=...
supabase secrets set NAVER_CLIENT_SECRET=...
supabase secrets set YOUTUBE_API_KEY=...
supabase secrets set YOUCOM_API_KEY=...
```

## 1.5. 산출물 체크리스트

- [ ] Supabase 프로젝트 생성
- [ ] 디렉토리 구조 생성
- [ ] DB 테이블 3개 (users, search_logs, usage_quotas)
- [ ] 시크릿 4개 등록 (네이버 2개, YouTube, You.com)
- [ ] 공통 모듈 작성
- [ ] 로컬 동작 확인

---

# Phase 2: 검색 모듈

**담당**: 검색 통합
**소요**: 2일
**선행**: Phase 1

## 2.1. 네이버 검색 모듈

**search/naver.ts**
```typescript
import { env } from '../_shared/env.ts';
import type { ContentItem, Period } from '../_shared/types.ts';

export async function searchNaverBlog(
  keyword: string,
  count: number = 10,
  period?: Period
): Promise<ContentItem[]> {
  const response = await fetch(
    `https://openapi.naver.com/v1/search/blog.json?` +
    `query=${encodeURIComponent(keyword)}` +
    `&display=${count}&sort=sim`,
    {
      headers: {
        'X-Naver-Client-Id': env.naver.clientId,
        'X-Naver-Client-Secret': env.naver.clientSecret,
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Naver API error: ${response.status}`);
  }

  const data = await response.json();

  return data.items
    .map(normalizeNaverItem)
    .filter(item => filterByPeriod(item, period));
}

function normalizeNaverItem(item: any): ContentItem {
  return {
    platform: 'naver_blog',
    title: stripHtml(item.title),
    url: item.link,
    description: stripHtml(item.description),
    author: item.bloggername,
    published_at: parseNaverDate(item.postdate),
  };
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ').trim();
}

function parseNaverDate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0,4)}-${yyyymmdd.slice(4,6)}-${yyyymmdd.slice(6,8)}`;
}

function filterByPeriod(item: ContentItem, period?: Period): boolean {
  if (!period || !item.published_at) return true;
  const itemDate = new Date(item.published_at);
  const now = new Date();
  const diffDays = (now.getTime() - itemDate.getTime()) / (1000 * 60 * 60 * 24);

  const limits: Record<Period, number> = {
    day: 1, week: 7, month: 30, year: 365
  };

  return diffDays <= limits[period];
}
```

## 2.2. YouTube 검색 모듈

**search/youtube.ts**
```typescript
import { env } from '../_shared/env.ts';
import type { ContentItem, Period } from '../_shared/types.ts';

export async function searchYouTube(
  keyword: string,
  count: number = 10,
  period: Period = 'month'
): Promise<ContentItem[]> {
  const publishedAfter = getPublishedAfter(period);

  const response = await fetch(
    `https://www.googleapis.com/youtube/v3/search?` +
    `part=snippet&q=${encodeURIComponent(keyword)}` +
    `&type=video&maxResults=${count}` +
    `&regionCode=KR&relevanceLanguage=ko` +
    `&publishedAfter=${publishedAfter}` +
    `&order=relevance&key=${env.youtube.apiKey}`
  );

  if (!response.ok) {
    throw new Error(`YouTube API error: ${response.status}`);
  }

  const data = await response.json();
  return data.items.map(normalizeYouTubeItem);
}

function normalizeYouTubeItem(item: any): ContentItem {
  return {
    platform: 'youtube',
    title: item.snippet.title,
    url: `https://youtube.com/watch?v=${item.id.videoId}`,
    description: item.snippet.description,
    author: item.snippet.channelTitle,
    thumbnail: item.snippet.thumbnails.high?.url,
    published_at: item.snippet.publishedAt,
  };
}

function getPublishedAfter(period: Period): string {
  const offsets: Record<Period, number> = {
    day: 1, week: 7, month: 30, year: 365
  };
  const now = new Date();
  now.setDate(now.getDate() - offsets[period]);
  return now.toISOString();
}
```

## 2.3. You.com 검색 모듈

**search/youcom.ts**
```typescript
import { env } from '../_shared/env.ts';
import type { ContentItem, Period, Platform } from '../_shared/types.ts';

async function searchYouCom(
  keyword: string,
  domains: string[],
  platform: Platform,
  count: number = 10,
  period: Period = 'month'
): Promise<ContentItem[]> {
  const response = await fetch(
    `https://ydc-index.io/v1/search?` +
    `query=${encodeURIComponent(keyword)}` +
    `&count=${count}&freshness=${period}` +
    `&country=KR&language=KO` +
    `&include_domains=${domains.join(',')}`,
    {
      headers: {
        'X-API-KEY': env.youcom.apiKey,
        'Accept': 'application/json',
      }
    }
  );

  if (!response.ok) {
    throw new Error(`You.com API error: ${response.status}`);
  }

  const data = await response.json();
  const webResults = data.results?.web || [];

  return webResults.map(item => ({
    platform,
    title: item.title,
    url: item.url,
    description: item.description,
    snippet: item.snippets?.[0],
    thumbnail: item.thumbnail_url,
  }));
}

export const searchTistory = (keyword: string, count: number, period: Period) =>
  searchYouCom(keyword, ['tistory.com'], 'tistory', count, period);

export const searchBrunch = (keyword: string, count: number, period: Period) =>
  searchYouCom(keyword, ['brunch.co.kr'], 'brunch', count, period);
```

## 2.4. 통합 오케스트레이터

**search/orchestrator.ts**
```typescript
import { searchNaverBlog } from './naver.ts';
import { searchYouTube } from './youtube.ts';
import { searchTistory, searchBrunch } from './youcom.ts';
import type { Platform, Period, SearchResult } from '../_shared/types.ts';

const searchers = {
  naver_blog: searchNaverBlog,
  youtube: searchYouTube,
  tistory: searchTistory,
  brunch: searchBrunch,
};

export async function searchAllPlatforms(
  keyword: string,
  platforms: Platform[],
  count: number,
  period: Period
): Promise<SearchResult[]> {
  const tasks = platforms.map(async (platform) => {
    try {
      const items = await searchers[platform](keyword, count, period);
      return { platform, items, count: items.length };
    } catch (error) {
      return { platform, items: [], count: 0, error: error.message };
    }
  });

  return await Promise.all(tasks);
}
```

## 2.5. 산출물 체크리스트

- [ ] 4개 매체 검색 모듈 작성 + 테스트
- [ ] 오케스트레이터 작성
- [ ] 동시 호출 응답 시간 측정 (목표: 3초 이내)
- [ ] 한 매체 실패 시 나머지 정상 반환 검증
- [ ] 단위 테스트

---

# Phase 3: 노션 연동

**담당**: 노션 연동
**소요**: 1일
**선행**: Phase 1

## 3.1. 노션 클라이언트

**notion/client.ts**
```typescript
import { buildResultBlocks } from './blocks.ts';
import type { SearchResult } from '../_shared/types.ts';

export class NotionClient {
  constructor(private apiKey: string) {}

  async updatePageStatus(
    pageId: string,
    status: '대기' | '검색중' | '완료' | '실패',
    errorMessage?: string
  ): Promise<void> {
    const properties: any = {
      상태: { status: { name: status } },
    };

    if (errorMessage) {
      properties['에러메시지'] = {
        rich_text: [{ text: { content: errorMessage } }],
      };
    }

    await this.fetch(`pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties }),
    });
  }

  async updatePageWithResults(
    pageId: string,
    keyword: string,
    results: SearchResult[],
    metadata: { duration_ms: number; cost_usd: number }
  ): Promise<void> {
    const totalCount = results.reduce((sum, r) => sum + r.count, 0);

    // 1. 속성 업데이트
    await this.fetch(`pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        properties: {
          상태: { status: { name: '완료' } },
          '발견 콘텐츠 수': { number: totalCount },
        }
      }),
    });

    // 2. 페이지 본문에 블록 추가
    const blocks = buildResultBlocks(keyword, results, metadata);
    await this.appendBlocks(pageId, blocks);
  }

  private async appendBlocks(pageId: string, blocks: any[]): Promise<void> {
    for (let i = 0; i < blocks.length; i += 100) {
      const chunk = blocks.slice(i, i + 100);
      await this.fetch(`blocks/${pageId}/children`, {
        method: 'PATCH',
        body: JSON.stringify({ children: chunk }),
      });
    }
  }

  private async fetch(path: string, init: RequestInit): Promise<any> {
    const response = await fetch(`https://api.notion.com/v1/${path}`, {
      ...init,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
        ...init.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Notion API error: ${response.status}`);
    }

    return await response.json();
  }
}
```

## 3.2. 블록 빌더 (단순화)

**notion/blocks.ts**
```typescript
import type { SearchResult, ContentItem } from '../_shared/types.ts';

export function buildResultBlocks(
  keyword: string,
  results: SearchResult[],
  metadata: { duration_ms: number; cost_usd: number }
): any[] {
  const blocks: any[] = [];

  // 매체별 결과
  for (const result of results) {
    if (result.items.length === 0) continue;

    blocks.push(heading2(
      `${getPlatformEmoji(result.platform)} ${getPlatformName(result.platform)} (${result.count}개)`
    ));

    for (const [idx, item] of result.items.entries()) {
      blocks.push(...buildContentItemBlocks(idx + 1, item));
    }

    blocks.push(divider());
  }

  // 메타데이터
  blocks.push(callout(
    `검색 소요: ${(metadata.duration_ms / 1000).toFixed(1)}초`,
    '⏱️'
  ));

  return blocks;
}

function buildContentItemBlocks(idx: number, item: ContentItem): any[] {
  const blocks: any[] = [];

  // 제목
  blocks.push(paragraph(`${idx}. ${item.title}`, { bold: true }));

  // 작성자/채널
  if (item.author) {
    blocks.push(paragraph(`   👤 ${item.author}`));
  }

  // 발행일
  if (item.published_at) {
    const date = new Date(item.published_at).toISOString().slice(0, 10);
    blocks.push(paragraph(`   📅 ${date}`));
  }

  // 링크
  blocks.push(paragraph(`   🔗 ${item.url}`));

  // 설명
  if (item.description) {
    blocks.push(paragraph(`   💬 ${item.description.slice(0, 200)}`));
  }

  return blocks;
}

function heading2(text: string): any {
  return {
    object: 'block',
    type: 'heading_2',
    heading_2: { rich_text: [{ text: { content: text } }] }
  };
}

function paragraph(text: string, annotations?: any): any {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{
        text: { content: text },
        annotations
      }]
    }
  };
}

function callout(text: string, emoji: string): any {
  return {
    object: 'block',
    type: 'callout',
    callout: {
      rich_text: [{ text: { content: text } }],
      icon: { emoji }
    }
  };
}

function divider(): any {
  return { object: 'block', type: 'divider', divider: {} };
}

function getPlatformEmoji(platform: string): string {
  return {
    naver_blog: '📝',
    youtube: '🎥',
    tistory: '📚',
    brunch: '✍️'
  }[platform] || '📄';
}

function getPlatformName(platform: string): string {
  return {
    naver_blog: '네이버 블로그',
    youtube: '유튜브',
    tistory: '티스토리',
    brunch: '브런치'
  }[platform] || platform;
}
```

## 3.3. 산출물 체크리스트

- [ ] 노션 클라이언트 모듈
- [ ] 블록 빌더 (인사이트 섹션 없는 단순 버전)
- [ ] 페이지 업데이트 동작 확인
- [ ] 블록 추가 동작 확인 (100개 초과 시 분할)
- [ ] 상태 관리 (대기→검색중→완료/실패)
- [ ] 에러 처리

---

# Phase 4: 통합 Edge Function

**담당**: 메인 엔드포인트
**소요**: 1.5일
**선행**: Phase 2, 3

## 4.1. 메인 함수 (단순화)

**trigger-search/index.ts**
```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { searchAllPlatforms } from '../search/orchestrator.ts';
import { NotionClient } from '../notion/client.ts';
import { logger } from '../_shared/logger.ts';
import type { SearchRequest } from '../_shared/types.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const request = validateRequest(body);

    const user = await getUser(request.user_id);
    await checkQuota(user);

    // 즉시 응답
    EdgeRuntime.waitUntil(processSearch(request, user));

    return new Response(
      JSON.stringify({ status: 'accepted', page_id: request.notion_page_id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    logger.error('Request failed', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: corsHeaders }
    );
  }
});

async function processSearch(request: SearchRequest, user: any) {
  const notion = new NotionClient(user.notion_api_key);
  const startTime = Date.now();
  let totalCost = 0;

  try {
    await notion.updatePageStatus(request.notion_page_id, '검색중');

    // 매체별 검색 (병렬)
    logger.info('Starting search', { keyword: request.keyword });
    const results = await searchAllPlatforms(
      request.keyword,
      request.platforms,
      request.result_count,
      request.period
    );

    // You.com 비용 계산
    const youComCalls = results.filter(r =>
      ['tistory', 'brunch'].includes(r.platform)
    ).length;
    totalCost += youComCalls * 0.005;

    // 노션 업데이트 (AI 분석 없이 바로 저장)
    logger.info('Updating Notion');
    await notion.updatePageWithResults(
      request.notion_page_id,
      request.keyword,
      results,
      {
        duration_ms: Date.now() - startTime,
        cost_usd: totalCost,
      }
    );

    // 사용량 증가
    await incrementUsage(request.user_id);

    // 로그 저장
    await logSearch(request, results, totalCost, Date.now() - startTime, 'success');

  } catch (error) {
    logger.error('Search failed', error);
    await notion.updatePageStatus(
      request.notion_page_id,
      '실패',
      error.message
    );
    await logSearch(request, [], 0, Date.now() - startTime, 'failed', error.message);
  }
}

function validateRequest(body: any): SearchRequest {
  if (!body.user_id) throw new Error('user_id is required');
  if (!body.notion_page_id) throw new Error('notion_page_id is required');
  if (!body.keyword) throw new Error('keyword is required');
  if (!body.platforms || !Array.isArray(body.platforms)) {
    throw new Error('platforms must be an array');
  }

  return {
    user_id: body.user_id,
    notion_page_id: body.notion_page_id,
    keyword: body.keyword,
    platforms: body.platforms,
    period: body.period || 'month',
    result_count: body.result_count || 10,
  };
}

async function getUser(userId: string) {
  const { data, error } = await supabase
    .from('users').select('*').eq('id', userId).single();
  if (error || !data) throw new Error('User not found');
  return data;
}

async function checkQuota(user: any) {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from('usage_quotas')
    .select('search_count')
    .eq('user_id', user.id).eq('date', today).single();

  const limits = { free: 3, light: 5, standard: 10, premium: 30 };
  const limit = limits[user.subscription_tier] || 3;

  if (data && data.search_count >= limit) {
    throw new Error(`Daily quota exceeded (${limit} searches)`);
  }
}

async function incrementUsage(userId: string) {
  const today = new Date().toISOString().slice(0, 10);
  await supabase.rpc('increment_search_count', {
    p_user_id: userId,
    p_date: today,
  });
}

async function logSearch(
  request: SearchRequest,
  results: any[],
  cost: number,
  duration: number,
  status: string,
  errorMessage?: string
) {
  await supabase.from('search_logs').insert({
    user_id: request.user_id,
    keyword: request.keyword,
    platforms: request.platforms,
    period: request.period,
    result_count: results.reduce((sum, r) => sum + r.count, 0),
    duration_ms: duration,
    cost_usd: cost,
    status,
    error_message: errorMessage,
  });
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};
```

**중요**: AI 분석 단계가 빠지면서 코드가 50줄 가량 줄었고, 응답 시간도 절반으로 단축돼요.

## 4.2. 산출물 체크리스트

- [ ] 메인 Edge Function 작성
- [ ] 요청 검증
- [ ] 사용자 인증 + 사용량 체크
- [ ] 백그라운드 처리
- [ ] 검색 → 노션 저장 흐름
- [ ] 에러 처리
- [ ] 로그 저장

---

# Phase 5: 사용자 관리 + 사용량

**담당**: 사용자 시스템
**소요**: 1.5일
**선행**: Phase 1

## 5.1. 사용자 가입 함수

**manage-user/index.ts**
- POST /signup: 가입
- POST /setup-notion: 노션 키 등록
- GET /usage: 사용량 조회

## 5.2. 노션 키 암호화

```typescript
async function encryptNotionKey(key: string): Promise<string> {
  // AES-256 암호화
}
```

## 5.3. 사용량 추적

PostgreSQL RPC 함수:
```sql
CREATE OR REPLACE FUNCTION increment_search_count(
  p_user_id UUID,
  p_date DATE
) RETURNS void AS $$
BEGIN
  INSERT INTO usage_quotas (user_id, date, search_count)
  VALUES (p_user_id, p_date, 1)
  ON CONFLICT (user_id, date)
  DO UPDATE SET search_count = usage_quotas.search_count + 1;
END;
$$ LANGUAGE plpgsql;
```

## 5.4. 산출물 체크리스트

- [ ] 가입 API
- [ ] 노션 키 등록 API
- [ ] 사용량 조회 API
- [ ] 사용량 증가 RPC 함수
- [ ] 사용량 한도 체크

---

# Phase 6: 노션 템플릿 제작

**담당**: 노션 디자인
**소요**: 1.5일
**선행**: 없음 (Phase 1~5와 병렬 가능)

## 6.1. 페이지 구조 (단순화)

```
📘 [메인] 트렌드 콘텐츠 발견기
├── 📖 시작하기 가이드
├── 🔍 검색 (메인 DB)
└── ⚙️ 설정
```

**인사이트 라이브러리 페이지 제거** (AI 분석 없으니까)

## 6.2. 검색 DB 속성

| 속성명 | 타입 |
|---|---|
| 키워드 | 제목 |
| 매체 | 다중 선택 |
| 기간 | 셀렉트 |
| 결과 개수 | 셀렉트 |
| 검색일시 | 생성일 |
| 상태 | 상태 |
| 발견 콘텐츠 수 | 숫자 |
| 🚀 검색 실행 | 버튼 |

## 6.3. 버튼 자동화

```
액션 1: 상태를 "검색중"으로 변경
액션 2: 웹훅 발송
  URL: https://[project].supabase.co/functions/v1/trigger-search
  페이로드:
    {
      "user_id": "{{user_id}}",
      "notion_page_id": "{{현재 페이지 ID}}",
      "keyword": "{{키워드}}",
      "platforms": [{{매체}}],
      "period": "{{기간}}",
      "result_count": {{결과 개수}}
    }
```

## 6.4. 산출물 체크리스트

- [ ] 메인 페이지 + 3개 하위 페이지
- [ ] 검색 DB 속성 설정
- [ ] 시작하기 가이드
- [ ] 버튼 자동화
- [ ] 샘플 검색 결과 3개
- [ ] 시각적 디자인
- [ ] 템플릿 복제 링크

---

# Phase 7: 통합 테스트

**담당**: QA
**소요**: 1일
**선행**: Phase 1~6

## 7.1. 시나리오 테스트

**시나리오 1: 정상 흐름**
1. 노션 버튼 클릭
2. 검색중 → 완료 상태 변화
3. 10초 내 4매체 결과 표시
4. 모든 링크 클릭 가능 확인

**시나리오 2: 부분 실패**
1. You.com API 의도적 차단
2. 네이버+유튜브 결과만 정상 표시
3. 티스토리/브런치는 0개로 표시

**시나리오 3: 사용량 초과**
1. 일 한도 도달
2. 에러 메시지 표시

**시나리오 4: 동시 요청**
3명 동시 클릭, 모두 정상 처리

## 7.2. 성능 목표

| 항목 | 목표 |
|---|---|
| 4매체 병렬 검색 | < 3초 |
| 노션 저장 | < 5초 |
| 전체 응답 | < 10초 |
| 동시 처리 | 10건 |

**v3 대비 응답 시간 1/3로 단축** (AI 분석 제거 효과)

## 7.3. 산출물 체크리스트

- [ ] 모든 시나리오 통과
- [ ] 성능 목표 달성
- [ ] 버그 수정
- [ ] 테스트 리포트

---

# Phase 8: 베타 출시

**담당**: 출시
**소요**: 0.5일
**선행**: Phase 7

## 8.1. 가이드 문서

- 셋업 가이드 PDF (5p, 단순화)
  - Supabase 계정 (찬울님이 운영, 사용자 발급 불필요)
  - 노션 통합 만들기
  - 템플릿 복제
  - 첫 검색
- 영상 가이드 (2분)

## 8.2. 베타 모집

- 모집 페이지
- 마케팅 커뮤니티 공유
- 첫 30명 무료

## 8.3. 산출물 체크리스트

- [ ] 셋업 가이드 PDF
- [ ] 영상 가이드
- [ ] 베타 모집 페이지
- [ ] 피드백 수집 폼

---

# 향후 확장 Phase (스탠다드 출시 시)

베타 1~2개월 후 검증되면 추가:

## Phase 9: AI 분석 모듈 추가 (1.5일)

- OpenAI 통합
- 프롬프트 설계
- 노션 인사이트 섹션 추가
- 스탠다드 플랜 가입자만 적용

## Phase 10: 결제 시스템 (2일)

- 토스페이먼츠 연동
- 구독 관리
- 환불 처리

## Phase 11: 정식 출시 (0.5일)

- 정식 가격 적용
- 마케팅 본격화

---

## 추천 진행 순서

### 압축 진행 (8일 만에 베타 출시)

```
Day 1: Phase 0 (검증)
Day 2: Phase 1 (인프라)
Day 3-4: Phase 2 (검색) + Phase 6 시작 (병렬)
Day 5: Phase 3 (노션 연동)
Day 6: Phase 4 (통합) + Phase 6 완료
Day 7: Phase 5 (사용자) + Phase 7 (테스트)
Day 8: Phase 8 (베타 출시)
```

### 안전한 진행 (10일)

각 Phase 끝나면 검증 후 진행. 발견된 이슈 충분히 수정.

---

## v3 대비 핵심 변경 요약

| 영역 | v3 | v4 |
|---|---|---|
| AI 분석 | 필수 | 제거 (스탠다드 출시 시 추가) |
| Edge Function 수 | 3개 | 2개 (trigger-search, manage-user) |
| 시스템 복잡도 | 중간 | 단순 |
| 응답 시간 | 30초 | 10초 |
| 회당 비용 | 70원 | 14원 |
| 개발 기간 | 12일 | 8~9일 |
| 라이트 마진 | 43% | 86% |

**진짜 MVP가 됐어요.**

---

## 핵심 원칙

### 1. 검색 + 정리만
- AI 분석 없음
- 사용자가 링크 클릭해서 직접 콘텐츠 확인

### 2. 매체별 분리
- 네이버 블로그
- 유튜브
- 티스토리
- 브런치

### 3. 노션 통합
- 별도 UI 없음
- 노션이 모든 인터페이스

### 4. 누적 가치
- 시간별 검색 기록 누적
- 트렌드 변화 추적 가능

이게 본질이에요.

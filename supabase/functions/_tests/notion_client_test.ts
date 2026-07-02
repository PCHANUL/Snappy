import "./setup.ts";
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { NotionClient } from "../_notion/client.ts";

Deno.test("updateRowAnalysis: 신뢰도 number 속성을 업데이트", async () => {
  const notion = new NotionClient("test-notion-key") as any;
  let capturedPath = "";
  let capturedBody: Record<string, any> = {};

  notion.fetchApi = async (path: string, init: RequestInit) => {
    capturedPath = path;
    capturedBody = JSON.parse(String(init.body ?? "{}"));
    return {};
  };

  await notion.updateRowAnalysis(
    "12345678123412341234123456789012",
    {
      summary: "분석 요약입니다.",
      summarySource: "본문 기반",
      keywords: ["생태계", "고양이"],
      confidence: 0.82,
      author: "새덕후",
      status: "done",
    },
    new Map([
      ["분석 상태", "select"],
      ["작성자", "rich_text"],
      ["요약", "rich_text"],
      ["키워드", "multi_select"],
      ["신뢰도", "number"],
    ]),
  );

  assertEquals(capturedPath, "pages/12345678-1234-1234-1234-123456789012");
  assertEquals(capturedBody.properties["신뢰도"], { number: 0.82 });
  assertEquals(
    capturedBody.properties["작성자"],
    { rich_text: [{ type: "text", text: { content: "새덕후" } }] },
  );
});

Deno.test("addItemsToDatabase: 콘텐츠 행을 최대 3개씩 병렬 생성", async () => {
  const notion = new NotionClient("test-notion-key") as any;
  let active = 0;
  let maxActive = 0;
  let created = 0;
  const progress: string[] = [];
  const createdBatches: Array<{ size: number; startPosition: number }> = [];

  notion.createContentItemPage = async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active--;
    created++;
    return { id: `row-${created}` };
  };

  const items = Array.from({ length: 7 }, (_, index) => ({
    platform: "tistory" as const,
    title: `${index + 1}번째 글`,
    url: `https://post.tistory.com/${index + 1}`,
    description: "desc",
  }));

  const rows = await notion.addItemsToDatabase(
    "12345678123412341234123456789012",
    items,
    (message: string) => {
      progress.push(message);
      return Promise.resolve();
    },
    new Map(),
    null,
    {},
    (rows: any[], startPosition: number) => {
      createdBatches.push({ size: rows.length, startPosition });
      return Promise.resolve();
    },
  );

  assertEquals(rows.length, 7);
  assertEquals(maxActive, 3);
  assert(progress[0].includes("(3/7)"));
  assert(progress[1].includes("(6/7)"));
  assert(progress[2].includes("(7/7)"));
  assertEquals(createdBatches, [
    { size: 3, startPosition: 1 },
    { size: 3, startPosition: 4 },
    { size: 1, startPosition: 7 },
  ]);
});

Deno.test("addItemsToDatabase: 취소 요청 시 진행 중인 배치 이후 생성을 중단", async () => {
  const notion = new NotionClient("test-notion-key") as any;
  let created = 0;
  const cancelError = new Error("검색이 취소되었습니다.");
  cancelError.name = "SearchCancelledError";

  notion.createContentItemPage = async () => {
    created++;
    return { id: `row-${created}` };
  };

  await assertRejects(
    () =>
      notion.addItemsToDatabase(
        "12345678123412341234123456789012",
        [
          {
            platform: "tistory",
            title: "첫 번째 글",
            url: "https://post.tistory.com/1",
            description: "desc",
          },
          {
            platform: "tistory",
            title: "두 번째 글",
            url: "https://post.tistory.com/2",
            description: "desc",
          },
          {
            platform: "tistory",
            title: "세 번째 글",
            url: "https://post.tistory.com/3",
            description: "desc",
          },
          {
            platform: "tistory",
            title: "네 번째 글",
            url: "https://post.tistory.com/4",
            description: "desc",
          },
        ],
        undefined,
        new Map(),
        null,
        {
          throwIfCancelled: async () => {
            if (created >= 3) throw cancelError;
          },
        },
      ),
    Error,
    "검색이 취소되었습니다.",
  );

  assertEquals(created, 3);
});

Deno.test("findOrCreateContentPageTemplatePage: 빈 템플릿에 기본 구조를 추가", async () => {
  const notion = new NotionClient("test-notion-key") as any;
  let appendedBlocks: any[] = [];

  notion.findSettingsPageFromEntry = async () =>
    "11111111-1111-1111-1111-111111111111";
  notion.findChildPageIdByTitle = async () =>
    "22222222-2222-2222-2222-222222222222";
  notion.listAllBlockChildren = async () => [];
  notion.appendBlocks = async (_pageId: string, blocks: any[]) => {
    appendedBlocks = blocks;
  };

  const template = await notion.findOrCreateContentPageTemplatePage(
    "33333333-3333-3333-3333-333333333333",
  );

  assertEquals(template, {
    pageId: "22222222-2222-2222-2222-222222222222",
    topLevelBlockCount: 1,
  });
  assertEquals(
    appendedBlocks[0].heading_2.rich_text[0].text.content,
    "원문 콘텐츠",
  );
});

Deno.test("createContentItemPage: 템플릿 적용 완료 후 원문 블록을 추가", async () => {
  const notion = new NotionClient("test-notion-key") as any;
  const requests: Array<{
    path: string;
    method?: string;
    headers?: HeadersInit;
    body?: Record<string, any>;
  }> = [];
  const rowId = "44444444-4444-4444-4444-444444444444";

  notion.fetchApi = async (path: string, init: RequestInit) => {
    requests.push({
      path,
      method: init.method,
      headers: init.headers,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (path === "pages") return { id: rowId };
    if (init.method === "GET") {
      return {
        results: [{
          id: "55555555-5555-5555-5555-555555555555",
          type: "heading_2",
        }],
        has_more: false,
      };
    }
    return { results: [] };
  };

  await notion.createContentItemPage(
    "11111111-1111-1111-1111-111111111111",
    {
      parent: { database_id: "11111111-1111-1111-1111-111111111111" },
      properties: {
        "제목": {
          title: [{ type: "text", text: { content: "테스트 콘텐츠" } }],
        },
      },
    },
    {
      platform: "tistory",
      title: "테스트 콘텐츠",
      url: "https://post.tistory.com/1",
      description: "설명",
    },
    "22222222-2222-2222-2222-222222222222",
    "33333333-3333-3333-3333-333333333333",
    1,
  );

  assertEquals(requests[0].body?.template, {
    type: "template_id",
    template_id: "33333333-3333-3333-3333-333333333333",
  });
  assertEquals(requests[1].method, "GET");
  assertEquals(requests[2].method, "PATCH");
  assertEquals(requests[2].body?.children[0].type, "paragraph");
  assertEquals(requests[2].body?.children[1].type, "embed");
});

Deno.test("moveGettingStartedToggleNextToSettings: 설정 링크 뒤로 전체 토글 트리 복제", async () => {
  const notion = new NotionClient("test-notion-key") as any;
  const requests: Array<{
    path: string;
    method?: string;
    body?: Record<string, any>;
  }> = [];
  let created = 0;

  const richText = (content: string) => [{
    type: "text",
    text: { content, link: null },
    annotations: {
      bold: false,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
      color: "default",
    },
    plain_text: content,
    href: null,
  }];
  const start = {
    id: "11111111-1111-1111-1111-111111111111",
    type: "toggle",
    toggle: { rich_text: richText("📖 시작하기"), color: "default" },
    has_children: true,
  };
  const settings = {
    id: "22222222-2222-2222-2222-222222222222",
    type: "child_page",
    child_page: { title: "설정" },
    has_children: false,
  };
  const paragraph = {
    id: "33333333-3333-3333-3333-333333333333",
    type: "paragraph",
    paragraph: { rich_text: richText("안내"), color: "default", icon: null },
    has_children: false,
  };
  const nestedToggle = {
    id: "44444444-4444-4444-4444-444444444444",
    type: "toggle",
    toggle: { rich_text: richText("도움말"), color: "default" },
    has_children: true,
  };
  const callout = {
    id: "55555555-5555-5555-5555-555555555555",
    type: "callout",
    callout: {
      rich_text: richText("문의하세요"),
      icon: { type: "emoji", emoji: "💡" },
      color: "gray_background",
    },
    has_children: false,
  };

  notion.getDatabaseParentPageId = async () =>
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  notion.listAllBlockChildren = async (id: string) => {
    if (id.startsWith("aaaaaaaa")) return [start, settings];
    if (id === start.id) return [paragraph, nestedToggle];
    if (id === nestedToggle.id) return [callout];
    return [];
  };
  notion.fetchApi = async (path: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ path, method: init.method, body });
    if (init.method === "PATCH") {
      created++;
      return {
        results: [{
          id: `99999999-9999-9999-9999-${String(created).padStart(12, "0")}`,
        }],
      };
    }
    return {};
  };

  await notion.moveGettingStartedToggleNextToSettings(
    "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  );

  const patchRequests = requests.filter((request) =>
    request.method === "PATCH"
  );
  assertEquals(patchRequests.length, 4);
  assertEquals(patchRequests[0].body?.position, {
    type: "after_block",
    after_block: { id: settings.id },
  });
  assertEquals(
    patchRequests[0].body?.children[0].toggle.rich_text[0].plain_text,
    undefined,
  );
  assertEquals(
    patchRequests[0].body?.children[0].toggle.rich_text[0].text.content,
    "📖 시작하기",
  );
  assertEquals(
    patchRequests[1].body?.children[0].paragraph.icon,
    undefined,
  );
  assertEquals(requests.at(-1), {
    path: `blocks/${start.id}`,
    method: "DELETE",
    body: undefined,
  });
});

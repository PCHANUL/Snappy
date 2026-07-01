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
  );

  assertEquals(rows.length, 7);
  assertEquals(maxActive, 3);
  assert(progress[0].includes("(3/7)"));
  assert(progress[1].includes("(6/7)"));
  assert(progress[2].includes("(7/7)"));
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

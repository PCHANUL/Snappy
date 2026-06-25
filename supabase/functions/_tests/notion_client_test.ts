import "./setup.ts";
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
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
      status: "done",
    },
    new Map([
      ["분석 상태", "select"],
      ["요약", "rich_text"],
      ["키워드", "multi_select"],
      ["신뢰도", "number"],
    ]),
  );

  assertEquals(capturedPath, "pages/12345678-1234-1234-1234-123456789012");
  assertEquals(capturedBody.properties["신뢰도"], { number: 0.82 });
});

// Tavily Extract 기반 본문/메타데이터 추출
// 모든 매체 URL을 먼저 Extract로 시도하고, 실패 시 기존 플랫폼별 크롤러가 fallback한다.

import { env } from "../_core/env.ts";
import { ExternalApiError } from "../_core/errors.ts";
import { logger } from "../_core/logger.ts";

const TAVILY_EXTRACT_URL = "https://api.tavily.com/extract";
const MIN_TEXT_LENGTH = 10;

export interface TavilyExtractContent {
  status: "done" | "failed";
  full_text?: string;
  word_count?: number;
}

interface TavilyExtractItem {
  url?: string;
  raw_content?: string | null;
  content?: string | null;
}

interface TavilyExtractResponse {
  results?: TavilyExtractItem[];
  failed_results?: Array<{ url?: string; error?: string }>;
  usage?: { credits?: number };
}

export async function extractUrlWithTavily(
  url: string,
): Promise<TavilyExtractContent> {
  const response = await fetch(TAVILY_EXTRACT_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.tavily.apiKey}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      urls: [url],
      extract_depth: "advanced",
      format: "text",
      include_images: false,
      include_favicon: false,
      include_usage: true,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new ExternalApiError("Tavily Extract", `${response.status} ${body}`);
  }

  const data: TavilyExtractResponse = await response.json();
  const extractedItem = data.results?.find((item) =>
    item.raw_content || item.content
  );
  const text = normalizeExtractedText(
    extractedItem?.raw_content ?? extractedItem?.content ?? "",
  );

  if (text.length < MIN_TEXT_LENGTH) {
    logger.info("Tavily extract returned no usable text", {
      url,
      failedResults: data.failed_results?.length ?? 0,
      credits: data.usage?.credits,
    });
    return { status: "failed" };
  }

  logger.info("Tavily extract completed", {
    url,
    chars: text.length,
    credits: data.usage?.credits,
  });

  return {
    status: "done",
    full_text: text,
    word_count: countWords(text),
  };
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

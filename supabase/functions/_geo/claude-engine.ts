// Claude 엔진 어댑터 — web_search 도구로 AI 인용을 수집한다.
// 기존 ANTHROPIC_API_KEY를 재사용하므로 새 비용/키 없이 GEO 측정을 시작할 수 있다.
//
// 응답은 text / server_tool_use / web_search_tool_result 블록이 섞여 오므로
// 위치가 아니라 type으로 파싱한다 (기획서 7-4). citation이 비어 올 수 있음을 전제.

import { rootDomain } from '../_core/domain.ts';
import { logger } from '../_core/logger.ts';
import type { Citation, NormalizedResult } from './types.ts';

const ANTHROPIC_API_BASE = 'https://api.anthropic.com/v1';
const WEB_SEARCH_TOOL = 'web_search_20250305';

// 모델은 명시적으로 핀 고정 (기획서 7-6). "latest"는 조용한 오염을 부른다.
const GEO_MODEL = 'claude-haiku-4-5-20251001';
const MAX_SEARCHES = 5;

export async function queryClaudeGeo(
  apiKey: string,
  question: string,
): Promise<NormalizedResult> {
  const runAt = new Date().toISOString();

  const res = await fetch(`${ANTHROPIC_API_BASE}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GEO_MODEL,
      max_tokens: 1024,
      tools: [{ type: WEB_SEARCH_TOOL, name: 'web_search', max_uses: MAX_SEARCHES }],
      messages: [{ role: 'user', content: question }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic web_search ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const { answer, citations } = parseClaudeResponse(data);

  logger.info('GEO Claude query done', { question, citations: citations.length });

  return { answer, citations, engine: 'claude', model: GEO_MODEL, question, runAt };
}

// content 배열을 type 기준으로 파싱.
// - text 블록: answer 본문 + 모델이 실제 인용한 출처(citations[])
// - web_search_tool_result 블록: 검색으로 찾은 후보(인용 0개일 때 폴백)
export function parseClaudeResponse(
  data: { content?: unknown[] },
): { answer: string; citations: Citation[] } {
  const blocks = Array.isArray(data.content) ? data.content : [];
  const answerParts: string[] = [];
  const seen = new Set<string>();
  const citations: Citation[] = [];

  const push = (url?: string, title?: string, snippet?: string) => {
    if (!url) return;
    const root = rootDomain(url);
    if (!root || seen.has(url)) return;
    seen.add(url);
    citations.push({ url, rootDomain: root, rank: citations.length + 1, title, snippet });
  };

  for (const block of blocks as Array<Record<string, any>>) {
    if (block?.type === 'text') {
      if (typeof block.text === 'string') answerParts.push(block.text);
      // 모델이 답변에서 실제 인용한 출처 — GEO의 핵심 신호
      for (const c of block.citations ?? []) {
        push(c?.url, c?.title, c?.cited_text);
      }
    }
  }

  // 인용이 0개면 검색 후보를 폴백으로 (빈 인용도 유효 데이터지만, 후보는 참고용)
  if (citations.length === 0) {
    for (const block of blocks as Array<Record<string, any>>) {
      if (block?.type === 'web_search_tool_result') {
        for (const r of block.content ?? []) {
          push(r?.url, r?.title);
        }
      }
    }
  }

  return { answer: answerParts.join('').trim(), citations };
}

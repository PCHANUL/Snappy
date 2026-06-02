import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { parseClaudeResponse } from '../_geo/claude-engine.ts';
import { buildQuestion } from '../_geo/question-template.ts';
import { parseQuestionLines } from '../_analysis/anthropic.ts';

// ── parseClaudeResponse ────────────────────────────────────────────────────

Deno.test('parseClaudeResponse: text 블록의 citations에서 인용 추출 + 루트 도메인', () => {
  const data = {
    content: [
      {
        type: 'text',
        text: '추천 글입니다.',
        citations: [
          { type: 'web_search_result_location', url: 'https://blog.naver.com/a/1', title: 'A', cited_text: '맥락A' },
          { type: 'web_search_result_location', url: 'https://myblog.tistory.com/2', title: 'B' },
        ],
      },
    ],
  };
  const { answer, citations } = parseClaudeResponse(data);
  assertEquals(answer, '추천 글입니다.');
  assertEquals(citations.length, 2);
  assertEquals(citations[0], { url: 'https://blog.naver.com/a/1', rootDomain: 'naver.com', rank: 1, title: 'A', snippet: '맥락A' });
  assertEquals(citations[1].rootDomain, 'tistory.com');
  assertEquals(citations[1].rank, 2);
});

Deno.test('parseClaudeResponse: 중복 URL 제거', () => {
  const data = {
    content: [
      {
        type: 'text',
        text: 'x',
        citations: [
          { url: 'https://example.com/1' },
          { url: 'https://example.com/1' },
        ],
      },
    ],
  };
  const { citations } = parseClaudeResponse(data);
  assertEquals(citations.length, 1);
});

Deno.test('parseClaudeResponse: 인용 0개면 web_search_tool_result 폴백', () => {
  const data = {
    content: [
      { type: 'text', text: '답변만 있고 인용 없음' },
      {
        type: 'web_search_tool_result',
        content: [
          { type: 'web_search_result', url: 'https://www.example.co.kr/p', title: 'C' },
        ],
      },
    ],
  };
  const { answer, citations } = parseClaudeResponse(data);
  assertEquals(answer, '답변만 있고 인용 없음');
  assertEquals(citations.length, 1);
  assertEquals(citations[0].rootDomain, 'example.co.kr');
});

Deno.test('parseClaudeResponse: 빈 응답 → 빈 인용 (유효 데이터)', () => {
  assertEquals(parseClaudeResponse({}), { answer: '', citations: [] });
  assertEquals(parseClaudeResponse({ content: [] }).citations.length, 0);
});

Deno.test('parseClaudeResponse: 여러 text 블록 본문 이어붙임', () => {
  const data = { content: [{ type: 'text', text: '앞 ' }, { type: 'text', text: '뒤' }] };
  assertEquals(parseClaudeResponse(data).answer, '앞 뒤');
});

// ── buildQuestion ──────────────────────────────────────────────────────────

Deno.test('buildQuestion: 기본 의도(추천)', () => {
  assertEquals(buildQuestion('강남 치과 임플란트'), '강남 치과 임플란트 추천해줘');
});

Deno.test('buildQuestion: 의도별 템플릿', () => {
  assertEquals(buildQuestion('비건 디저트', 'info'), '비건 디저트에 대해 알려줘');
  assertEquals(buildQuestion('전기차', 'compare'), '전기차 비교해줘');
});

Deno.test('buildQuestion: 앞뒤 공백 정리', () => {
  assertEquals(buildQuestion('  노트북  '), '노트북 추천해줘');
});

// ── parseQuestionLines ─────────────────────────────────────────────────────

Deno.test('parseQuestionLines: 번호·불릿 제거', () => {
  const text = '1. 첫 질문?\n2) 둘째 질문?\n- 셋째 질문?';
  assertEquals(parseQuestionLines(text, 3), ['첫 질문?', '둘째 질문?', '셋째 질문?']);
});

Deno.test('parseQuestionLines: 따옴표 제거 + max 제한', () => {
  const text = '"질문 하나"\n질문 둘\n질문 셋';
  assertEquals(parseQuestionLines(text, 2), ['질문 하나', '질문 둘']);
});

Deno.test('parseQuestionLines: 빈 줄 무시', () => {
  assertEquals(parseQuestionLines('\n\n질문\n\n', 5), ['질문']);
});

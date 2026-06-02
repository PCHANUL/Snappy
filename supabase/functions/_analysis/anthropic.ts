const ANTHROPIC_API_BASE = 'https://api.anthropic.com/v1';
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const MAX_INPUT_CHARS = 4000;

export async function summarizeContent(
  apiKey: string,
  text: string,
  keyword: string,
): Promise<string> {
  const input = text.slice(0, MAX_INPUT_CHARS);
  const res = await fetch(`${ANTHROPIC_API_BASE}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: `다음 글을 읽고 "${keyword}" 주제와 관련된 핵심 내용을 한국어로 2~3문장으로 요약하세요. 요약 외에는 출력하지 마세요.\n\n${input}`,
      }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return (data.content?.[0]?.text ?? '').trim();
}

// 키워드로 사람들이 생성형 AI에 실제로 물을 법한 질문을 생성한다 (GEO 입력용).
// SEO엔 키워드 그대로, GEO엔 질의문을 넣어야 인용 해석이 안정적이다(기획서 5-3).
// 표준 의도(추천·정보·비교)를 커버하도록 최대 N개를 뽑는다.
export async function generateSearchQuestions(
  apiKey: string,
  keyword: string,
  count = 3,
): Promise<string[]> {
  const res = await fetch(`${ANTHROPIC_API_BASE}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: 300,
      messages: [{
        role: 'user',
        content:
          `"${keyword}" 주제로 사람들이 ChatGPT·Claude 같은 생성형 AI에게 실제로 물어볼 법한 ` +
          `자연스러운 한국어 질문을 ${count}개 만들어줘. 추천형·정보형·비교형 의도를 골고루 섞어줘.\n` +
          `각 질문은 한 줄로, 번호나 불릿 없이 줄바꿈으로만 구분해서 질문만 출력해.`,
      }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const text: string = data.content?.[0]?.text ?? '';
  return parseQuestionLines(text, count);
}

// 모델 출력(줄바꿈 구분)을 정리해 질문 배열로. 번호/불릿/따옴표 제거.
export function parseQuestionLines(text: string, max: number): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').replace(/^["']|["']$/g, '').trim())
    .filter((line) => line.length > 0)
    .slice(0, max);
}

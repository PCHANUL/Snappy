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

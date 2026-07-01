const ANTHROPIC_API_BASE = "https://api.anthropic.com/v1";
const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const MAX_INPUT_CHARS = 4000;
const ANTHROPIC_TIMEOUT_MS = 30_000;

export interface LlmContentAnalysis {
  summary?: string;
  keywords: string[];
  confidence?: number;
  author?: string;
}

export async function summarizeContent(
  apiKey: string,
  text: string,
  keyword: string,
): Promise<string> {
  const input = text.slice(0, MAX_INPUT_CHARS);
  const res = await fetch(`${ANTHROPIC_API_BASE}/messages`, {
    method: "POST",
    signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: 256,
      messages: [{
        role: "user",
        content:
          `다음 글을 읽고 "${keyword}" 주제와 관련된 핵심 내용을 한국어로 2~3문장으로 요약하세요. 요약 외에는 출력하지 마세요.\n\n${input}`,
      }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return (data.content?.[0]?.text ?? "").trim();
}

export async function analyzeContentWithLLM(
  apiKey: string,
  text: string,
  keyword: string,
): Promise<LlmContentAnalysis> {
  const input = text.slice(0, MAX_INPUT_CHARS);
  const res = await fetch(`${ANTHROPIC_API_BASE}/messages`, {
    method: "POST",
    signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: 500,
      messages: [{
        role: "user",
        content: `다음 원문은 웹/소셜 콘텐츠에서 추출한 raw text입니다. ` +
          `네비게이션, 광고, 댓글 UI, 반복 문구 같은 노이즈는 무시하고 "${keyword}" 주제와 관련된 핵심만 분석하세요.\n\n` +
          `반드시 JSON만 출력하세요. 마크다운 코드블록은 쓰지 마세요.\n` +
          `형식: {"summary":"한국어 2~3문장 요약","keywords":["핵심키워드1","핵심키워드2","핵심키워드3","핵심키워드4","핵심키워드5"],"confidence":0.82,"author":"작성자 또는 채널명"}\n` +
          `keywords는 검색/분류에 쓸 짧은 한국어 명사구 또는 원문 해시태그 기반 키워드로 최대 5개만 넣으세요.\n\n` +
          `author는 원문에 명시된 작성자, 계정명 또는 채널명만 넣으세요. 확인할 수 없으면 빈 문자열로 두고 절대 추측하지 마세요.\n\n` +
          `confidence는 실제 콘텐츠 본문/설명/자막을 근거로 분석했다고 판단되는 정도를 0~1 숫자로 넣으세요. ` +
          `메뉴, 추천 콘텐츠, 댓글 UI, 메타데이터가 대부분이면 낮게 평가하세요.\n\n` +
          input,
      }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const textOut: string = data.content?.[0]?.text ?? "";
  return parseContentAnalysisJson(textOut);
}

export function parseContentAnalysisJson(text: string): LlmContentAnalysis {
  const cleaned = text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const jsonText = extractJsonObject(cleaned);
  const parsed = JSON.parse(jsonText);

  const summary = typeof parsed.summary === "string"
    ? parsed.summary.replace(/\s+/g, " ").trim()
    : undefined;
  const keywords = Array.isArray(parsed.keywords)
    ? parsed.keywords
      .filter((value: unknown): value is string => typeof value === "string")
      .map((value: string) =>
        value.replace(/,/g, " ").replace(/\s+/g, " ").trim().slice(0, 100)
      )
      .filter((value: string, index: number, arr: string[]) =>
        value.length > 0 && arr.indexOf(value) === index
      )
      .slice(0, 5)
    : [];
  const confidence = normalizeConfidence(parsed.confidence);
  const author = normalizeAuthor(parsed.author);

  return { summary, keywords, confidence, author };
}

function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return text;
  return text.slice(start, end + 1);
}

function normalizeConfidence(value: unknown): number | undefined {
  let score: number;
  if (typeof value === "number") {
    score = value;
  } else if (typeof value === "string") {
    const normalized = value.trim().replace(/%$/, "");
    if (!normalized) return undefined;
    score = Number(normalized);
    if (value.trim().endsWith("%")) score = score / 100;
  } else {
    return undefined;
  }

  if (!Number.isFinite(score)) return undefined;
  if (score >= 2 && score <= 100) score = score / 100;
  return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
}

function normalizeAuthor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const author = value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  if (!author || author.length > 100) return undefined;
  if (/^(알 수 없음|unknown|n\/a|없음|-|작성자 미상)$/i.test(author)) {
    return undefined;
  }
  return author;
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
    method: "POST",
    signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: 300,
      messages: [{
        role: "user",
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
  const text: string = data.content?.[0]?.text ?? "";
  return parseQuestionLines(text, count);
}

// 모델 출력(줄바꿈 구분)을 정리해 질문 배열로. 번호/불릿/따옴표 제거.
export function parseQuestionLines(text: string, max: number): string[] {
  return text
    .split("\n")
    .map((line) =>
      line.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").replace(/^["']|["']$/g, "")
        .trim()
    )
    .filter((line) => line.length > 0)
    .slice(0, max);
}

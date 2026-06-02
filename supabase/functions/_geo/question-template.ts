// 질의문 템플릿 — GEO 측정의 "조건 고정" 장치 (기획서 5-3, 7-1)
//
// 같은 키워드를 매번 다른 문장으로 물으면 노이즈 바닥이 의미를 잃는다.
// 기본은 시스템 고정 템플릿 1개를 모두에게 동일 적용해 키워드 간 비교를 공정하게 한다.
// 자유 질의문은 프로의 액티브 프로브 트랙에서만 개방한다.

export type QuestionIntent = 'recommend' | 'info' | 'compare';

const TEMPLATES: Record<QuestionIntent, (keyword: string) => string> = {
  recommend: (k) => `${k} 추천해줘`,
  info: (k) => `${k}에 대해 알려줘`,
  compare: (k) => `${k} 비교해줘`,
};

// 시스템 표준 의도 — 노이즈 바닥이 가장 깨끗한 기본값
export const DEFAULT_INTENT: QuestionIntent = 'recommend';

// 키워드 → 고정 질의문. 의도 분류 결과는 호출부에서 고정 저장해 재분류 금지.
export function buildQuestion(keyword: string, intent: QuestionIntent = DEFAULT_INTENT): string {
  const k = keyword.trim();
  return (TEMPLATES[intent] ?? TEMPLATES[DEFAULT_INTENT])(k);
}

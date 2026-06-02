// GEO(생성형 엔진 최적화) 측정 공통 타입
// 엔진마다 인용 반환 형식이 다르므로 이 형태로 정규화한다 (기획서 7-4).

export type GeoEngine = 'claude' | 'openai' | 'perplexity' | 'gemini';

export interface Citation {
  url: string;
  rootDomain: string; // _core/domain.ts 규칙으로 추출 (SEO와 공유)
  rank: number; // 답변 내 인용 순서 (1부터)
  title?: string;
  snippet?: string; // 인용 맥락
}

export interface NormalizedResult {
  answer: string;
  citations: Citation[];
  engine: GeoEngine;
  model: string; // 핀 고정된 버전 식별자 (기획서 7-6)
  question: string; // 실제 던진 질의문
  runAt: string; // ISO 스냅샷 시각 (비결정성 때문에 필수)
}

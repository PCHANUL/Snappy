// 검색 결과 제목/설명에서 연관 키워드 후보 추출
// 한국어 파티클 제거 + 불용어 필터 + 빈도 기반 정렬

import type { SearchResult } from './types.ts';

const STOPWORDS = new Set([
  // 한국어 일반 명사 (단독으로는 키워드 가치 없음)
  '추천', '방법', '정보', '오늘', '정리', '후기', '리뷰', '소개', '기본',
  '최신', '완벽', '쉽게', '제대로', '꿀팁', '공유', '방문', '최고', '최대',
  '대한', '위한', '경우', '부분', '결과', '이유', '제일', '모든', '관련',
  '다양', '다양한', '무료', '유료', '총정리', '완전', '핵심', '필수', '기초',
  '시작', '완성', '모음', '목록', '리스트', '가이드', '튜토리얼', '강의',
  '공부', '배우', '배움', '입문', '초보', '중급', '고급', '전문',
  '종류', '특징', '차이', '비교', '활용', '이용', '사용', '적용',
  '직접', '간단', '빠른', '쉬운', '좋은', '나쁜', '최근', '이번',
  '한번', '한번에', '바로', '즉시', '처음', '마지막',
  // 동사형/접속어
  '하는', '있는', '없는', '이런', '저런', '그런', '어떤', '같은', '다른',
  '내가', '우리', '당신', '자신', '직접', '함께', '혼자',
  // 영어 불용어
  'how', 'the', 'and', 'for', 'with', 'this', 'that', 'from', 'have',
  'what', 'when', 'why', 'are', 'was', 'not', 'but', 'you', 'all',
]);

// 제거할 한국어 파티클 (긴 것 우선 — 짧은 것이 먼저 걸리는 오류 방지)
const PARTICLES = [
  '에서도', '이라는', '라는', '에서는', '으로는', '으로도', '로서의',
  '에서', '으로', '로서', '부터', '까지', '에게', '이라', '이란',
  '에도', '에는', '이고', '이다', '이랑', '이나', '이든',
  '하는', '하는', '하고', '하여', '해서', '하면', '하지',
  '를', '을', '은', '는', '이', '가', '와', '과', '의', '에', '도', '로', '만',
];

function stripParticle(token: string): string {
  for (const p of PARTICLES) {
    if (token.endsWith(p) && token.length - p.length >= 2) {
      return token.slice(0, token.length - p.length);
    }
  }
  return token;
}

function tokenize(text: string): string[] {
  return text
    .replace(/https?:\/\/\S+/g, ' ')            // URL 제거
    .replace(/\d{4}[-./]\d{1,2}[-./]\d{1,2}/g, ' ') // 날짜 제거
    .replace(/[^\w\s가-힣ㄱ-ㅎㅏ-ㅣ]/g, ' ')   // 특수문자 → 공백
    .split(/\s+/)
    .filter(Boolean)
    .map(stripParticle)
    .filter((t) => t.length >= 2);
}

export function extractCandidateKeywords(
  results: SearchResult[],
  seedKeyword: string,
  maxCandidates = 20,
): string[] {
  const seedNorm = seedKeyword.trim().toLowerCase();
  const seedTokens = new Set(tokenize(seedKeyword).map((t) => t.toLowerCase()));

  const singleFreq = new Map<string, number>();
  const bigramFreq = new Map<string, number>();

  for (const result of results) {
    for (const item of result.items) {
      const texts = [item.title, item.description, item.snippet].filter(Boolean) as string[];
      for (const text of texts) {
        const tokens = tokenize(text);
        for (let i = 0; i < tokens.length; i++) {
          const t = tokens[i];
          const lower = t.toLowerCase();
          if (lower === seedNorm) continue;
          if (seedTokens.has(lower)) continue;
          if (STOPWORDS.has(lower)) continue;
          if (/^\d+$/.test(t)) continue;
          singleFreq.set(t, (singleFreq.get(t) ?? 0) + 1);

          // 바이그램: 인접한 두 토큰 모두 유효한 경우
          if (i + 1 < tokens.length) {
            const t2 = tokens[i + 1];
            const lower2 = t2.toLowerCase();
            if (!STOPWORDS.has(lower2) && !seedTokens.has(lower2) && !/^\d+$/.test(t2)) {
              const bigram = `${t} ${t2}`;
              bigramFreq.set(bigram, (bigramFreq.get(bigram) ?? 0) + 1);
            }
          }
        }
      }
    }
  }

  // 바이그램은 2회 이상 등장한 것만 포함 (단순 우연 제거)
  const candidates: Array<{ word: string; score: number }> = [];

  for (const [word, count] of singleFreq) {
    candidates.push({ word, score: count });
  }
  for (const [phrase, count] of bigramFreq) {
    if (count >= 2) {
      // 바이그램은 구성 단어보다 정보 밀도가 높으므로 가중치 부여
      candidates.push({ word: phrase, score: count * 1.5 });
    }
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .map((c) => c.word)
    .slice(0, maxCandidates);
}

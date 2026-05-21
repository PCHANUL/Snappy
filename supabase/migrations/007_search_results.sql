-- 검색 결과 영구 저장 테이블
-- search_result_cache(임시, 단일 row) 대체
-- 이력 누적 → 키워드 추출, 매체 컨텐츠 생성 등 AI 기능에 활용

CREATE TABLE search_results (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notion_page_id  TEXT        NOT NULL,
  keyword         TEXT        NOT NULL,
  platforms       TEXT[]      NOT NULL DEFAULT '{}',
  period          TEXT        NOT NULL DEFAULT 'month',
  flat_results    JSONB       NOT NULL DEFAULT '[]',  -- FlatResult[] (platform 포함)
  metadata        JSONB       NOT NULL DEFAULT '{}',  -- { duration_ms, cost_usd, total }
  shown_count     INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 더보기 페이지네이션: 특정 페이지의 최신 검색 조회
CREATE INDEX idx_search_results_page_user
  ON search_results(notion_page_id, user_id, created_at DESC);

-- 사용자별 이력 조회 (키워드 추출, 통계)
CREATE INDEX idx_search_results_user_created
  ON search_results(user_id, created_at DESC);

-- 키워드별 집계 (향후 트렌드 분석)
CREATE INDEX idx_search_results_keyword
  ON search_results(keyword, created_at DESC);

ALTER TABLE search_results ENABLE ROW LEVEL SECURITY;
-- 정책 없음 = service_role만 접근 가능

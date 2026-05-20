-- 검색 결과 캐시 — 페이지네이션된 서브페이지 생성에 사용
-- notion_page_id 기준으로 upsert, 24시간 후 만료

CREATE TABLE search_result_cache (
  notion_page_id  TEXT        PRIMARY KEY,
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  keyword         TEXT        NOT NULL,
  flat_results    JSONB       NOT NULL,  -- FlatResult[] (platform 포함)
  metadata        JSONB       NOT NULL,  -- { duration_ms, cost_usd, total }
  shown_count     INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE INDEX search_result_cache_user_id_idx  ON search_result_cache(user_id);
CREATE INDEX search_result_cache_expires_idx  ON search_result_cache(expires_at);

ALTER TABLE search_result_cache ENABLE ROW LEVEL SECURITY;
-- 정책 없음 = service_role만 접근 가능

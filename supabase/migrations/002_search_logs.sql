-- 검색 로그 테이블
-- 사용자별 검색 이력 추적, 비용 모니터링, 디버깅 용도

CREATE TABLE IF NOT EXISTS search_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,

  -- 요청 정보
  keyword TEXT NOT NULL,
  platforms TEXT[] NOT NULL,
  period TEXT NOT NULL,

  -- 결과 정보
  result_count INT NOT NULL DEFAULT 0,
  duration_ms INT NOT NULL DEFAULT 0,
  cost_usd DECIMAL(10, 4) NOT NULL DEFAULT 0,

  -- 상태
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  error_message TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 인덱스: 사용자별 최근 검색 조회용
CREATE INDEX IF NOT EXISTS idx_search_logs_user_created
  ON search_logs(user_id, created_at DESC);

-- 인덱스: 비용 집계용
CREATE INDEX IF NOT EXISTS idx_search_logs_created
  ON search_logs(created_at DESC);

-- 인덱스: 실패 케이스 조회용
CREATE INDEX IF NOT EXISTS idx_search_logs_failed
  ON search_logs(status, created_at DESC)
  WHERE status = 'failed';

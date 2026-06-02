-- 노이즈 바닥·변동성 측정 (기획서 7-5)
-- 같은 질문을 N회 호출한 묶음(batch)과 그 변동성 집계를 저장한다.

-- geo_runs에 batch 그룹 식별자 추가 (N회 호출을 한 묶음으로)
ALTER TABLE geo_runs ADD COLUMN IF NOT EXISTS batch_id UUID;
CREATE INDEX IF NOT EXISTS idx_geo_runs_batch ON geo_runs(batch_id);

-- 노이즈 바닥 집계 결과 (batch당 1행)
CREATE TABLE geo_noise_floors (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id      UUID        NOT NULL,
  keyword_id    UUID        REFERENCES geo_tracked_keywords(id) ON DELETE CASCADE,
  engine        TEXT        NOT NULL DEFAULT 'claude',
  model         TEXT        NOT NULL,
  question      TEXT        NOT NULL,
  runs          INTEGER     NOT NULL,          -- 호출 횟수 N
  avg_jaccard   REAL        NOT NULL,          -- 집합 안정성 (0~1)
  avg_rbo       REAL        NOT NULL,          -- 순위 안정성 (0~1)
  stable_domains   TEXT[]   NOT NULL DEFAULT '{}',  -- 모든 호출에 등장한 코어 도메인
  volatile_domains TEXT[]   NOT NULL DEFAULT '{}',  -- 일부 호출에만 등장한 도메인
  domain_frequency JSONB    NOT NULL DEFAULT '{}',  -- 도메인별 등장 비율
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_geo_noise_floors_keyword ON geo_noise_floors(keyword_id, created_at DESC);
ALTER TABLE geo_noise_floors ENABLE ROW LEVEL SECURITY;

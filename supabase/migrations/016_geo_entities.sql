-- GEO 측정 엔티티 3계층 스키마
-- geo_entities → geo_tracked_keywords → geo_runs → geo_citations / geo_seo_snapshots
--
-- 엔티티(브랜드·제품 등)를 등록하고, 키워드를 추적하여
-- geo-measure 호출 결과를 시계열로 쌓는다.

-- 1. 추적 대상 엔티티
CREATE TABLE geo_entities (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  self_domain TEXT,                         -- 격차 매트릭스에서 강조할 루트 도메인
  type        TEXT        NOT NULL DEFAULT 'brand'
              CHECK (type IN ('brand', 'website', 'product', 'person')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_geo_entities_user ON geo_entities(user_id, created_at DESC);
ALTER TABLE geo_entities ENABLE ROW LEVEL SECURITY;

-- 2. 엔티티에 연결된 추적 키워드
CREATE TABLE geo_tracked_keywords (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   UUID        NOT NULL REFERENCES geo_entities(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  keyword     TEXT        NOT NULL,
  intent      TEXT        NOT NULL DEFAULT 'recommend'
              CHECK (intent IN ('recommend', 'info', 'compare')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_id, keyword)
);

CREATE INDEX idx_geo_tracked_keywords_entity ON geo_tracked_keywords(entity_id);
CREATE INDEX idx_geo_tracked_keywords_user   ON geo_tracked_keywords(user_id);
ALTER TABLE geo_tracked_keywords ENABLE ROW LEVEL SECURITY;

-- 3. 측정 실행 단위 (geo-measure 1회 호출 = 1 run)
CREATE TABLE geo_runs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword_id  UUID        NOT NULL REFERENCES geo_tracked_keywords(id) ON DELETE CASCADE,
  engine      TEXT        NOT NULL DEFAULT 'claude',
  model       TEXT        NOT NULL,
  question    TEXT        NOT NULL,
  answer      TEXT,
  run_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_geo_runs_keyword_time ON geo_runs(keyword_id, run_at DESC);
ALTER TABLE geo_runs ENABLE ROW LEVEL SECURITY;

-- 4. GEO 인용 목록 (run당 AI가 인용한 URL 행 단위)
CREATE TABLE geo_citations (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID        NOT NULL REFERENCES geo_runs(id) ON DELETE CASCADE,
  rank        INTEGER     NOT NULL,
  url         TEXT        NOT NULL,
  root_domain TEXT        NOT NULL,
  title       TEXT,
  snippet     TEXT
);

CREATE INDEX idx_geo_citations_run ON geo_citations(run_id, rank);
ALTER TABLE geo_citations ENABLE ROW LEVEL SECURITY;

-- 5. SEO 스냅샷 (run당 검색 결과 URL 행 단위)
CREATE TABLE geo_seo_snapshots (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID        NOT NULL REFERENCES geo_runs(id) ON DELETE CASCADE,
  platform    TEXT        NOT NULL,
  rank        INTEGER     NOT NULL,
  url         TEXT        NOT NULL,
  root_domain TEXT        NOT NULL,
  title       TEXT
);

CREATE INDEX idx_geo_seo_snapshots_run ON geo_seo_snapshots(run_id, rank);
ALTER TABLE geo_seo_snapshots ENABLE ROW LEVEL SECURITY;

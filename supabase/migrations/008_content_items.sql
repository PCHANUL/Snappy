-- search_results 구조 개선 + content_items 신규
--
-- Before: search_results.flat_results JSONB[] (블롭, 쿼리 불가)
-- After:
--   search_results  → 검색 이벤트 메타데이터
--   content_items   → URL 기준 중복 제거된 컨텐츠 (자체 데이터)
--   search_result_items → junction (어떤 검색에서 어떤 컨텐츠가 몇 번째로 나왔는지)

-- 1. search_results: flat_results 제거, total_count 추가
ALTER TABLE search_results DROP COLUMN flat_results;
ALTER TABLE search_results ADD COLUMN total_count INTEGER NOT NULL DEFAULT 0;

-- 2. 자체 컨텐츠 인덱스 — 모든 유저 검색에서 발견된 URL 중복 제거
CREATE TABLE content_items (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  url          TEXT        NOT NULL UNIQUE,
  platform     TEXT        NOT NULL,
  title        TEXT        NOT NULL,
  description  TEXT        NOT NULL DEFAULT '',
  snippet      TEXT,
  author       TEXT,
  thumbnail    TEXT,
  published_at TEXT,
  -- 발견 메타데이터
  keywords     TEXT[]      NOT NULL DEFAULT '{}',  -- 이 URL을 찾은 키워드들
  search_count INTEGER     NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_content_items_platform     ON content_items(platform);
CREATE INDEX idx_content_items_search_count ON content_items(search_count DESC);
CREATE INDEX idx_content_items_last_seen    ON content_items(last_seen_at DESC);
CREATE INDEX idx_content_items_keywords     ON content_items USING GIN(keywords);

ALTER TABLE content_items ENABLE ROW LEVEL SECURITY;

-- 3. 검색 결과 ↔ 컨텐츠 junction — 순서(rank) 보존
CREATE TABLE search_result_items (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  search_result_id UUID    NOT NULL REFERENCES search_results(id) ON DELETE CASCADE,
  content_item_id  UUID    NOT NULL REFERENCES content_items(id)  ON DELETE CASCADE,
  rank             INTEGER NOT NULL,  -- 검색 결과 내 순서 (1-based)
  UNIQUE(search_result_id, rank)
);

CREATE INDEX idx_search_result_items_lookup
  ON search_result_items(search_result_id, rank);

ALTER TABLE search_result_items ENABLE ROW LEVEL SECURITY;

-- 4. 배치 upsert RPC — search_count 증가 + keywords 누적
-- 단일 SQL로 처리하여 N+1 쿼리 방지
CREATE OR REPLACE FUNCTION upsert_content_items(
  p_keyword TEXT,
  p_items   JSONB   -- ContentItem[] JSON 배열
)
RETURNS TABLE(id UUID, url TEXT) AS $$
BEGIN
  RETURN QUERY
  INSERT INTO content_items (
    url, platform, title, description, snippet,
    author, thumbnail, published_at, keywords
  )
  SELECT
    item->>'url',
    item->>'platform',
    item->>'title',
    COALESCE(item->>'description', ''),
    NULLIF(item->>'snippet', ''),
    NULLIF(item->>'author', ''),
    NULLIF(item->>'thumbnail', ''),
    NULLIF(item->>'published_at', ''),
    ARRAY[p_keyword]
  FROM jsonb_array_elements(p_items) AS item
  ON CONFLICT (url) DO UPDATE SET
    title        = EXCLUDED.title,
    description  = CASE WHEN EXCLUDED.description <> '' THEN EXCLUDED.description ELSE content_items.description END,
    snippet      = COALESCE(EXCLUDED.snippet,      content_items.snippet),
    author       = COALESCE(EXCLUDED.author,       content_items.author),
    thumbnail    = COALESCE(EXCLUDED.thumbnail,    content_items.thumbnail),
    keywords     = (
      SELECT ARRAY(SELECT DISTINCT unnest(content_items.keywords || ARRAY[p_keyword]))
    ),
    search_count = content_items.search_count + 1,
    last_seen_at = NOW()
  RETURNING id, url;
END;
$$ LANGUAGE plpgsql;

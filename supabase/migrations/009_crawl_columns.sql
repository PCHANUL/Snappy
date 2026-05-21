-- content_items에 크롤링 결과 컬럼 추가
-- crawl_status: 'pending' → 크롤 대기 | 'done' → 완료 | 'failed' → 실패 | 'skip' → 스킵(YouTube 등)

ALTER TABLE content_items
  ADD COLUMN full_text   TEXT,
  ADD COLUMN word_count  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN crawl_status TEXT    NOT NULL DEFAULT 'pending',
  ADD COLUMN crawled_at  TIMESTAMPTZ;

-- pending 항목 배치 조회용
CREATE INDEX idx_content_items_crawl_status
  ON content_items(crawl_status, first_seen_at DESC)
  WHERE crawl_status = 'pending';

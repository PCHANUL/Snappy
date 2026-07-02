-- Notion API 요청을 함수 간에 조율하고, 페이지 생성과 분석을 FIFO로 연결한다.

CREATE TABLE notion_api_rate_limits (
  limiter_key     TEXT        PRIMARY KEY,
  next_request_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE notion_api_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION reserve_notion_api_request(
  p_limiter_key TEXT,
  p_interval_ms INTEGER DEFAULT 500
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot_at TIMESTAMPTZ;
  v_wait_ms INTEGER;
BEGIN
  IF p_limiter_key IS NULL OR p_limiter_key = '' THEN
    RAISE EXCEPTION 'limiter key is required';
  END IF;
  IF p_interval_ms < 1 THEN
    RAISE EXCEPTION 'interval must be positive';
  END IF;

  INSERT INTO notion_api_rate_limits (limiter_key)
  VALUES (p_limiter_key)
  ON CONFLICT (limiter_key) DO NOTHING;

  SELECT GREATEST(next_request_at, clock_timestamp())
  INTO v_slot_at
  FROM notion_api_rate_limits
  WHERE limiter_key = p_limiter_key
  FOR UPDATE;

  UPDATE notion_api_rate_limits
  SET
    next_request_at = v_slot_at +
      make_interval(secs => p_interval_ms::DOUBLE PRECISION / 1000),
    updated_at = clock_timestamp()
  WHERE limiter_key = p_limiter_key;

  v_wait_ms := CEIL(
    GREATEST(
      EXTRACT(EPOCH FROM (v_slot_at - clock_timestamp())) * 1000,
      0
    )
  );
  RETURN v_wait_ms;
END;
$$;

REVOKE ALL ON FUNCTION reserve_notion_api_request(TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reserve_notion_api_request(TEXT, INTEGER)
  TO service_role;

CREATE TABLE content_analysis_jobs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  keyword         TEXT        NOT NULL,
  analysis_props  JSONB       NOT NULL DEFAULT '[]',
  status_block_id TEXT,
  total           INTEGER     NOT NULL CHECK (total >= 0),
  enqueued         INTEGER     NOT NULL DEFAULT 0 CHECK (enqueued >= 0),
  completed        INTEGER     NOT NULL DEFAULT 0 CHECK (completed >= 0),
  failed           INTEGER     NOT NULL DEFAULT 0 CHECK (failed >= 0),
  worker_active   BOOLEAN     NOT NULL DEFAULT FALSE,
  status          TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'cancelled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE content_analysis_job_items (
  id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id      UUID        NOT NULL
    REFERENCES content_analysis_jobs(id) ON DELETE CASCADE,
  position    INTEGER     NOT NULL CHECK (position > 0),
  row_data    JSONB       NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done')),
  attempts    INTEGER     NOT NULL DEFAULT 0,
  claimed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, position)
);

CREATE INDEX idx_content_analysis_job_items_pending
  ON content_analysis_job_items(job_id, status, position);

ALTER TABLE content_analysis_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_analysis_job_items ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION enqueue_content_analysis_rows(
  p_job_id UUID,
  p_rows JSONB,
  p_start_position INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job content_analysis_jobs%ROWTYPE;
  v_inserted INTEGER := 0;
  v_should_start BOOLEAN := FALSE;
BEGIN
  SELECT *
  INTO v_job
  FROM content_analysis_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND OR v_job.status IN ('completed', 'cancelled') THEN
    RETURN FALSE;
  END IF;

  INSERT INTO content_analysis_job_items (job_id, position, row_data)
  SELECT
    p_job_id,
    p_start_position + ordinal::INTEGER - 1,
    row_value
  FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS items(row_value, ordinal)
  ON CONFLICT (job_id, position) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF NOT v_job.worker_active AND v_inserted > 0 THEN
    v_should_start := TRUE;
  END IF;

  UPDATE content_analysis_jobs
  SET
    enqueued = enqueued + v_inserted,
    worker_active = worker_active OR v_should_start,
    status = CASE WHEN v_inserted > 0 THEN 'running' ELSE status END,
    updated_at = NOW()
  WHERE id = p_job_id;

  RETURN v_should_start;
END;
$$;

CREATE OR REPLACE FUNCTION claim_content_analysis_rows(
  p_job_id UUID,
  p_limit INTEGER DEFAULT 3
)
RETURNS TABLE(id BIGINT, row_data JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT item.id
    FROM content_analysis_job_items AS item
    WHERE item.job_id = p_job_id
      AND (
        item.status = 'pending'
        OR (
          item.status = 'processing'
          AND item.claimed_at < NOW() - INTERVAL '5 minutes'
        )
      )
    ORDER BY item.position
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE content_analysis_job_items AS item
  SET
    status = 'processing',
    attempts = item.attempts + 1,
    claimed_at = NOW(),
    updated_at = NOW()
  FROM candidates
  WHERE item.id = candidates.id
  RETURNING item.id, item.row_data;
END;
$$;

CREATE OR REPLACE FUNCTION complete_content_analysis_rows(
  p_job_id UUID,
  p_item_ids BIGINT[],
  p_failed INTEGER DEFAULT 0
)
RETURNS TABLE(
  completed INTEGER,
  total INTEGER,
  failed INTEGER,
  status_block_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_completed INTEGER := 0;
BEGIN
  UPDATE content_analysis_job_items
  SET status = 'done', updated_at = NOW()
  WHERE job_id = p_job_id
    AND id = ANY(p_item_ids)
    AND status <> 'done';

  GET DIAGNOSTICS v_completed = ROW_COUNT;

  RETURN QUERY
  UPDATE content_analysis_jobs AS job
  SET
    completed = job.completed + v_completed,
    failed = job.failed + LEAST(p_failed, v_completed),
    updated_at = NOW()
  WHERE job.id = p_job_id
  RETURNING job.completed, job.total, job.failed, job.status_block_id;
END;
$$;

CREATE OR REPLACE FUNCTION continue_content_analysis_job(p_job_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job content_analysis_jobs%ROWTYPE;
  v_has_pending BOOLEAN;
BEGIN
  SELECT *
  INTO v_job
  FROM content_analysis_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND OR v_job.status = 'cancelled' THEN
    RETURN FALSE;
  END IF;

  IF v_job.completed >= v_job.total THEN
    UPDATE content_analysis_jobs
    SET worker_active = FALSE, status = 'completed', updated_at = NOW()
    WHERE id = p_job_id;
    RETURN FALSE;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM content_analysis_job_items
    WHERE job_id = p_job_id
      AND (
        status = 'pending'
        OR (status = 'processing' AND claimed_at < NOW() - INTERVAL '5 minutes')
      )
  )
  INTO v_has_pending;

  IF v_has_pending THEN
    RETURN TRUE;
  END IF;

  UPDATE content_analysis_jobs
  SET worker_active = FALSE, updated_at = NOW()
  WHERE id = p_job_id;
  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION enqueue_content_analysis_rows(UUID, JSONB, INTEGER)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_content_analysis_rows(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_content_analysis_rows(UUID, BIGINT[], INTEGER)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION continue_content_analysis_job(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION enqueue_content_analysis_rows(UUID, JSONB, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION claim_content_analysis_rows(UUID, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION complete_content_analysis_rows(UUID, BIGINT[], INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION continue_content_analysis_job(UUID)
  TO service_role;

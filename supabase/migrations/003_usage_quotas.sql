-- 일별 사용량 추적
-- 사용자별 + 날짜별 검색 횟수 (한도 체크용)

CREATE TABLE IF NOT EXISTS usage_quotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,

  search_count INT NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- 한 사용자는 하루에 한 행만
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_usage_quotas_user_date
  ON usage_quotas(user_id, date DESC);

-- updated_at 자동 갱신
DROP TRIGGER IF EXISTS update_usage_quotas_updated_at ON usage_quotas;
CREATE TRIGGER update_usage_quotas_updated_at
  BEFORE UPDATE ON usage_quotas
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 사용량 증가 RPC 함수
-- INSERT ... ON CONFLICT로 원자적 카운팅
CREATE OR REPLACE FUNCTION increment_search_count(
  p_user_id UUID,
  p_date DATE
) RETURNS INT AS $$
DECLARE
  new_count INT;
BEGIN
  INSERT INTO usage_quotas (user_id, date, search_count)
  VALUES (p_user_id, p_date, 1)
  ON CONFLICT (user_id, date)
  DO UPDATE SET
    search_count = usage_quotas.search_count + 1,
    updated_at = NOW()
  RETURNING search_count INTO new_count;

  RETURN new_count;
END;
$$ LANGUAGE plpgsql;

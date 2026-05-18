-- 사용자 테이블
-- 노션 API 키는 Edge Function에서 암호화한 문자열만 저장한다.

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- 구독 정보
  subscription_tier TEXT NOT NULL DEFAULT 'free'
    CHECK (subscription_tier IN ('free', 'light', 'standard', 'premium')),
  subscription_expires_at TIMESTAMPTZ,

  -- 노션 연동
  notion_api_key_encrypted TEXT,
  notion_database_id TEXT,
  notion_workspace_id TEXT
);

-- 이메일 인덱스 (가입 시 중복 체크)
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

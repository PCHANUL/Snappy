-- Notion OAuth로 식별된 사용자 고유 ID 저장
-- owner.user.id 기준으로 계정을 찾거나 생성할 때 사용

ALTER TABLE users ADD COLUMN notion_user_id TEXT UNIQUE;

CREATE INDEX idx_users_notion_user_id ON users(notion_user_id)
  WHERE notion_user_id IS NOT NULL;

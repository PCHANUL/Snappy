-- 유저별 검색 진행 중 상태 추적
-- searching_since: NULL이면 대기, 값이 있으면 해당 시각부터 검색 중
-- 3분 초과 시 자동으로 stale 처리 (서버가 죽은 경우 대비)

ALTER TABLE users ADD COLUMN searching_since TIMESTAMPTZ;

CREATE INDEX idx_users_searching ON users(searching_since)
  WHERE searching_since IS NOT NULL;

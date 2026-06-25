-- 진행 중인 검색의 협력적 취소 플래그
-- trigger-search가 주요 단계마다 확인하고, 검색 시작/종료 시 초기화됨

ALTER TABLE users ADD COLUMN search_cancel_requested_at TIMESTAMPTZ;

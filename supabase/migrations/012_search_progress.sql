-- 검색 단계별 진행 메시지 — 폴링 응답에 포함되어 임베드 UI에 표시됨
-- searching_since가 NULL이 되면(완료/실패) 함께 초기화됨

ALTER TABLE users ADD COLUMN search_progress TEXT;

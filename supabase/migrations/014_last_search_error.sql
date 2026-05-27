-- 검색 실패 시 사용자에게 표시할 에러 메시지
-- 검색이 끝났는데(searching=false) 결과가 실패인 경우 폴링이 이 값을 읽어 표시
-- markSearchingStart에서 초기화됨

ALTER TABLE users ADD COLUMN last_search_error TEXT;

-- 검색 완료 후 연관 인기 키워드 목록 (JSON 배열)
-- trigger-search에서 DataLab 랭킹 후 저장, get-search-status 폴링이 읽어 search.html에 반환
-- markSearchingStart에서 초기화됨

ALTER TABLE users ADD COLUMN last_related_keywords JSONB;

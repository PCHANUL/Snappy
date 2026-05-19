-- Row Level Security
-- Edge Function은 service_role key로 접근하므로 RLS를 우회하지만,
-- anon key 또는 authenticated key로 직접 DB 접근하는 경우를 차단한다.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_quotas ENABLE ROW LEVEL SECURITY;

-- 명시적 정책 없음 = service_role만 접근 가능 (anon/authenticated 전면 차단)
-- 추후 사용자 직접 인증 도입 시 아래 패턴으로 정책 추가:
--
-- CREATE POLICY "users_own_row" ON users
--   FOR ALL TO authenticated
--   USING (id = auth.uid());

// 테스트 전 필수 환경 변수 설정 (dummy 값)
// 이 파일을 각 테스트 파일의 첫 번째 import로 사용하면
// ES 모듈 평가 순서에 따라 env.ts 보다 먼저 실행됩니다.

Deno.env.set('SUPABASE_URL', 'https://test.supabase.co');
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
Deno.env.set('NAVER_CLIENT_ID', 'test-naver-id');
Deno.env.set('NAVER_CLIENT_SECRET', 'test-naver-secret');
Deno.env.set('YOUTUBE_API_KEY', 'test-youtube-key');
Deno.env.set('YOUCOM_API_KEY', 'test-youcom-key');
Deno.env.set('NOTION_KEY_ENCRYPTION_SECRET', 'test-secret-32-chars-long-abcdefg');

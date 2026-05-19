// 정적 HTML 페이지 서빙 Edge Function
// GET /functions/v1/pages?page=signup   → 가입 페이지
// GET /functions/v1/pages?page=setup    → 노션 연동 페이지
// GET /functions/v1/pages               → 가입 페이지 (기본값)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const encoder = new TextEncoder();

function htmlResponse(html: string): Response {
  return new Response(encoder.encode(html), {
    status: 200,
    headers: new Headers({
      'Content-Type': 'text/html; charset=utf-8',
    }),
  });
}

serve((req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: new Headers({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      }),
    });
  }

  if (req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const url = new URL(req.url);
  const page = url.searchParams.get('page') ?? 'signup';

  switch (page) {
    case 'setup':
      return htmlResponse(renderSetupPage());
    case 'signup':
    default:
      return htmlResponse(renderSignupPage());
  }
});

// ─── 가입 페이지 ─────────────────────────────────────────────
function renderSignupPage(): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Snappy — 트렌드 콘텐츠 발견기</title>
  ${commonStyles()}
</head>
<body>
  <div class="container">
    <header>
      <h1>⚡ Snappy</h1>
      <p class="subtitle">유튜브·블로그·뉴스의 트렌드를 노션으로 자동 수집</p>
    </header>

    <div class="card">
      <h2>무료로 시작하기</h2>
      <form id="signupForm">
        <div class="field">
          <label for="email">이메일</label>
          <input type="email" id="email" placeholder="you@example.com" required>
        </div>
        <button type="submit" class="btn-primary" id="submitBtn">
          가입하기
        </button>
      </form>
      <div id="result" class="message hidden"></div>
    </div>

    <p class="hint">가입 후 노션 API 키를 연동하면 바로 사용할 수 있어요.</p>
  </div>

  <script>
    const FUNCTION_BASE = location.origin.replace('/functions/v1/pages', '') + '/functions/v1';

    document.getElementById('signupForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('submitBtn');
      const result = document.getElementById('result');
      const email = document.getElementById('email').value.trim();

      btn.disabled = true;
      btn.textContent = '처리 중...';
      result.className = 'message hidden';

      try {
        const res = await fetch(FUNCTION_BASE + '/manage-user?action=signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.message || '가입에 실패했습니다.');
        }

        result.className = 'message success';
        result.innerHTML = \`
          <strong>가입 완료!</strong><br>
          user_id: <code>\${data.user_id}</code><br>
          <a href="?page=setup&user_id=\${data.user_id}">노션 연동하러 가기 →</a>
        \`;
        document.getElementById('signupForm').reset();
      } catch (err) {
        result.className = 'message error';
        result.textContent = err.message;
      } finally {
        btn.disabled = false;
        btn.textContent = '가입하기';
      }
    });
  </script>
</body>
</html>`;
}

// ─── 노션 연동 페이지 ────────────────────────────────────────
function renderSetupPage(): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Snappy — 노션 연동</title>
  ${commonStyles()}
</head>
<body>
  <div class="container">
    <header>
      <h1>⚡ Snappy</h1>
      <p class="subtitle">노션 API 키를 연동해주세요</p>
    </header>

    <div class="card">
      <h2>노션 연동</h2>
      <form id="setupForm">
        <div class="field">
          <label for="userId">User ID</label>
          <input type="text" id="userId" placeholder="가입 후 받은 user_id" required>
        </div>
        <div class="field">
          <label for="notionKey">노션 API 키</label>
          <input type="password" id="notionKey" placeholder="secret_..." required>
          <span class="hint-inline">
            <a href="https://www.notion.so/my-integrations" target="_blank">노션 통합 페이지</a>에서 발급
          </span>
        </div>
        <div class="field">
          <label for="dbId">노션 데이터베이스 ID</label>
          <input type="text" id="dbId" placeholder="32자리 UUID" required>
        </div>
        <button type="submit" class="btn-primary" id="setupBtn">
          연동하기
        </button>
      </form>
      <div id="result" class="message hidden"></div>
    </div>
  </div>

  <script>
    const FUNCTION_BASE = location.origin.replace('/functions/v1/pages', '') + '/functions/v1';

    // URL 파라미터에서 user_id 자동 채우기
    const params = new URLSearchParams(location.search);
    if (params.get('user_id')) {
      document.getElementById('userId').value = params.get('user_id');
    }

    document.getElementById('setupForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('setupBtn');
      const result = document.getElementById('result');

      btn.disabled = true;
      btn.textContent = '처리 중...';
      result.className = 'message hidden';

      try {
        const res = await fetch(FUNCTION_BASE + '/manage-user?action=setup-notion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: document.getElementById('userId').value.trim(),
            notion_api_key: document.getElementById('notionKey').value.trim(),
            notion_database_id: document.getElementById('dbId').value.trim(),
          }),
        });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.message || '연동에 실패했습니다.');
        }

        result.className = 'message success';
        result.textContent = '노션 연동이 완료됐습니다! 이제 노션 자동화를 설정해주세요.';
      } catch (err) {
        result.className = 'message error';
        result.textContent = err.message;
      } finally {
        btn.disabled = false;
        btn.textContent = '연동하기';
      }
    });
  </script>
</body>
</html>`;
}

// ─── 공통 스타일 ─────────────────────────────────────────────
function commonStyles(): string {
  return `<style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f5f5f5;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #1a1a1a;
    }
    .container { width: 100%; max-width: 440px; padding: 24px; }
    header { text-align: center; margin-bottom: 32px; }
    h1 { font-size: 2rem; font-weight: 800; letter-spacing: -0.5px; }
    .subtitle { margin-top: 8px; color: #666; font-size: 0.95rem; }
    .card {
      background: #fff;
      border-radius: 16px;
      padding: 32px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
    }
    h2 { font-size: 1.25rem; font-weight: 700; margin-bottom: 24px; }
    .field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
    label { font-size: 0.875rem; font-weight: 600; color: #333; }
    input {
      padding: 10px 14px;
      border: 1.5px solid #e0e0e0;
      border-radius: 8px;
      font-size: 0.95rem;
      outline: none;
      transition: border-color 0.15s;
    }
    input:focus { border-color: #6366f1; }
    .hint-inline { font-size: 0.8rem; color: #888; }
    .hint-inline a { color: #6366f1; text-decoration: none; }
    .btn-primary {
      width: 100%;
      padding: 12px;
      background: #6366f1;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      margin-top: 8px;
      transition: background 0.15s;
    }
    .btn-primary:hover { background: #4f46e5; }
    .btn-primary:disabled { background: #a5b4fc; cursor: not-allowed; }
    .message {
      margin-top: 16px;
      padding: 12px 14px;
      border-radius: 8px;
      font-size: 0.9rem;
      line-height: 1.5;
    }
    .message.success { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
    .message.error   { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
    .message.hidden  { display: none; }
    .message code    { background: #e0e7ff; padding: 2px 6px; border-radius: 4px; font-size: 0.85rem; }
    .message a       { color: #4f46e5; font-weight: 600; }
    .hint { text-align: center; margin-top: 20px; font-size: 0.85rem; color: #999; }
  </style>`;
}

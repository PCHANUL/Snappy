// pages function → GitHub Pages 리다이렉트
// docs/index.html이 GitHub Pages에 배포되면서 이 함수는 리다이렉트 역할만 담당

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const PAGES_BASE = 'https://pchanul.github.io/Snappy';

serve((req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      },
    });
  }

  const url = new URL(req.url);
  const userId = url.searchParams.get('user_id');

  // user_id 파라미터가 있으면 setup 페이지로, 없으면 홈으로
  const target = userId
    ? `${PAGES_BASE}/?user_id=${encodeURIComponent(userId)}`
    : `${PAGES_BASE}/`;

  return Response.redirect(target, 301);
});

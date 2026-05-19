#!/usr/bin/env node
// 트렌드 콘텐츠 발견기 — 노션 템플릿 자동 생성
//
// 사용법:
//   node scripts/create-notion-template.js <parent-page-id>
//
// 준비:
//   .env.local에 NOTION_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY 필요
//   NOTION_TEMPLATE_PARENT_PAGE_ID 로도 지정 가능
//
// 수동 작업 (스크립트 완료 후):
//   1. 검색 DB에 "🚀 검색 실행" 버튼 속성 추가 + 자동화 설정
//   2. DB 뷰 3개 생성 (전체/최근/진행중)
//   3. 메인 페이지 커버 이미지 추가

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// .env.local 파싱
function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv(path.join(ROOT, '.env.local'));

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const PARENT_PAGE_ID = (process.argv[2] || process.env.NOTION_TEMPLATE_PARENT_PAGE_ID || '').replace(/-/g, '');
const SUPABASE_URL   = process.env.SUPABASE_URL || '';
const SUPABASE_ANON  = process.env.SUPABASE_ANON_KEY || '';
const PAGES_BASE     = (process.env.GITHUB_PAGES_URL || 'https://pchanul.github.io/Snappy/').replace(/\/+$/, '');
const SETUP_URL      = `${PAGES_BASE}/`;
const USAGE_URL      = `${PAGES_BASE}/usage.html`;

if (!NOTION_API_KEY) {
  console.error('❌  NOTION_API_KEY 가 없습니다. .env.local 에 추가하세요.');
  process.exit(1);
}
if (!PARENT_PAGE_ID) {
  console.error('❌  부모 페이지 ID가 필요합니다.');
  console.error('    사용법: node scripts/create-notion-template.js <page-id>');
  console.error('    또는 .env.local 에 NOTION_TEMPLATE_PARENT_PAGE_ID=... 추가');
  process.exit(1);
}

// ── Notion API ──────────────────────────────────────────────────────────────

async function notion(method, path, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Notion ${method} ${path} → ${JSON.stringify(json)}`);
  return json;
}

async function appendBlocks(pageId, blocks) {
  for (let i = 0; i < blocks.length; i += 100) {
    await notion('PATCH', `/blocks/${pageId}/children`, { children: blocks.slice(i, i + 100) });
    if (i + 100 < blocks.length) await sleep(400);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── 블록 빌더 ───────────────────────────────────────────────────────────────

const rich = (text, opts = {}) => [{
  type: 'text',
  text: { content: text, link: opts.link ? { url: opts.link } : null },
  annotations: {
    bold: !!opts.bold,
    code: !!opts.code,
    color: opts.color || 'default',
  },
}];

const b = {
  h1:      (t)        => ({ type: 'heading_1',           heading_1:           { rich_text: rich(t) } }),
  h2:      (t)        => ({ type: 'heading_2',           heading_2:           { rich_text: rich(t) } }),
  p:       (t = '')   => ({ type: 'paragraph',           paragraph:           { rich_text: t ? rich(t) : [] } }),
  divider: ()         => ({ type: 'divider',             divider:             {} }),
  embed:   (url)      => ({ type: 'embed',               embed:               { url } }),
  bullet:  (t)        => ({ type: 'bulleted_list_item',  bulleted_list_item:  { rich_text: rich(t) } }),
  num:     (t)        => ({ type: 'numbered_list_item',  numbered_list_item:  { rich_text: rich(t) } }),
  callout: (t, emoji) => ({
    type: 'callout',
    callout: { rich_text: rich(t), icon: { type: 'emoji', emoji }, color: 'gray_background' },
  }),
  toggle: (title, children = []) => ({
    type: 'toggle',
    toggle: { rich_text: rich(title), children },
  }),
};

// ── 페이지 생성 ─────────────────────────────────────────────────────────────

async function createPage(parentId, title, emoji) {
  return notion('POST', '/pages', {
    parent:     { page_id: parentId },
    icon:       { type: 'emoji', emoji },
    properties: { title: { title: rich(title) } },
  });
}

// ── 검색 DB 생성 ────────────────────────────────────────────────────────────

async function createSearchDB(parentPageId) {
  return notion('POST', '/databases', {
    parent:    { page_id: parentPageId },
    is_inline: true,
    icon:      { type: 'emoji', emoji: '🔍' },
    title:     rich('검색 DB'),
    properties: {
      '키워드':       { title: {} },
      '매체':         { multi_select: { options: [
        { name: '네이버블로그', color: 'green'  },
        { name: '유튜브',       color: 'red'    },
        { name: '티스토리',     color: 'orange' },
        { name: '브런치',       color: 'brown'  },
      ]}},
      '기간':         { select: { options: [
        { name: '1일',   color: 'gray'   },
        { name: '1주',   color: 'blue'   },
        { name: '1개월', color: 'purple' },
        { name: '1년',   color: 'pink'   },
      ]}},
      '결과 개수':    { select: { options: [
        { name: '5',  color: 'gray'  },
        { name: '10', color: 'blue'  },
        { name: '20', color: 'green' },
      ]}},
      '상태':         { status: {} },
      '발견 콘텐츠 수': { number: { format: 'number' } },
      '검색일시':     { created_time: {} },
      'user_id':      { rich_text: {} },
    },
  });
}

// ── 각 페이지 콘텐츠 ────────────────────────────────────────────────────────

function blocksMain() {
  return [
    b.p('키워드 하나로 매체별 인기 콘텐츠를 30초 만에 발견합니다.'),
    b.divider(),
    b.callout('처음이신가요? 시작하기 페이지에서 2분만 셋업하면 바로 사용할 수 있습니다.', '💡'),
    b.divider(),
    b.h2('🗂 페이지'),
    b.p('📖 시작하기 — 처음 사용하는 경우 여기부터'),
    b.p('🔍 검색 — 키워드로 트렌드 콘텐츠 찾기'),
    b.p('❓ 자주 묻는 질문 — 궁금한 점이 있다면'),
    b.p('⚙️ 설정 — 사용량 확인 및 계정 관리'),
  ];
}

function blocksSijak() {
  return [
    b.h1('2분이면 시작할 수 있어요'),
    b.p('아래 셋업 마법사를 따라가시면 모든 준비가 끝납니다.\n이메일 가입 → 노션 연동 → 검색 시작, 이 순서로 진행됩니다.'),
    b.divider(),
    b.h2('🚀 셋업 마법사'),
    b.embed(SETUP_URL),
    b.divider(),
    b.h2('📌 셋업 완료하셨나요?'),
    b.callout('완료하셨다면 검색 페이지로 이동해 첫 검색을 시작해보세요.', '✅'),
    b.divider(),
    b.h2('🤔 셋업 중 막히는 부분이 있나요?'),
    b.toggle('API 키를 어디서 받나요?', [
      b.num('notion.so/my-integrations 접속'),
      b.num('"새 통합" 버튼 클릭'),
      b.num('통합 이름 입력 (예: 트렌드 발견기)'),
      b.num('워크스페이스 선택 → 제출'),
      b.num('"내부 통합 시크릿" 복사 → 셋업 마법사에 붙여넣기'),
    ]),
    b.toggle('데이터베이스 목록에 검색 DB가 안 보여요', [
      b.p('방금 만든 통합이 검색 DB 페이지에 연결되지 않았습니다.'),
      b.num('🔍 검색 페이지 열기'),
      b.num('오른쪽 상단 "..." → 연결 → 연결 추가'),
      b.num('만든 통합 선택'),
      b.num('셋업 마법사로 돌아가 재시도'),
    ]),
    b.toggle('검색 버튼을 눌렀는데 반응이 없어요', [
      b.bullet('설정 페이지에서 user_id가 입력되어 있는지 확인'),
      b.bullet('키워드와 매체가 선택되어 있는지 확인'),
      b.bullet('그래도 안 된다면 ❓ 자주 묻는 질문 참고'),
    ]),
  ];
}

function blocksGeomseok() {
  return [
    b.callout('새 검색을 시작하려면 "+ 새로 만들기" 클릭 → 키워드 입력 → 🚀 검색 실행\n검색 결과는 약 10초 내에 자동으로 나타납니다.', '🎯'),
    b.divider(),
    b.h2('DB 속성 안내'),
    b.bullet('키워드: 검색할 단어 (예: 비건 디저트)'),
    b.bullet('매체: 네이버블로그 / 유튜브 / 티스토리 / 브런치 (복수 선택 가능)'),
    b.bullet('기간: 1일 / 1주 / 1개월(기본) / 1년'),
    b.bullet('결과 개수: 5 / 10(기본) / 20'),
    b.bullet('상태: 대기 → 검색중 → 완료 / 실패 (자동 변경)'),
    b.bullet('user_id: 셋업 완료 후 받은 ID — 새 행 추가 시 기본값으로 설정해두세요'),
    b.divider(),
    b.h2('매체 → API 값 매핑'),
    b.p('버튼 자동화 HTTP 요청 Body 작성 시 아래 영어값을 사용합니다.'),
    b.bullet('네이버블로그 → naver_blog'),
    b.bullet('유튜브 → youtube'),
    b.bullet('티스토리 → tistory'),
    b.bullet('브런치 → brunch'),
    b.p(''),
    b.bullet('1일 → day   /   1주 → week   /   1개월 → month   /   1년 → year'),
  ];
}

function blocksFaq() {
  return [
    b.h1('자주 묻는 질문'),
    b.divider(),
    b.h2('사용법'),
    b.toggle('검색 결과는 얼마나 정확한가요?', [
      b.p('각 매체의 공식 검색 API를 사용해 가져오기 때문에 매체 자체의 정확도와 동일합니다.'),
      b.bullet('네이버 블로그: 네이버 검색 API'),
      b.bullet('유튜브: YouTube Data API (공식)'),
      b.bullet('티스토리/브런치: 검색 결과 큐레이션'),
    ]),
    b.toggle('같은 키워드를 여러 번 검색하면 결과가 달라지나요?', [
      b.p('네, 시간이 지나면 새 콘텐츠가 등장하기 때문에 결과가 달라집니다.\n주 1회 같은 키워드를 검색하면 트렌드 변화를 추적할 수 있습니다.'),
    ]),
    b.toggle('인스타그램은 왜 없나요?', [
      b.p('인스타그램은 외부 API 접근이 거의 차단되어 있어 정상적인 검색이 어렵습니다.'),
    ]),
    b.toggle('검색 한 번에 시간이 얼마나 걸리나요?', [
      b.p('보통 5~10초 정도 소요됩니다. 매체를 많이 선택할수록 약간 더 걸릴 수 있습니다.'),
    ]),
    b.divider(),
    b.h2('요금제'),
    b.toggle('무료로 사용할 수 있나요?', [
      b.p('베타 기간(~2026년 7월)에는 무료로 사용 가능합니다. 일 3회 검색까지 제공됩니다.'),
    ]),
    b.toggle('일일 검색 한도가 있나요?', [
      b.bullet('무료 (베타): 3회'),
      b.bullet('라이트 (월 9,900원): 5회'),
      b.bullet('스탠다드 (월 19,900원): 20회'),
      b.bullet('프리미엄 (월 39,900원): 60회'),
    ]),
    b.toggle('결제는 어떻게 하나요?', [
      b.p('정식 출시 시점(~2026년 7월)에 결제 시스템이 추가됩니다.\n베타 사용자에게는 출시 시 50% 평생 할인이 제공됩니다.'),
    ]),
    b.divider(),
    b.h2('문제 해결'),
    b.toggle('검색이 "실패" 상태로 끝났어요', [
      b.bullet('일일 사용량 초과 (설정 페이지에서 확인)'),
      b.bullet('노션 API 키 만료'),
      b.bullet('일시적인 서버 문제'),
      b.p('문제가 지속되면 support@example.com 으로 연락주세요.'),
    ]),
    b.toggle('검색 결과가 너무 적게 나와요', [
      b.bullet('기간을 더 길게 설정 (1개월 → 1년)'),
      b.bullet('키워드를 더 일반적으로 변경'),
      b.bullet('다른 매체도 함께 선택'),
    ]),
    b.toggle('노션이 너무 느려요', [
      b.p('검색 결과가 누적되면 페이지가 느려질 수 있습니다.'),
      b.bullet('30일 이상된 검색 결과는 정기적으로 보관 처리 권장'),
      b.bullet('뷰에 "검색일시 = 지난 30일" 필터 적용'),
    ]),
    b.divider(),
    b.h2('보안 및 개인정보'),
    b.toggle('제 노션 데이터를 볼 수 있나요?', [
      b.p('사용자가 등록한 노션 데이터베이스에만 접근 가능하며, 검색 결과를 저장하는 용도로만 사용됩니다.'),
    ]),
    b.toggle('API 키는 안전한가요?', [
      b.p('모든 API 키는 암호화되어 저장됩니다. 노션에서 통합을 삭제하면 즉시 접근이 차단됩니다.'),
    ]),
    b.divider(),
    b.callout('다른 질문이 있으시면 support@example.com 으로 연락주세요.\n평일 24시간 내에 답변드립니다.', '📧'),
  ];
}

function blocksSeoljeong() {
  const webhookUrl = `${SUPABASE_URL}/functions/v1/trigger-search`;
  return [
    b.h1('설정'),
    b.divider(),
    b.h2('계정 정보'),
    b.callout('사용자 ID (user_id)\n\n셋업 완료 후 여기에 user_id를 붙여넣으세요.\n이 값은 검색 버튼 자동화에 사용됩니다.', '🔑'),
    b.divider(),
    b.h2('사용량'),
    b.embed(`${USAGE_URL}?user_id=YOUR_USER_ID`),
    b.p('※ 위 URL의 YOUR_USER_ID 부분을 실제 user_id로 교체하세요.'),
    b.divider(),
    b.h2('연동 정보'),
    b.toggle('노션 연동 다시 설정', [
      b.p('다음 경우에 다시 설정이 필요합니다:'),
      b.bullet('노션 API 키를 변경했을 때'),
      b.bullet('다른 데이터베이스로 변경하고 싶을 때'),
      b.p('→ 시작하기 페이지의 셋업 마법사 다시 실행'),
    ]),
    b.toggle('연동 해제', [
      b.num('노션 my-integrations 페이지 접속'),
      b.num('만든 통합 선택 → 삭제'),
      b.p('연동 해제 후에는 검색이 동작하지 않습니다.'),
    ]),
    b.divider(),
    b.h2('검색 버튼 자동화 설정값'),
    b.callout([
      '검색 DB의 🚀 버튼 속성 → 자동화 추가 → HTTP 요청에 아래 값을 입력하세요.',
      '',
      `URL: ${webhookUrl}`,
      'Method: POST',
      `Authorization: Bearer ${SUPABASE_ANON || 'YOUR_SUPABASE_ANON_KEY'}`,
      `apikey: ${SUPABASE_ANON || 'YOUR_SUPABASE_ANON_KEY'}`,
      'Content-Type: application/json',
    ].join('\n'), '⚙️'),
    b.h2('웹훅 Body (JSON)'),
    b.callout([
      '아래 JSON을 HTTP 요청 Body에 붙여넣으세요.',
      '{{...}} 값은 노션이 현재 행의 속성값으로 자동 치환합니다.',
      '',
      '{',
      '  "user_id": "{{user_id}}",',
      '  "notion_page_id": "{{현재 페이지 ID}}",',
      '  "keyword": "{{키워드}}",',
      '  "platforms": ["{{매체}}"],',
      '  "period": "{{기간}}",',
      '  "result_count": {{결과 개수}}',
      '}',
      '',
      '※ 매체·기간 값은 검색 페이지의 "매체 → API 값 매핑" 참고',
    ].join('\n'), '📋'),
    b.divider(),
    b.h2('플랜'),
    b.callout('현재 플랜: 베타 무료\n일일 한도: 3회', '📊'),
    b.divider(),
    b.h2('도움말'),
    b.bullet('이메일: support@example.com'),
  ];
}

// ── 메인 ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀 트렌드 콘텐츠 발견기 노션 템플릿 생성 시작\n');

  // 1. 메인 페이지
  process.stdout.write('📘 메인 페이지 생성 중...');
  const mainPage = await createPage(PARENT_PAGE_ID, '트렌드 콘텐츠 발견기', '📘');
  await appendBlocks(mainPage.id, blocksMain());
  console.log(` ✅  ${mainPage.url}`);

  await sleep(300);

  // 2. 시작하기 페이지
  process.stdout.write('📖 시작하기 페이지 생성 중...');
  const sijakPage = await createPage(mainPage.id, '시작하기', '📖');
  await appendBlocks(sijakPage.id, blocksSijak());
  console.log(` ✅`);

  await sleep(300);

  // 3. 검색 페이지 + DB
  process.stdout.write('🔍 검색 페이지 생성 중...');
  const geomseokPage = await createPage(mainPage.id, '검색', '🔍');
  await appendBlocks(geomseokPage.id, blocksGeomseok());
  console.log(` ✅`);

  process.stdout.write('   검색 DB 생성 중...');
  const db = await createSearchDB(geomseokPage.id);
  console.log(` ✅  DB ID: ${db.id}`);

  await sleep(300);

  // 4. FAQ 페이지
  process.stdout.write('❓ FAQ 페이지 생성 중...');
  const faqPage = await createPage(mainPage.id, '자주 묻는 질문', '❓');
  await appendBlocks(faqPage.id, blocksFaq());
  console.log(` ✅`);

  await sleep(300);

  // 5. 설정 페이지
  process.stdout.write('⚙️  설정 페이지 생성 중...');
  const seoljeongPage = await createPage(mainPage.id, '설정', '⚙️');
  await appendBlocks(seoljeongPage.id, blocksSeoljeong());
  console.log(` ✅`);

  // 완료
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅  템플릿 생성 완료!
${mainPage.url}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 남은 수동 작업 (노션에서 직접):

1. 검색 DB에 "🚀 검색 실행" 버튼 속성 추가
   - 속성 추가 → 버튼
   - 자동화 → 액션 1: 상태를 "검색중"으로 변경
   - 자동화 → 액션 2: HTTP 요청 (설정 페이지 "검색 버튼 자동화 설정값" 참고)

2. 검색 DB의 user_id 속성에 기본값 설정
   - 셋업 완료 후 받은 user_id 값을 기본값으로 지정
   - 새 검색 행 추가 시 자동으로 채워짐

3. 검색 DB 뷰 3개 추가
   - 전체 (테이블, 검색일시 내림차순)
   - 최근 검색 (갤러리, 지난 7일 필터)
   - 진행 중 (보드, 상태별 그룹)

4. 설정 페이지 usage 임베드 URL에서 YOUR_USER_ID를 실제 값으로 교체

5. 메인 페이지에 커버 이미지 추가 (Unsplash → "minimal workspace")

6. 페이지 공유 → "웹에 게시" + "템플릿으로 복제 허용" 체크
`);
}

main().catch(err => {
  console.error('\n❌ 오류:', err.message);
  process.exit(1);
});

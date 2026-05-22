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
//   1. "📄 더보기" 버튼 자동화 설정 (DB에 이미 속성 추가됨)
//   2. 검색 DB user_id 속성 기본값 설정
//   3. DB 뷰 3개 생성 (전체/최근/진행중)
//   4. 메인 페이지 커버 이미지 추가

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
const SEARCH_URL     = `${PAGES_BASE}/search.html`;
const USAGE_URL      = `${PAGES_BASE}/usage.html`;
const HISTORY_URL    = `${PAGES_BASE}/history.html`;

// --user-id <value> 플래그: 임베드 URL에 user_id 자동 삽입
const userIdFlagIdx = process.argv.indexOf('--user-id');
const USER_ID = (userIdFlagIdx !== -1 ? process.argv[userIdFlagIdx + 1] : '')
  || process.env.TEMPLATE_USER_ID
  || 'YOUR_USER_ID';

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
  if (!res.ok) {
    if (json?.code === 'object_not_found') {
      throw new Error([
        `Notion ${method} ${path} → ${json.message}`,
        '',
        '확인할 것:',
        '1. 부모 페이지 ID가 맞는지 확인하세요.',
        '2. 해당 부모 페이지 우측 상단 ... → 연결(Add connections)에서 이 통합을 추가하세요.',
        '3. 개인 페이지/복제된 템플릿의 DB도 통합에 명시적으로 연결해야 API에서 보입니다.',
      ].join('\n'));
    }
    throw new Error(`Notion ${method} ${path} → ${JSON.stringify(json)}`);
  }
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
  // 링크가 포함된 눈에 띄는 callout (embed 대체)
  link: (label, url, emoji = '🔗') => ({
    type: 'callout',
    callout: {
      rich_text: [
        { type: 'text', text: { content: label + '  →  ' }, annotations: { bold: true } },
        { type: 'text', text: { content: url, link: { url } }, annotations: { bold: false, color: 'blue' } },
      ],
      icon: { type: 'emoji', emoji },
      color: 'blue_background',
    },
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
      '📄 더보기':    { button: {} },
    },
  });
}

// ── 각 페이지 콘텐츠 ────────────────────────────────────────────────────────

function blocksMain(webhookUrl, loadMoreUrl) {
  return [
    b.embed(SEARCH_URL),
    b.callout('키워드 입력 → 매체 선택 → 🚀  (기간·결과개수는 기본값 사용 가능)', '⚡'),
    b.toggle('🆕 처음이신가요?', [
      b.callout('원본 템플릿에서 바로 셋업하지 말고, 먼저 개인 워크스페이스로 복제하세요.', '📌'),
      b.num('우측 상단 "복제" 또는 Duplicate 클릭 → 개인 워크스페이스 선택'),
      b.num('셋업 마법사에서 관리자에게 받은 user_id 입력 → Notion 승인 화면에서 복제한 페이지 선택 → DB 선택'),
      b.num('셋업 마법사 마지막 단계에서 확인 버튼 클릭 → 검색 버튼 자동 연결'),
      b.link('셋업 마법사 시작하기', SETUP_URL, '🚀'),
      b.p('자세한 안내는 📖 시작하기 페이지를 참고하세요.'),
    ]),
    b.toggle('📄 더보기 버튼 설정 (최초 1회)', [
      b.callout([
        '[ 📄 더보기 버튼 ]',
        `URL: ${loadMoreUrl}`,
        'Method: POST',
        `Authorization: Bearer ${SUPABASE_ANON || 'YOUR_SUPABASE_ANON_KEY'}`,
        `apikey: ${SUPABASE_ANON || 'YOUR_SUPABASE_ANON_KEY'}`,
        'Content-Type: application/json',
      ].join('\n'), '⚙️'),
      b.callout([
        '{',
        '  "user_id": "{{user_id}}",',
        '  "notion_page_id": "{{현재 페이지 ID}}"',
        '}',
      ].join('\n'), '📋'),
      b.p('처음 5개 결과 외 추가 결과가 있을 때 클릭하면 5개씩 서브페이지가 추가됩니다.'),
    ]),
    b.divider(),
  ];
}

function blocksMainBottom() {
  return [
    b.divider(),
    b.p('📖 시작하기   ·   ❓ 자주 묻는 질문   ·   ⚙️ 설정'),
  ];
}

function blocksSijak() {
  return [
    b.h1('2분이면 시작할 수 있어요'),
    b.p('템플릿 복제 → 셋업 마법사 → 검색 시작'),
    b.divider(),
    b.h2('1. 템플릿 복제'),
    b.callout('원본 템플릿에서 바로 셋업하지 말고, 먼저 개인 워크스페이스로 복제하세요.', '📌'),
    b.num('이 템플릿 페이지 우측 상단 "복제" 또는 Duplicate 클릭'),
    b.num('사용할 개인 워크스페이스 선택'),
    b.divider(),
    b.h2('2. 셋업 마법사'),
    b.link('셋업 마법사 시작하기', SETUP_URL, '🚀'),
    b.num('관리자에게 받은 user_id 입력 후 계정 확인'),
    b.num('"Notion으로 연결하기" 클릭 → Notion 승인 화면에서 복제한 Snappy 페이지 선택'),
    b.num('목록에서 검색 DB 선택 후 완료 → 검색 버튼이 자동으로 연결됩니다'),
    b.divider(),
    b.callout('설정 완료! 메인 페이지로 돌아가 첫 검색을 시작해보세요.', '✅'),
    b.divider(),
    b.h2('🤔 막히는 부분이 있나요?'),
    b.toggle('Notion 승인 화면에서 어떤 페이지를 선택해야 하나요?', [
      b.p('복제한 Snappy 메인 페이지를 선택하면 하위 DB에 대한 접근 권한이 함께 부여됩니다.'),
      b.p('개별 DB를 선택해도 되지만, 메인 페이지를 선택하는 것이 더 편리합니다.'),
    ]),
    b.toggle('데이터베이스 목록에 검색 DB가 안 보여요', [
      b.p('Notion 승인 화면에서 복제한 Snappy 메인 페이지 또는 검색 DB를 선택했는지 확인하세요.'),
      b.num('"Notion으로 연결하기"를 다시 클릭해 연결을 재시도하세요.'),
      b.num('Notion 승인 화면에서 복제한 페이지를 선택하세요.'),
      b.p('그래도 보이지 않으면 검색 DB를 전체 페이지로 열고 URL의 32자리 ID를 직접 입력하세요.'),
    ]),
    b.toggle('검색 버튼을 눌렀는데 반응이 없어요', [
      b.bullet('셋업 마법사 마지막 단계(시작하기)에서 "확인" 버튼을 클릭했는지 확인'),
      b.bullet('키워드와 매체가 선택되어 있는지 확인'),
      b.bullet('그래도 안 된다면 ❓ 자주 묻는 질문 참고'),
    ]),
  ];
}

function blocksGeomseok() {
  return [
    b.callout('새 검색: "+ 새로 만들기" → 키워드·매체 입력 → 위 검색 버튼 클릭\n결과는 약 10초 내에 자동으로 나타납니다.', '🎯'),
    b.divider(),
    b.h2('DB 속성 안내'),
    b.bullet('키워드: 검색할 단어 (예: 비건 디저트)'),
    b.bullet('매체: 네이버블로그 / 유튜브 / 티스토리 / 브런치 (복수 선택 가능)'),
    b.bullet('기간: 1일 / 1주 / 1개월(기본) / 1년'),
    b.bullet('결과 개수: 5 / 10(기본) / 20'),
    b.bullet('상태: 대기 → 검색중 → 완료 / 실패 (자동 변경)'),
    b.bullet('user_id: 관리자에게 받은 ID — 새 행 추가 시 기본값으로 설정해두세요'),
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
      b.bullet('Notion 연결 만료 또는 권한 해제'),
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
  return [
    b.h1('설정'),
    b.divider(),
    b.h2('계정 정보'),
    b.callout('사용자 ID (user_id)\n\n관리자에게 받은 user_id입니다. 셋업 마법사에서 확인할 수 있습니다.', '🔑'),
    b.divider(),
    b.h2('사용량'),
    b.link('사용량 확인하기', `${USAGE_URL}?user_id=${USER_ID}`, '📊'),
    b.h2('검색 기록'),
    b.link('검색 기록 보기', `${HISTORY_URL}?user_id=${USER_ID}`, '📋'),
    ...(USER_ID === 'YOUR_USER_ID' ? [b.p('※ YOUR_USER_ID를 실제 user_id로 교체하거나, 스크립트 실행 시 --user-id <id> 옵션을 사용하세요.')] : []),
    b.divider(),
    b.h2('연동 정보'),
    b.toggle('노션 연동 다시 설정', [
      b.p('다음 경우에 다시 설정이 필요합니다:'),
      b.bullet('Notion 연결 권한을 다시 승인해야 할 때'),
      b.bullet('다른 데이터베이스로 변경하고 싶을 때'),
      b.p('→ 시작하기 페이지의 셋업 마법사 다시 실행'),
    ]),
    b.toggle('연동 해제', [
      b.num('노션 my-integrations 페이지 접속'),
      b.num('만든 통합 선택 → 삭제'),
      b.p('연동 해제 후에는 검색이 동작하지 않습니다.'),
    ]),
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

  const webhookUrl  = `${SUPABASE_URL}/functions/v1/trigger-search`;
  const loadMoreUrl = `${SUPABASE_URL}/functions/v1/load-more`;

  // 1. 메인 페이지 상단 블록
  process.stdout.write('📘 메인 페이지 생성 중...');
  const mainPage = await createPage(PARENT_PAGE_ID, '트렌드 콘텐츠 발견기', '📘');
  await appendBlocks(mainPage.id, blocksMain(webhookUrl, loadMoreUrl));
  console.log(` ✅  ${mainPage.url}`);

  await sleep(300);

  // 2. 검색 DB — 메인 페이지에 인라인으로 생성 (서브페이지 이동 불필요)
  process.stdout.write('🔍 검색 DB 생성 중...');
  const db = await createSearchDB(mainPage.id);
  console.log(` ✅  DB ID: ${db.id}`);

  await sleep(300);

  // 3. DB 아래 매핑 안내 블록 추가
  await appendBlocks(mainPage.id, [...blocksGeomseok(), ...blocksMainBottom()]);

  await sleep(300);

  // 4. 시작하기 서브페이지 (셋업 + 문제해결)
  process.stdout.write('📖 시작하기 페이지 생성 중...');
  const sijakPage = await createPage(mainPage.id, '시작하기', '📖');
  await appendBlocks(sijakPage.id, blocksSijak());
  console.log(` ✅`);

  await sleep(300);

  // 5. FAQ 페이지
  process.stdout.write('❓ FAQ 페이지 생성 중...');
  const faqPage = await createPage(mainPage.id, '자주 묻는 질문', '❓');
  await appendBlocks(faqPage.id, blocksFaq());
  console.log(` ✅`);

  await sleep(300);

  // 6. 설정 페이지
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

1. "📄 더보기" 버튼 자동화 설정 (DB에 이미 속성 추가됨)
   - "📄 더보기" 속성 클릭 → 자동화 편집
   - 액션: HTTP 요청 (메인 페이지 "📄 더보기 버튼 설정" 토글 참고)
   - Body: user_id + notion_page_id

2. 검색 DB의 user_id 속성에 기본값 설정
   - 관리자에게 받은 user_id 값을 기본값으로 지정
   - 새 검색 행 추가 시 자동으로 채워짐

3. 검색 DB 뷰 3개 추가
   - 전체 (테이블, 검색일시 내림차순)
   - 최근 검색 (갤러리, 지난 7일 필터)
   - 진행 중 (보드, 상태별 그룹)

4. ${USER_ID === 'YOUR_USER_ID'
    ? '설정 페이지 사용량/기록 임베드 URL에서 YOUR_USER_ID를 실제 값으로 교체\n   (또는 다음번엔 --user-id <user_id> 옵션으로 자동 삽입)'
    : `✅ 사용량/기록 임베드 URL에 user_id 자동 삽입됨 (${USER_ID.slice(0, 8)}...)`}

5. 메인 페이지에 커버 이미지 추가 (Unsplash → "minimal workspace")

6. 페이지 공유 → "웹에 게시" + "템플릿으로 복제 허용" 체크
`);
}

main().catch(err => {
  console.error('\n❌ 오류:', err.message);
  process.exit(1);
});

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
const SEARCH_URL     = `${PAGES_BASE}/search.html`;
const USAGE_URL      = `${PAGES_BASE}/usage.html`;
const HISTORY_URL    = `${PAGES_BASE}/history.html`;
const SEARCH_TEMPLATE_PAGE_TITLE = '검색 결과 템플릿';
const RUNNING_IN_DEPLOY = process.env.SNAPPY_DEPLOY_FLOW === '1';

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
    // 속성 순서: 키워드(제목) → 상태 → 매체 → 기간 → 발견 콘텐츠 수 → 검색일시 → 더보기
    // 검색 파라미터는 임베드 폼에서 입력받아 서버가 행을 생성하므로 입력용 속성은 두지 않음
    properties: {
      '키워드':        { title: {} },
      '상태':          { status: {} },
      '매체':          { multi_select: { options: [
        { name: '네이버블로그', color: 'green'  },
        { name: '유튜브',       color: 'red'    },
        { name: '티스토리',     color: 'orange' },
        { name: '브런치',       color: 'brown'  },
      ]}},
      '기간':          { select: { options: [
        { name: '1일',   color: 'gray'   },
        { name: '1주',   color: 'blue'   },
        { name: '1개월', color: 'purple' },
        { name: '1년',   color: 'pink'   },
      ]}},
      '발견 콘텐츠 수': { number: { format: 'number' } },
      '검색일시':       { created_time: {} },
      '📄 더보기':      { button: {} },
    },
  });
}

async function createContentDB(parentPageId) {
  return notion('POST', '/databases', {
    parent: { page_id: parentPageId },
    is_inline: true,
    icon: { type: 'emoji', emoji: '📚' },
    title: rich('콘텐츠'),
    properties: {
      '제목': { title: {} },
      '매체': {
        select: {
          options: [
            { name: '네이버블로그', color: 'green' },
            { name: '유튜브', color: 'red' },
            { name: '티스토리', color: 'orange' },
            { name: '브런치', color: 'purple' },
          ],
        },
      },
      'URL': { url: {} },
      '작성자': { rich_text: {} },
      '날짜': { date: {} },
      // 콘텐츠 분석 결과 컬럼 — 검색 후 백그라운드로 채워짐
      '요약': { rich_text: {} },
      '키워드': { multi_select: {} },
      '분석 상태': {
        select: {
          options: [
            { name: '분석중', color: 'yellow' },
            { name: '완료', color: 'green' },
            { name: '실패', color: 'red' },
          ],
        },
      },
    },
  });
}

// ── 각 페이지 콘텐츠 ────────────────────────────────────────────────────────

function blocksMain() {
  return [
    b.embed(SEARCH_URL),
  ];
}


function blocksSijak() {
  return [
    b.h1('Snappy 시작하기'),
    b.p('템플릿을 복제하고, 셋업 마법사에서 Notion 연결을 완료하면 바로 검색할 수 있습니다.'),
    b.divider(),
    b.h2('1. 템플릿 복제'),
    b.callout('원본 템플릿에서 바로 셋업하지 말고, 먼저 본인 워크스페이스로 복제하세요.', '📌'),
    b.num('이 페이지 우측 상단의 복제 또는 Duplicate 버튼을 클릭합니다.'),
    b.num('검색 결과를 저장할 개인 워크스페이스를 선택합니다.'),
    b.num('복제된 Snappy 페이지를 열어 둡니다.'),
    b.divider(),
    b.h2('2. 계정 연결'),
    b.link('셋업 마법사 시작하기', SETUP_URL, '🚀'),
    b.num('관리자에게 받은 user_id를 입력하고 계정을 확인합니다.'),
    b.num('Notion으로 연결하기를 클릭합니다.'),
    b.num('Notion 승인 화면에서 방금 복제한 Snappy 페이지를 선택합니다.'),
    b.num('셋업 마법사가 검색 DB를 찾거나 새로 만들고, 검색 임베드를 연결합니다.'),
    b.num('마지막 확인 버튼을 눌러 연결 상태를 저장합니다.'),
    b.divider(),
    b.h2('3. 첫 검색'),
    b.num('메인 페이지의 검색 입력창에 키워드를 입력합니다.'),
    b.num('기간을 선택합니다. 기본값은 1개월입니다.'),
    b.num('검색할 매체를 선택합니다. 네이버, 유튜브, 티스토리, 브런치를 각각 켜고 끌 수 있습니다.'),
    b.num('검색하기를 누른 뒤 결과가 검색 DB에 기록될 때까지 기다립니다.'),
    b.callout('검색 중에는 Notion 페이지와 자체 데이터베이스에 결과를 저장합니다. 몇 초 정도 대기 시간이 있을 수 있습니다.', '⏳'),
    b.divider(),
    b.h2('문제가 생겼을 때'),
    b.toggle('Notion 승인 화면에서 어떤 페이지를 선택해야 하나요?', [
      b.p('복제한 Snappy 메인 페이지를 선택하세요. 메인 페이지를 선택하면 하위 검색 DB까지 접근 권한이 함께 부여됩니다.'),
      b.p('다른 페이지를 선택하면 검색 DB를 찾지 못하거나 결과 저장에 실패할 수 있습니다.'),
    ]),
    b.toggle('검색 DB 연결 단계에서 실패해요', [
      b.bullet('복제한 Snappy 페이지를 Notion 승인 화면에서 선택했는지 확인'),
      b.bullet('Notion 연결 권한을 취소했다면 셋업 마법사를 다시 실행'),
      b.bullet('검색 DB 또는 검색 결과 템플릿 페이지 이름을 바꿨다면 원래 이름으로 복구'),
    ]),
    b.toggle('검색 버튼을 눌렀는데 반응이 없어요', [
      b.bullet('셋업 마법사 마지막 단계에서 확인 버튼을 눌렀는지 확인'),
      b.bullet('키워드를 입력했는지 확인'),
      b.bullet('하나 이상의 매체가 선택되어 있는지 확인'),
      b.bullet('검색 중 상태가 오래 지속되면 페이지를 새로고침한 뒤 검색 DB를 확인'),
    ]),
  ];
}


function blocksFaq() {
  return [
    b.h1('자주 묻는 질문'),
    b.divider(),
    b.h2('검색'),
    b.toggle('어떤 매체를 검색하나요?', [
      b.bullet('네이버 블로그: 네이버 검색 API'),
      b.bullet('유튜브: YouTube Data API (공식)'),
      b.bullet('티스토리: 웹 검색 결과 기반'),
      b.bullet('브런치: 웹 검색 결과 기반'),
    ]),
    b.toggle('기간은 어떻게 적용되나요?', [
      b.p('검색 임베드에서 1일, 1주, 1개월, 1년 중 하나를 선택할 수 있습니다. 기본값은 1개월입니다.'),
      b.p('매체별 API와 검색 결과의 날짜 품질이 달라 일부 결과는 기간 필터가 완벽하게 일치하지 않을 수 있습니다.'),
    ]),
    b.toggle('같은 키워드를 다시 검색하면 결과가 달라지나요?', [
      b.p('네. 각 매체의 검색 결과는 시간이 지나며 바뀌고, 선택한 기간과 매체에 따라 결과가 달라질 수 있습니다.'),
    ]),
    b.toggle('검색 한 번에 시간이 얼마나 걸리나요?', [
      b.p('보통 수 초에서 1분 이내에 완료됩니다. 매체를 많이 선택하거나 Notion API가 느릴 때는 더 오래 걸릴 수 있습니다.'),
      b.p('검색 결과 저장 과정이 끝나기 전에는 완료 또는 실패 메시지가 늦게 표시될 수 있습니다.'),
    ]),
    b.toggle('검색 결과는 어디에 저장되나요?', [
      b.p('복제한 Snappy 페이지 안의 검색 DB에 검색 기록이 생성되고, 각 검색 페이지 안의 콘텐츠 DB에 개별 결과가 저장됩니다.'),
    ]),
    b.toggle('인스타그램은 왜 없나요?', [
      b.p('인스타그램은 외부 검색 API 접근이 제한되어 안정적인 자동 검색을 제공하기 어렵습니다.'),
    ]),
    b.divider(),
    b.h2('요금제'),
    b.toggle('무료로 사용할 수 있나요?', [
      b.p('베타 기간에는 무료로 사용할 수 있습니다. 기본 일일 검색 한도는 3회입니다.'),
    ]),
    b.toggle('일일 검색 한도가 있나요?', [
      b.bullet('무료 또는 베타: 3회'),
      b.bullet('라이트: 5회'),
      b.bullet('스탠다드: 10회'),
      b.bullet('프리미엄: 30회'),
    ]),
    b.toggle('결제는 어떻게 하나요?', [
      b.p('결제 기능은 정식 출시 시점에 안내됩니다. 현재는 관리자 안내에 따라 계정 등급이 적용됩니다.'),
    ]),
    b.divider(),
    b.h2('문제 해결'),
    b.toggle('검색이 "실패" 상태로 끝났어요', [
      b.bullet('일일 검색 한도를 초과했는지 설정 페이지에서 확인'),
      b.bullet('Notion 연결 권한을 해제했는지 확인'),
      b.bullet('검색 DB 또는 검색 결과 템플릿 페이지를 삭제했는지 확인'),
      b.bullet('잠시 후 같은 키워드로 다시 검색'),
    ]),
    b.toggle('검색 결과가 너무 적게 나와요', [
      b.bullet('기간을 더 길게 설정 (1개월 → 1년)'),
      b.bullet('키워드를 더 일반적으로 변경'),
      b.bullet('다른 매체도 함께 선택'),
    ]),
    b.toggle('검색 완료 메시지가 보이는데 결과가 없어요', [
      b.p('검색 결과 저장과 Notion 페이지 업데이트가 순차적으로 진행됩니다. 잠시 기다린 뒤 검색 DB 행을 다시 열어보세요.'),
      b.p('계속 비어 있다면 검색이 실패 상태로 기록되었는지 확인하고, 시작하기 페이지의 셋업 과정을 다시 실행하세요.'),
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
    b.callout('문제가 계속되면 관리자에게 user_id, 검색 키워드, 발생 시간을 함께 전달하세요.', '📧'),
  ];
}

function blocksSeoljeong() {
  return [
    b.h1('설정'),
    b.divider(),
    b.h2('계정 정보'),
    b.callout('사용자 ID (user_id)\n\n관리자에게 받은 고유 ID입니다. 셋업 마법사, 사용량 조회, 검색 기록 조회에 사용됩니다.', '🔑'),
    b.divider(),
    b.h2('사용량'),
    b.link('사용량 확인하기', `${USAGE_URL}?user_id=${USER_ID}`, '📊'),
    b.h2('검색 기록'),
    b.link('검색 기록 보기', `${HISTORY_URL}?user_id=${USER_ID}`, '📋'),
    ...(USER_ID === 'YOUR_USER_ID' ? [b.p('※ YOUR_USER_ID를 실제 user_id로 교체하거나, 스크립트 실행 시 --user-id <id> 옵션을 사용하세요.')] : []),
    b.divider(),
    b.h2('연동 정보'),
    b.callout('검색 임베드와 검색 DB 연결은 셋업 마법사 마지막 단계에서 자동으로 갱신됩니다.', '🔗'),
    b.toggle('노션 연동 다시 설정', [
      b.p('다음 경우에 다시 설정이 필요합니다:'),
      b.bullet('Notion 연결 권한을 다시 승인해야 할 때'),
      b.bullet('복제한 페이지를 바꿨을 때'),
      b.bullet('검색 DB를 삭제했거나 다른 DB로 바꾸고 싶을 때'),
      b.p('시작하기 페이지의 셋업 마법사를 다시 실행하세요.'),
    ]),
    b.toggle('연동 해제', [
      b.num('Notion 설정의 연결 또는 내 통합 관리 화면으로 이동'),
      b.num('Snappy와 연결된 통합 권한 삭제'),
      b.p('연동 해제 후에는 검색이 동작하지 않습니다.'),
    ]),
    b.toggle('검색 결과 템플릿', [
      b.p(`이 설정 페이지 아래의 "${SEARCH_TEMPLATE_PAGE_TITLE}" 페이지는 새 검색 결과 페이지를 만들 때 사용됩니다.`),
      b.bullet('페이지 이름을 바꾸거나 삭제하지 마세요.'),
      b.bullet('안의 콘텐츠 DB 속성은 검색 결과 저장과 분석에 사용됩니다.'),
    ]),
    b.divider(),
    b.h2('플랜'),
    b.callout('기본 플랜: 베타 무료\n기본 일일 한도: 3회\n실제 한도는 관리자 설정에 따라 달라질 수 있습니다.', '📊'),
    b.divider(),
    b.h2('도움말'),
    b.bullet('문제 보고 시 user_id, 검색 키워드, 발생 시간을 함께 전달하세요.'),
    b.bullet('검색 DB와 검색 결과 템플릿 페이지는 삭제하지 않는 것이 좋습니다.'),
  ];
}

// ── 메인 ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀 트렌드 콘텐츠 발견기 노션 템플릿 생성 시작\n');

  const loadMoreUrl = `${SUPABASE_URL}/functions/v1/load-more`;

  // 1. 메인 페이지 상단 블록
  process.stdout.write('📘 메인 페이지 생성 중...');
  const mainPage = await createPage(PARENT_PAGE_ID, '트렌드 콘텐츠 발견기', '📘');
  await appendBlocks(mainPage.id, blocksMain());
  console.log(` ✅  ${mainPage.url}`);

  await sleep(300);

  // 2. 검색 DB — 메인 페이지에 인라인으로 생성 (서브페이지 이동 불필요)
  process.stdout.write('🔍 검색 DB 생성 중...');
  const db = await createSearchDB(mainPage.id);
  console.log(` ✅  DB ID: ${db.id}`);

  await sleep(300);

  // 3. 시작하기 서브페이지 (셋업 + 문제해결)
  process.stdout.write('📖 시작하기 페이지 생성 중...');
  const sijakPage = await createPage(mainPage.id, '시작하기', '📖');
  await appendBlocks(sijakPage.id, blocksSijak());
  console.log(` ✅`);

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

  await sleep(300);

  // 6. 설정 하위 검색 결과 템플릿 페이지 + 콘텐츠 DB
  process.stdout.write('📚 콘텐츠 DB 템플릿 페이지 생성 중...');
  const templateSearchPage = await createPage(seoljeongPage.id, SEARCH_TEMPLATE_PAGE_TITLE, '📄');
  await sleep(300);
  const contentDb = await createContentDB(templateSearchPage.id);
  console.log(` ✅  Page ID: ${templateSearchPage.id}, DB ID: ${contentDb.id}`);

  // 완료
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅  템플릿 생성 완료!
${mainPage.url}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 남은 수동 작업 (노션에서 직접):

1. "📄 더보기" 버튼 자동화 설정 (DB에 이미 속성 추가됨)
   - "📄 더보기" 속성 클릭 → 자동화 편집
   - 액션: HTTP 요청
   - URL: ${loadMoreUrl}
   - Method: POST
   - Headers: Authorization: Bearer <SUPABASE_ANON_KEY>, apikey: <SUPABASE_ANON_KEY>
   - Body: { "notion_page_id": "{{현재 페이지 ID}}" }
     (user_id는 서버가 검색 기록에서 자동 조회하므로 생략 가능)

2. 검색 결과 템플릿 확인
   - 스크립트가 설정 페이지 아래에 "${SEARCH_TEMPLATE_PAGE_TITLE}" 페이지를 생성했습니다.
   - 해당 페이지 안에 "콘텐츠" 인라인 DB도 생성되어 있습니다.
   - 서버는 새 검색 행 생성 시 이 페이지를 템플릿으로 적용하고, 복제된 콘텐츠 DB에 검색 결과를 추가합니다.
   - 이 페이지는 삭제하거나 이름을 바꾸지 마세요.

3. 검색 DB 뷰 3개 추가
   - 전체 (테이블, 검색일시 내림차순)
   - 최근 검색 (갤러리, 지난 7일 필터)
   - 진행 중 (보드, 상태별 그룹)

4. ${USER_ID === 'YOUR_USER_ID'
    ? '설정 페이지 사용량/기록 임베드 URL에서 YOUR_USER_ID를 실제 값으로 교체\n   (또는 다음번엔 --user-id <user_id> 옵션으로 자동 삽입)'
    : `✅ 사용량/기록 임베드 URL에 user_id 자동 삽입됨 (${USER_ID.slice(0, 8)}...)`}

5. 메인 페이지에 커버 이미지 추가 (Unsplash → "minimal workspace")

6. 페이지 공유 → "웹에 게시" + "템플릿으로 복제 허용" 체크

7. ${RUNNING_IN_DEPLOY
    ? '배포 스크립트 프롬프트에 게시/복제 링크 입력'
    : '게시/복제 링크를 docs/config.json 의 template_url에 반영'}
   - 사용자가 여는 고정 링크는 https://pchanul.github.io/Snappy/template.html

8. ${RUNNING_IN_DEPLOY ? '배포 스크립트가 이어서 기존 배포 흐름을 진행합니다.' : 'bash scripts/deploy.sh 실행'}
`);
}

main().catch(err => {
  console.error('\n❌ 오류:', err.message);
  process.exit(1);
});

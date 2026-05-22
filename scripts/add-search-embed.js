#!/usr/bin/env node
// 기존 노션 페이지에 검색 버튼 임베드 블록 추가
//
// 사용법:
//   node scripts/add-search-embed.js <page-id>
//
// 준비:
//   .env.local에 NOTION_API_KEY 필요

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(__dirname, '..', '.env.local'));

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const RAW_PAGE_ID    = (process.argv[2] || process.env.NOTION_TEMPLATE_PARENT_PAGE_ID || '').replace(/-/g, '');
const PAGES_BASE     = (process.env.GITHUB_PAGES_URL || 'https://pchanul.github.io/Snappy').replace(/\/+$/, '');
const EMBED_URL      = `${PAGES_BASE}/search.html`;

if (!NOTION_API_KEY) {
  console.error('❌  NOTION_API_KEY 가 없습니다. .env.local 에 추가하세요.');
  process.exit(1);
}
if (!RAW_PAGE_ID) {
  console.error('❌  페이지 ID가 필요합니다.');
  console.error('    사용법: node scripts/add-search-embed.js <page-id>');
  process.exit(1);
}

const PAGE_UUID = `${RAW_PAGE_ID.slice(0,8)}-${RAW_PAGE_ID.slice(8,12)}-${RAW_PAGE_ID.slice(12,16)}-${RAW_PAGE_ID.slice(16,20)}-${RAW_PAGE_ID.slice(20)}`;

async function notion(endpoint, method, body) {
  const res = await fetch(`https://api.notion.com/v1/${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function main() {
  console.log(`\n📌 검색 버튼 임베드 추가`);
  console.log(`   페이지 : ${PAGE_UUID}`);
  console.log(`   URL    : ${EMBED_URL}\n`);

  // 이미 추가되어 있는지 확인
  const existing = await notion(`blocks/${PAGE_UUID}/children?page_size=100`, 'GET');
  const found = existing.results.find(
    b => b.type === 'embed' && b.embed?.url?.includes('search.html')
  );
  if (found) {
    console.log('⚠️  이미 search.html 임베드 블록이 있습니다.');
    console.log(`   블록 ID  : ${found.id}`);
    console.log(`   현재 URL : ${found.embed.url}`);
    process.exit(0);
  }

  // 첫 번째 블록 앞에 삽입하기 위해 after 없이 추가 후 이동이 불가하므로
  // 맨 위에 넣고 싶다면 노션에서 직접 드래그하거나, 전체 블록을 재구성해야 함.
  // 여기서는 페이지 맨 앞에 추가 (Notion API는 prepend 미지원 → append 후 수동 이동)
  const firstBlockId = existing.results[0]?.id;
  await notion(`blocks/${PAGE_UUID}/children`, 'PATCH', {
    children: [{ type: 'embed', embed: { url: EMBED_URL } }],
    ...(firstBlockId ? { after: '' } : {}),  // after 미지정 → 맨 끝 추가
  });

  console.log('✅  임베드 블록 추가 완료!');
  console.log(`   노션에서 블록을 페이지 맨 위로 드래그하세요.`);
  console.log(`   셋업 완료 후 자동으로 URL에 user_id + page_id 가 삽입됩니다.\n`);
}

main().catch(err => {
  console.error('\n❌ 오류:', err.message);
  process.exit(1);
});

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

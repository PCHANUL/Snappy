#!/usr/bin/env node
// Naver DataLab keywordGroups 테스트 스크립트
//
// 사용법:
//   node scripts/test-naver-keywords.js
//   node scripts/test-naver-keywords.js --group "AI=AI,생성형 AI,ChatGPT" --group "숏폼=숏폼,릴스,쇼츠"
//   node scripts/test-naver-keywords.js --start 2026-05-01 --end 2026-05-29 --time-unit date --raw

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATALAB_URL = 'https://openapi.naver.com/v1/datalab/search';

loadEnv(path.join(ROOT, '.env.local'));

await main().catch((error) => {
  console.error(`❌ ${error.message}`);
  process.exit(1);
});

async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET) {
    throw new Error('NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 이 필요합니다. .env.local을 확인하세요.');
  }

  const keywordGroups = options.groups.length ? options.groups : defaultGroups();
  validateKeywordGroups(keywordGroups);

  const body = {
    startDate: options.startDate,
    endDate: options.endDate,
    timeUnit: options.timeUnit,
    keywordGroups,
  };

  console.log('\n━━━ Naver DataLab keywordGroups 테스트 ━━━\n');
  console.log(`기간: ${body.startDate} ~ ${body.endDate} (${body.timeUnit})`);
  console.log(`그룹: ${body.keywordGroups.length}개`);
  for (const [idx, group] of body.keywordGroups.entries()) {
    console.log(`  ${idx + 1}. ${group.groupName}: ${group.keywords.join(', ')}`);
  }

  const res = await fetch(DATALAB_URL, {
    method: 'POST',
    headers: {
      'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
      'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!res.ok) {
    console.error(`\n❌ Naver DataLab API 실패: HTTP ${res.status}`);
    console.error(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
    process.exit(1);
  }

  if (options.raw) {
    console.log('\n원본 응답:');
    console.log(JSON.stringify(data, null, 2));
  } else {
    printSummary(data);
  }
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

function parseArgs(argv) {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 28);

  const options = {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
    timeUnit: 'week',
    groups: [],
    raw: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--group':
      case '-g':
        options.groups.push(parseGroup(requireValue(argv, ++i, arg)));
        break;
      case '--start':
        options.startDate = requireValue(argv, ++i, arg);
        break;
      case '--end':
        options.endDate = requireValue(argv, ++i, arg);
        break;
      case '--time-unit':
        options.timeUnit = requireValue(argv, ++i, arg);
        break;
      case '--raw':
        options.raw = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        console.error(`❌ 알 수 없는 옵션: ${arg}`);
        printHelp();
        process.exit(1);
    }
  }

  if (!['date', 'week', 'month'].includes(options.timeUnit)) {
    throw new Error('--time-unit 은 date, week, month 중 하나여야 합니다.');
  }

  return options;
}

function parseGroup(value) {
  const sep = value.includes('=') ? '=' : ':';
  const idx = value.indexOf(sep);
  if (idx === -1) {
    throw new Error(`그룹 형식이 올바르지 않습니다: ${value}`);
  }

  const groupName = value.slice(0, idx).trim();
  const keywords = value
    .slice(idx + 1)
    .split(',')
    .map((keyword) => keyword.trim())
    .filter(Boolean);

  return { groupName, keywords };
}

function validateKeywordGroups(groups) {
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new Error('keywordGroups 는 1개 이상이어야 합니다.');
  }
  if (groups.length > 5) {
    throw new Error(`keywordGroups 는 최대 5개까지 가능합니다. 현재: ${groups.length}개`);
  }

  for (const [idx, group] of groups.entries()) {
    if (!group.groupName) {
      throw new Error(`${idx + 1}번째 groupName 이 비어 있습니다.`);
    }
    if (!Array.isArray(group.keywords) || group.keywords.length === 0) {
      throw new Error(`${group.groupName} 그룹의 keywords 는 1개 이상이어야 합니다.`);
    }
    if (group.keywords.length > 20) {
      throw new Error(`${group.groupName} 그룹의 keywords 는 최대 20개까지 가능합니다. 현재: ${group.keywords.length}개`);
    }
  }
}

function printSummary(data) {
  const results = data.results || [];
  if (!results.length) {
    console.log('\n결과가 없습니다.');
    return;
  }

  console.log('\n결과 요약:');
  for (const result of results) {
    const points = result.data || [];
    const latest = points.at(-1);
    const max = points.reduce((best, point) => Math.max(best, point.ratio || 0), 0);
    const avg = points.length
      ? points.reduce((sum, point) => sum + (point.ratio || 0), 0) / points.length
      : 0;

    console.log(`\n${result.title}`);
    console.log(`  keywords : ${(result.keywords || []).join(', ')}`);
    console.log(`  latest   : ${latest ? `${latest.period} / ${latest.ratio}` : '-'}`);
    console.log(`  max      : ${round(max)}`);
    console.log(`  avg      : ${round(avg)}`);
    console.log('  points   :');
    for (const point of points) {
      console.log(`    - ${point.period}: ${point.ratio}`);
    }
  }
}

function defaultGroups() {
  return [
    { groupName: 'AI', keywords: ['AI', '생성형 AI', 'ChatGPT'] },
    { groupName: '숏폼', keywords: ['숏폼', '릴스', '쇼츠'] },
    { groupName: '블로그', keywords: ['블로그', '블로그 마케팅', '네이버 블로그'] },
  ];
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} 옵션 값이 필요합니다.`);
  }
  return value;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function printHelp() {
  console.log(`
사용법:
  node scripts/test-naver-keywords.js [옵션]

옵션:
  --group, -g "주제=검색어1,검색어2"  keywordGroups 항목 추가. 최대 5개.
  --start YYYY-MM-DD                  시작일. 기본: 28일 전.
  --end YYYY-MM-DD                    종료일. 기본: 오늘.
  --time-unit date|week|month         집계 단위. 기본: week.
  --raw                               네이버 원본 JSON 출력.
  --help, -h                          도움말.

예시:
  node scripts/test-naver-keywords.js \\
    --group "AI=AI,생성형 AI,ChatGPT" \\
    --group "숏폼=숏폼,릴스,쇼츠"
`);
}

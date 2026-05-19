#!/usr/bin/env node
// Admin CLI for Snappy
//
// Usage:
//   node scripts/admin.js create <email> [--tier free|light|standard|premium]
//   node scripts/admin.js list [--page 1] [--limit 20]
//   node scripts/admin.js info <user_id>
//
// Requires .env.local with SUPABASE_URL and ADMIN_SECRET

import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env.local
const envPath = resolve(process.cwd(), '.env.local');
try {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  // .env.local not found — rely on environment
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const ADMIN_SECRET = process.env.ADMIN_SECRET;

if (!SUPABASE_URL) {
  console.error('Error: SUPABASE_URL not set in .env.local or environment');
  process.exit(1);
}
if (!ADMIN_SECRET) {
  console.error('Error: ADMIN_SECRET not set in .env.local or environment');
  process.exit(1);
}

const BASE = `${SUPABASE_URL}/functions/v1/manage-user`;

async function apiFetch(path, options = {}) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-secret': ADMIN_SECRET,
      ...options.headers,
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || `HTTP ${res.status}`);
  }
  return data;
}

// --- commands ---

async function cmdCreate(args) {
  const email = args[0];
  if (!email) { console.error('Usage: admin.js create <email> [--tier free|light|standard|premium]'); process.exit(1); }
  const tierIdx = args.indexOf('--tier');
  const tier = tierIdx !== -1 ? args[tierIdx + 1] : 'free';

  const data = await apiFetch('?action=admin-create-user', {
    method: 'POST',
    body: JSON.stringify({ email, subscription_tier: tier }),
  });

  console.log('User created:');
  console.log(`  user_id          : ${data.user_id}`);
  console.log(`  email            : ${data.email}`);
  console.log(`  subscription_tier: ${data.subscription_tier}`);
  console.log(`  setup_url        : ${data.setup_url}`);
}

async function cmdList(args) {
  const pageIdx = args.indexOf('--page');
  const page = pageIdx !== -1 ? args[pageIdx + 1] : '1';
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx !== -1 ? args[limitIdx + 1] : '20';

  const data = await apiFetch(`?action=admin-list-users&page=${page}&limit=${limit}`);

  console.log(`Users (page ${data.page}, total ${data.total}):`);
  if (data.users.length === 0) {
    console.log('  (none)');
    return;
  }
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`  ${pad('user_id', 38)} ${pad('email', 30)} ${pad('tier', 10)} created_at`);
  console.log(`  ${'-'.repeat(38)} ${'-'.repeat(30)} ${'-'.repeat(10)} ----------`);
  for (const u of data.users) {
    console.log(`  ${pad(u.id, 38)} ${pad(u.email, 30)} ${pad(u.subscription_tier, 10)} ${u.created_at?.slice(0, 10) || ''}`);
  }
}

async function cmdInfo(args) {
  const userId = args[0];
  if (!userId) { console.error('Usage: admin.js info <user_id>'); process.exit(1); }

  // Reuse list endpoint; filter client-side since there's no admin-get-user action
  let found = null;
  let page = 1;
  while (!found) {
    const data = await apiFetch(`?action=admin-list-users&page=${page}&limit=100`);
    found = data.users.find(u => u.id === userId);
    if (found || data.users.length < 100) break;
    page++;
  }

  if (!found) { console.error(`User not found: ${userId}`); process.exit(1); }

  console.log('User info:');
  for (const [k, v] of Object.entries(found)) {
    console.log(`  ${k.padEnd(28)}: ${v ?? ''}`);
  }
}

// --- dispatch ---

const [,, cmd, ...rest] = process.argv;

const commands = { create: cmdCreate, list: cmdList, info: cmdInfo };

if (!cmd || !commands[cmd]) {
  console.log('Usage:');
  console.log('  node scripts/admin.js create <email> [--tier free|light|standard|premium]');
  console.log('  node scripts/admin.js list [--page 1] [--limit 20]');
  console.log('  node scripts/admin.js info <user_id>');
  process.exit(0);
}

commands[cmd](rest).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});

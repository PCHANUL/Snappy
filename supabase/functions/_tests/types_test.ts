import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { getEffectiveTier, DAILY_QUOTAS, PLATFORM_INFO } from '../_core/types.ts';

// ── getEffectiveTier ──────────────────────────────────────────────────────────

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

Deno.test('getEffectiveTier: 만료일 없으면 원래 티어', () => {
  assertEquals(getEffectiveTier('premium', null), 'premium');
  assertEquals(getEffectiveTier('standard', null), 'standard');
  assertEquals(getEffectiveTier('light', null), 'light');
  assertEquals(getEffectiveTier('free', null), 'free');
});

Deno.test('getEffectiveTier: 유효한 구독 → 원래 티어', () => {
  assertEquals(getEffectiveTier('standard', daysFromNow(30)), 'standard');
  assertEquals(getEffectiveTier('premium', daysFromNow(1)), 'premium');
});

Deno.test('getEffectiveTier: 만료 직후 → 7일 유예 기간 내 → 원래 티어', () => {
  assertEquals(getEffectiveTier('standard', daysAgo(1)), 'standard');
  assertEquals(getEffectiveTier('premium',  daysAgo(6)), 'premium');
});

Deno.test('getEffectiveTier: 유예 기간 경계 (7일 직후) → free', () => {
  assertEquals(getEffectiveTier('standard', daysAgo(8)), 'free');
});

Deno.test('getEffectiveTier: 만료 후 30일 → free', () => {
  assertEquals(getEffectiveTier('premium', daysAgo(30)), 'free');
});

Deno.test('getEffectiveTier: 만료 후 365일 → free', () => {
  assertEquals(getEffectiveTier('premium', daysAgo(365)), 'free');
});

// ── DAILY_QUOTAS ──────────────────────────────────────────────────────────────

Deno.test('DAILY_QUOTAS: free ≤ light ≤ standard ≤ premium 순서', () => {
  const { free, light, standard, premium } = DAILY_QUOTAS;
  assertEquals(free <= light, true);
  assertEquals(light <= standard, true);
  assertEquals(standard <= premium, true);
});

Deno.test('DAILY_QUOTAS: free > 0', () => {
  assertEquals(DAILY_QUOTAS.free > 0, true);
});

// ── PLATFORM_INFO ─────────────────────────────────────────────────────────────

Deno.test('PLATFORM_INFO: 5개 플랫폼 모두 정의', () => {
  for (const platform of ['naver_blog', 'youtube', 'youtube_shorts', 'tistory', 'brunch'] as const) {
    assertEquals(typeof PLATFORM_INFO[platform].name, 'string');
    assertEquals(typeof PLATFORM_INFO[platform].emoji, 'string');
    assertEquals(PLATFORM_INFO[platform].name.length > 0, true);
    assertEquals(PLATFORM_INFO[platform].emoji.length > 0, true);
  }
});

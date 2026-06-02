import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { rootDomain, isSameDomain } from '../_core/domain.ts';

// ── rootDomain ─────────────────────────────────────────────────────────────

Deno.test('rootDomain: 네이버 블로그 서브도메인 → naver.com', () => {
  assertEquals(rootDomain('https://blog.naver.com/user/123'), 'naver.com');
  assertEquals(rootDomain('https://m.blog.naver.com/user/123'), 'naver.com');
  assertEquals(rootDomain('https://post.blog.naver.com/user/123'), 'naver.com');
});

Deno.test('rootDomain: 티스토리 사용자 서브도메인 → tistory.com', () => {
  assertEquals(rootDomain('https://myblog.tistory.com/42'), 'tistory.com');
});

Deno.test('rootDomain: 유튜브 단축 도메인 통합', () => {
  assertEquals(rootDomain('https://www.youtube.com/watch?v=abc'), 'youtube.com');
  assertEquals(rootDomain('https://youtu.be/abc'), 'youtube.com');
});

Deno.test('rootDomain: www 제거', () => {
  assertEquals(rootDomain('https://www.example.com/page'), 'example.com');
});

Deno.test('rootDomain: 일반 서브도메인 → 루트', () => {
  assertEquals(rootDomain('https://docs.example.com'), 'example.com');
});

Deno.test('rootDomain: 멀티파트 TLD(co.kr) 보존', () => {
  assertEquals(rootDomain('https://shop.example.co.kr/x'), 'example.co.kr');
  assertEquals(rootDomain('https://example.co.kr'), 'example.co.kr');
});

Deno.test('rootDomain: 브런치 → brunch.co.kr', () => {
  assertEquals(rootDomain('https://brunch.co.kr/@author/10'), 'brunch.co.kr');
});

Deno.test('rootDomain: 스킴 없는 입력 허용', () => {
  assertEquals(rootDomain('example.com/path'), 'example.com');
  assertEquals(rootDomain('blog.naver.com/user'), 'naver.com');
});

Deno.test('rootDomain: 잘못된 입력 → 빈 문자열', () => {
  assertEquals(rootDomain(''), '');
  assertEquals(rootDomain('not a url'), '');
});

// ── isSameDomain ───────────────────────────────────────────────────────────

Deno.test('isSameDomain: 모바일/데스크톱 네이버 블로그 동일 판정', () => {
  assertEquals(isSameDomain('https://blog.naver.com/a/1', 'https://m.blog.naver.com/b/2'), true);
});

Deno.test('isSameDomain: 자기 도메인(스킴 없음) vs 측정 URL', () => {
  assertEquals(isSameDomain('example.co.kr', 'https://www.example.co.kr/post/1'), true);
});

Deno.test('isSameDomain: 다른 출처 → false', () => {
  assertEquals(isSameDomain('https://naver.com/x', 'https://tistory.com/y'), false);
});

Deno.test('isSameDomain: 빈 도메인끼리는 false', () => {
  assertEquals(isSameDomain('not a url', 'also bad'), false);
});

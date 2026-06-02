import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  ValidationError,
  AuthError,
  QuotaExceededError,
  ExternalApiError,
  NotionApiError,
  errorToResponse,
} from '../_core/errors.ts';

// ── 에러 클래스 ───────────────────────────────────────────────────────────────

Deno.test('ValidationError: statusCode=400, code=VALIDATION_ERROR', () => {
  const e = new ValidationError('bad input');
  assertEquals(e.statusCode, 400);
  assertEquals(e.code, 'VALIDATION_ERROR');
  assertEquals(e.name, 'AppError');
});

Deno.test('ValidationError: userMessage 분리', () => {
  const e = new ValidationError('internal', '사용자 안내');
  assertEquals(e.message, 'internal');
  assertEquals(e.userMessage, '사용자 안내');
});

Deno.test('ValidationError: userMessage 미지정 → message 그대로', () => {
  const e = new ValidationError('키워드 필요');
  assertEquals(e.userMessage, '키워드 필요');
});

Deno.test('AuthError: statusCode=401, code=AUTH_ERROR', () => {
  const e = new AuthError();
  assertEquals(e.statusCode, 401);
  assertEquals(e.code, 'AUTH_ERROR');
});

Deno.test('AuthError: 기본 메시지 포함', () => {
  const e = new AuthError();
  assert(e.message.length > 0, '메시지가 있어야 함');
});

Deno.test('QuotaExceededError: statusCode=429, code=QUOTA_EXCEEDED', () => {
  const e = new QuotaExceededError(5);
  assertEquals(e.statusCode, 429);
  assertEquals(e.code, 'QUOTA_EXCEEDED');
});

Deno.test('QuotaExceededError: 한도 수 포함', () => {
  const e = new QuotaExceededError(3);
  assert(e.userMessage?.includes('3'), `한도 3 포함: ${e.userMessage}`);
});

Deno.test('ExternalApiError: statusCode=502, code=EXTERNAL_API_ERROR', () => {
  const e = new ExternalApiError('Naver', '500 오류');
  assertEquals(e.statusCode, 502);
  assertEquals(e.code, 'EXTERNAL_API_ERROR');
  assert(e.message.includes('Naver'), 'API 이름 포함');
});

Deno.test('NotionApiError: statusCode=502, code=NOTION_ERROR', () => {
  const e = new NotionApiError('페이지 없음');
  assertEquals(e.statusCode, 502);
  assertEquals(e.code, 'NOTION_ERROR');
  assert(e.userMessage !== undefined);
});

// ── errorToResponse ───────────────────────────────────────────────────────────

Deno.test('errorToResponse: ValidationError → 400 + code + userMessage', async () => {
  const res = errorToResponse(new ValidationError('internal msg', '사용자 메시지'));
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, 'VALIDATION_ERROR');
  assertEquals(body.message, '사용자 메시지');
});

Deno.test('errorToResponse: AuthError → 401', async () => {
  const res = errorToResponse(new AuthError());
  assertEquals(res.status, 401);
});

Deno.test('errorToResponse: QuotaExceededError → 429', async () => {
  const res = errorToResponse(new QuotaExceededError(10));
  assertEquals(res.status, 429);
  const body = await res.json();
  assertEquals(body.error, 'QUOTA_EXCEEDED');
});

Deno.test('errorToResponse: 알 수 없는 Error → 500 + INTERNAL_ERROR', async () => {
  const res = errorToResponse(new Error('unexpected'));
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error, 'INTERNAL_ERROR');
});

Deno.test('errorToResponse: 비 Error 값 → 500', async () => {
  const res = errorToResponse('string error');
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error, 'INTERNAL_ERROR');
});

Deno.test('errorToResponse: Content-Type=application/json 헤더', async () => {
  const res = errorToResponse(new AuthError());
  assertEquals(res.headers.get('Content-Type'), 'application/json');
});

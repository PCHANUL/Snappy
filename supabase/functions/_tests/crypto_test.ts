import './setup.ts';
import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { encryptNotionKey, decryptNotionKey } from '../_shared/crypto.ts';

Deno.test('encryptNotionKey: v1:iv:ciphertext 형식 반환', async () => {
  const result = await encryptNotionKey('test-api-key');
  const parts = result.split(':');
  assertEquals(parts.length, 3);
  assertEquals(parts[0], 'v1');
  assert(parts[1].length > 0, 'IV 존재');
  assert(parts[2].length > 0, '암호문 존재');
});

Deno.test('encryptNotionKey: 동일 입력도 매번 다른 결과 (랜덤 IV)', async () => {
  const r1 = await encryptNotionKey('test-api-key');
  const r2 = await encryptNotionKey('test-api-key');
  assert(r1 !== r2, '랜덤 IV로 인해 매번 다른 결과여야 함');
});

Deno.test('decryptNotionKey: 암호화/복호화 라운드트립', async () => {
  const original = 'secret:notion:api:key:12345';
  const encrypted = await encryptNotionKey(original);
  const decrypted = await decryptNotionKey(encrypted);
  assertEquals(decrypted, original);
});

Deno.test('decryptNotionKey: 빈 문자열도 라운드트립 가능', async () => {
  const encrypted = await encryptNotionKey('');
  const decrypted = await decryptNotionKey(encrypted);
  assertEquals(decrypted, '');
});

Deno.test('decryptNotionKey: 한국어 문자열 라운드트립', async () => {
  const original = '비건디저트레시피secret키';
  const encrypted = await encryptNotionKey(original);
  const decrypted = await decryptNotionKey(encrypted);
  assertEquals(decrypted, original);
});

Deno.test('decryptNotionKey: v2 접두어 → 에러', async () => {
  let threw = false;
  try {
    await decryptNotionKey('v2:abc:def');
  } catch {
    threw = true;
  }
  assert(threw, '지원하지 않는 버전은 에러를 던져야 함');
});

Deno.test('decryptNotionKey: 콜론 없는 형식 → 에러', async () => {
  let threw = false;
  try {
    await decryptNotionKey('invalid-format');
  } catch {
    threw = true;
  }
  assert(threw, '잘못된 형식은 에러를 던져야 함');
});

Deno.test('decryptNotionKey: 부분 형식(v1:iv만) → 에러', async () => {
  let threw = false;
  try {
    await decryptNotionKey('v1:abc');
  } catch {
    threw = true;
  }
  assert(threw, '콜론 2개 미만은 에러를 던져야 함');
});

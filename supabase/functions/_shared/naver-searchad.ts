// 네이버 검색광고 API — 키워드별 월간 검색량 조회
// https://api.naver.com/keywordstool
// 인증: HMAC-SHA256(timestamp.METHOD.path, secretKey) → Base64

const AD_ENDPOINT = 'https://api.naver.com';

export interface KeywordVolume {
  keyword: string;
  monthlyPc: number | null;
  monthlyMobile: number | null;
  monthlyTotal: number | null;
}

async function sign(timestamp: number, method: string, path: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${method}.${path}`),
  );
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function parseCount(v: string | number | undefined): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (s === '<10') return 5;
  const n = parseInt(s.replace(/,/g, ''), 10);
  return isNaN(n) ? null : n;
}

export async function fetchKeywordVolumes(
  apiKey: string,
  secret: string,
  customerId: string,
  keywords: string[],
): Promise<KeywordVolume[]> {
  if (!keywords.length || !apiKey || !secret || !customerId) return [];

  // API는 최대 5개 키워드를 한 번에 처리
  const batch = keywords.slice(0, 5);
  const qs = batch.map((k) => encodeURIComponent(k)).join(',');
  const path = `/keywordstool?hintKeywords=${qs}&showDetail=1`;
  const timestamp = Date.now();
  const sig = await sign(timestamp, 'GET', path, secret);

  const res = await fetch(`${AD_ENDPOINT}${path}`, {
    headers: {
      'X-Timestamp': String(timestamp),
      'X-API-KEY': apiKey,
      'X-Customer': customerId,
      'X-Signature': sig,
      'Content-Type': 'application/json; charset=UTF-8',
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Naver Search Ad API ${res.status}: ${body}`);
  }

  const data = await res.json();
  return (data.keywordList ?? []).map((item: any) => {
    const pc = parseCount(item.monthlyPcQcCnt);
    const mobile = parseCount(item.monthlyMobileQcCnt);
    return {
      keyword: item.relKeyword as string,
      monthlyPc: pc,
      monthlyMobile: mobile,
      monthlyTotal: pc !== null && mobile !== null ? pc + mobile : null,
    };
  });
}

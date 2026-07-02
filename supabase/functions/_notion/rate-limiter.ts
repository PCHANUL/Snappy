import { getSupabase } from "../_core/db.ts";
import { logger } from "../_core/logger.ts";

// 2 req/s의 이론값(500ms)보다 여유를 둬 함수 간 네트워크 지연을 흡수한다.
const NOTION_REQUEST_INTERVAL_MS = 600;
const localNextRequestAt = new Map<string, number>();
const limiterKeyCache = new Map<string, Promise<string>>();

export async function waitForNotionRequestSlot(apiKey: string): Promise<void> {
  const limiterKey = await getLimiterKey(apiKey);
  const { data, error } = await getSupabase().rpc(
    "reserve_notion_api_request",
    {
      p_limiter_key: limiterKey,
      p_interval_ms: NOTION_REQUEST_INTERVAL_MS,
    },
  );

  if (!error && typeof data === "number") {
    if (data > 0) await sleep(data);
    return;
  }

  logger.warn("Distributed Notion rate limiter unavailable; using local slot", {
    error: error?.message ?? "invalid limiter response",
  });
  await waitForLocalSlot(limiterKey);
}

async function getLimiterKey(apiKey: string): Promise<string> {
  let cached = limiterKeyCache.get(apiKey);
  if (!cached) {
    cached = crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(apiKey),
    ).then((digest) =>
      Array.from(new Uint8Array(digest))
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("")
    );
    limiterKeyCache.set(apiKey, cached);
  }
  return await cached;
}

async function waitForLocalSlot(limiterKey: string): Promise<void> {
  const now = Date.now();
  const slotAt = Math.max(localNextRequestAt.get(limiterKey) ?? now, now);
  localNextRequestAt.set(limiterKey, slotAt + NOTION_REQUEST_INTERVAL_MS);
  if (slotAt > now) await sleep(slotAt - now);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

import { env } from "../_core/env.ts";
import { logger } from "../_core/logger.ts";
import type { ContentItem, Platform } from "../_core/types.ts";

const YOUTUBE_VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";
const AUTHOR_LOOKUP_TIMEOUT_MS = 8_000;
const MAX_AUTHOR_LENGTH = 100;

interface AuthorSource {
  url: string;
  title?: string;
  description?: string;
}

interface YouTubeVideoResponse {
  items?: Array<{
    id?: string;
    snippet?: { channelTitle?: string };
  }>;
}

export function inferPlatformAuthor(
  platform: Platform,
  source: AuthorSource,
): string | undefined {
  try {
    const parsed = new URL(source.url);

    if (platform === "naver_blog") {
      return cleanAuthor(
        parsed.searchParams.get("blogId") ??
          extractNaverPathAuthor(parsed.pathname),
      );
    }

    if (platform === "tistory") {
      const labels = parsed.hostname.toLowerCase().split(".");
      const subdomain = labels.length > 2 ? labels[0] : undefined;
      return cleanAuthor(
        subdomain && !["www", "m", "notice"].includes(subdomain)
          ? subdomain
          : undefined,
      );
    }

    if (platform === "brunch") {
      const pathAuthor = parsed.pathname.match(/^\/@([^/]+)/)?.[1];
      return cleanAuthor(
        pathAuthor
          ? `@${decodeURIComponent(pathAuthor)}`
          : extractBrunchTitleAuthor(
            source.title,
          ),
      );
    }

    if (platform === "tiktok") {
      const handle = parsed.pathname.match(/^\/@([^/]+)/)?.[1];
      return cleanAuthor(handle ? `@${decodeURIComponent(handle)}` : undefined);
    }

    if (platform === "instagram_reels") {
      return extractInstagramAuthor(source.title, source.description);
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export async function enrichPlatformAuthors(
  items: ContentItem[],
  platform: Platform,
  signal?: AbortSignal,
): Promise<void> {
  if (
    items.length === 0 ||
    (platform !== "youtube" && platform !== "youtube_shorts") ||
    !env.youtube.apiKey
  ) {
    return;
  }

  const idToItems = new Map<string, ContentItem[]>();
  for (const item of items) {
    const videoId = extractYouTubeVideoId(item.url);
    if (!videoId) continue;
    const matches = idToItems.get(videoId) ?? [];
    matches.push(item);
    idToItems.set(videoId, matches);
  }
  if (idToItems.size === 0) return;

  const params = new URLSearchParams({
    part: "snippet",
    id: [...idToItems.keys()].join(","),
    fields: "items(id,snippet(channelTitle))",
    key: env.youtube.apiKey,
  });

  try {
    const timeoutSignal = AbortSignal.timeout(AUTHOR_LOOKUP_TIMEOUT_MS);
    const response = await fetch(`${YOUTUBE_VIDEOS_URL}?${params.toString()}`, {
      signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
    });
    if (!response.ok) {
      logger.warn("YouTube author lookup failed (non-fatal)", {
        status: response.status,
        videos: idToItems.size,
      });
      return;
    }

    const data: YouTubeVideoResponse = await response.json();
    for (const video of data.items ?? []) {
      const author = cleanAuthor(video.snippet?.channelTitle);
      if (!video.id || !author) continue;
      for (const item of idToItems.get(video.id) ?? []) {
        item.author = author;
      }
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    logger.warn("YouTube author lookup failed (non-fatal)", {
      error: error instanceof Error ? error.message : String(error),
      videos: idToItems.size,
    });
  }
}

function extractNaverPathAuthor(pathname: string): string | undefined {
  const first = pathname.split("/").filter(Boolean)[0];
  if (
    !first ||
    first.toLowerCase().endsWith(".naver") ||
    ["prologue", "mylog"].includes(first.toLowerCase())
  ) {
    return undefined;
  }
  return decodeURIComponent(first);
}

function extractBrunchTitleAuthor(title?: string): string | undefined {
  if (!title) return undefined;
  const parts = title
    .split(/[|｜]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const brunchIndex = parts.findIndex((part) =>
    /^(브런치|brunch(?:story)?)$/i.test(part)
  );
  if (brunchIndex > 0) return parts[brunchIndex - 1];

  return title.match(/^(.+?)의\s+브런치(?:스토리)?$/)?.[1]?.trim();
}

function extractInstagramAuthor(
  title?: string,
  description?: string,
): string | undefined {
  const text = [title, description].filter(Boolean).join(" ");
  const handle = text.match(
    /(?:^|[\s(\[])@([a-zA-Z0-9._]{1,30})(?=$|[\s)\],:•|])/,
  )?.[1];
  if (handle) return cleanAuthor(`@${handle}`);

  const titledAuthor = title?.match(
    /^(.+?)\s+(?:on Instagram|•\s*Instagram|\|\s*Instagram)(?::|$)/i,
  )?.[1];
  return cleanAuthor(titledAuthor);
}

function extractYouTubeVideoId(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "youtu.be") {
      return parsed.pathname.split("/").filter(Boolean)[0];
    }
    const shortsId = parsed.pathname.match(/^\/shorts\/([^/?#]+)/)?.[1];
    return shortsId ?? parsed.searchParams.get("v") ?? undefined;
  } catch {
    return undefined;
  }
}

function cleanAuthor(value?: string | null): string | undefined {
  const normalized = value
    ?.replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || normalized.length > MAX_AUTHOR_LENGTH) return undefined;
  if (
    /^(youtube|instagram|tiktok|naver|네이버|브런치|brunch|tistory|티스토리)$/i
      .test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

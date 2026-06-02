// GEO 엔티티 관리 Edge Function
// 브랜드·제품 등 추적 대상 엔티티와 키워드를 CRUD한다.
//
// POST ?action=register-entity   { user_id, name, self_domain?, type? }
// GET  ?action=list-entities     &user_id=...
// POST ?action=delete-entity     { user_id, entity_id }
// POST ?action=add-keyword       { user_id, entity_id, keyword, intent? }
// GET  ?action=list-keywords     &entity_id=...
// POST ?action=delete-keyword    { user_id, keyword_id }
// GET  ?action=timeline          &keyword_id=...&self_domain?=...&limit?=...

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, errorToResponse, ValidationError } from '../_core/errors.ts';
import { logger } from '../_core/logger.ts';
import {
  registerEntity,
  listEntities,
  deleteEntity,
  addTrackedKeyword,
  listTrackedKeywords,
  deleteTrackedKeyword,
  getKeywordTimelineWithSelf,
  getNoiseFloorHistory,
} from '../_geo/db.ts';
import type { GeoEntity } from '../_geo/db.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');

    switch (action) {
      case 'register-entity':  return await handleRegisterEntity(req);
      case 'list-entities':    return await handleListEntities(url);
      case 'delete-entity':    return await handleDeleteEntity(req);
      case 'add-keyword':      return await handleAddKeyword(req);
      case 'list-keywords':    return await handleListKeywords(url);
      case 'delete-keyword':   return await handleDeleteKeyword(req);
      case 'timeline':         return await handleTimeline(url);
      case 'noise-history':    return await handleNoiseHistory(url);
      default:
        throw new ValidationError(`Unknown action: ${action}`);
    }
  } catch (error) {
    logger.error('geo-entities error', error);
    return errorToResponse(error);
  }
});

// ── 엔티티 ───────────────────────────────────────────────────────────────────

async function handleRegisterEntity(req: Request): Promise<Response> {
  if (req.method !== 'POST') throw new ValidationError('POST required');

  const body = await req.json();
  const userId = str(body?.user_id);
  const name = str(body?.name);
  const selfDomain = typeof body?.self_domain === 'string' ? body.self_domain.trim() : undefined;
  const type = typeof body?.type === 'string' ? body.type : 'brand';

  if (!userId) throw new ValidationError('user_id required');
  if (!name)   throw new ValidationError('name required', '엔티티 이름을 입력해주세요.');
  if (!['brand', 'website', 'product', 'person'].includes(type)) {
    throw new ValidationError('type must be brand | website | product | person');
  }

  const entity = await registerEntity(userId, name, selfDomain, type as GeoEntity['type']);
  logger.info('Entity registered', { entity_id: entity.id, name, user_id: userId });
  return jsonRes(entity);
}

async function handleListEntities(url: URL): Promise<Response> {
  const userId = url.searchParams.get('user_id')?.trim() ?? '';
  if (!userId) throw new ValidationError('user_id required');
  const entities = await listEntities(userId);
  return jsonRes({ entities });
}

async function handleDeleteEntity(req: Request): Promise<Response> {
  if (req.method !== 'POST') throw new ValidationError('POST required');
  const body = await req.json();
  const userId = str(body?.user_id);
  const entityId = str(body?.entity_id);
  if (!userId)   throw new ValidationError('user_id required');
  if (!entityId) throw new ValidationError('entity_id required');
  await deleteEntity(entityId, userId);
  return jsonRes({ success: true });
}

// ── 키워드 ───────────────────────────────────────────────────────────────────

async function handleAddKeyword(req: Request): Promise<Response> {
  if (req.method !== 'POST') throw new ValidationError('POST required');

  const body = await req.json();
  const userId   = str(body?.user_id);
  const entityId = str(body?.entity_id);
  const keyword  = str(body?.keyword);
  const intent   = typeof body?.intent === 'string' ? body.intent : 'recommend';

  if (!userId)   throw new ValidationError('user_id required');
  if (!entityId) throw new ValidationError('entity_id required');
  if (!keyword)  throw new ValidationError('keyword required', '키워드를 입력해주세요.');
  if (!['recommend', 'info', 'compare'].includes(intent)) {
    throw new ValidationError('intent must be recommend | info | compare');
  }

  const kw = await addTrackedKeyword(entityId, userId, keyword, intent as any);
  logger.info('Tracked keyword added', { keyword_id: kw.id, keyword, entity_id: entityId });
  return jsonRes(kw);
}

async function handleListKeywords(url: URL): Promise<Response> {
  const entityId = url.searchParams.get('entity_id')?.trim() ?? '';
  if (!entityId) throw new ValidationError('entity_id required');
  const keywords = await listTrackedKeywords(entityId);
  return jsonRes({ keywords });
}

async function handleDeleteKeyword(req: Request): Promise<Response> {
  if (req.method !== 'POST') throw new ValidationError('POST required');
  const body = await req.json();
  const userId    = str(body?.user_id);
  const keywordId = str(body?.keyword_id);
  if (!userId)    throw new ValidationError('user_id required');
  if (!keywordId) throw new ValidationError('keyword_id required');
  await deleteTrackedKeyword(keywordId, userId);
  return jsonRes({ success: true });
}

// ── 타임라인 ─────────────────────────────────────────────────────────────────

async function handleTimeline(url: URL): Promise<Response> {
  const keywordId  = url.searchParams.get('keyword_id')?.trim() ?? '';
  const selfDomain = url.searchParams.get('self_domain')?.trim() ?? '';
  const limit      = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)));

  if (!keywordId) throw new ValidationError('keyword_id required');

  const timeline = await getKeywordTimelineWithSelf(keywordId, selfDomain, limit);
  return jsonRes({ timeline });
}

// ── 노이즈 바닥 이력 ─────────────────────────────────────────────────────────

async function handleNoiseHistory(url: URL): Promise<Response> {
  const keywordId = url.searchParams.get('keyword_id')?.trim() ?? '';
  const limit     = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)));
  if (!keywordId) throw new ValidationError('keyword_id required');
  const history = await getNoiseFloorHistory(keywordId, limit);
  return jsonRes({ history });
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function jsonRes(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

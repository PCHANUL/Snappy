// 들어오는 요청 검증
// 노션 웹훅 페이로드를 SearchRequest 타입으로 변환

import { ValidationError } from './errors.ts';
import type { Platform, Period, SearchRequest } from './types.ts';

const VALID_PLATFORMS: Platform[] = ['naver_blog', 'youtube', 'tistory', 'brunch'];
const VALID_PERIODS: Period[] = ['day', 'week', 'month', 'year'];
const VALID_COUNTS = [5, 10, 20];

// webhook body 최소 검증 — user_id + notion_page_id만 필요
export function validateMinimalRequest(body: any): { user_id: string; notion_page_id: string } {
  if (!body || typeof body !== 'object') throw new ValidationError('Invalid request body');
  if (!body.user_id || typeof body.user_id !== 'string') {
    throw new ValidationError('user_id is required', '사용자 정보가 누락되었습니다.');
  }
  if (!body.notion_page_id || typeof body.notion_page_id !== 'string') {
    throw new ValidationError('notion_page_id is required', '노션 페이지 정보가 누락되었습니다.');
  }
  return { user_id: body.user_id, notion_page_id: body.notion_page_id };
}

export function validateSearchRequest(body: any): SearchRequest {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Invalid request body');
  }

  // user_id
  if (!body.user_id || typeof body.user_id !== 'string') {
    throw new ValidationError('user_id is required', '사용자 정보가 누락되었습니다.');
  }

  // notion_page_id
  if (!body.notion_page_id || typeof body.notion_page_id !== 'string') {
    throw new ValidationError(
      'notion_page_id is required',
      '노션 페이지 정보가 누락되었습니다.',
    );
  }

  // keyword
  if (!body.keyword || typeof body.keyword !== 'string') {
    throw new ValidationError('keyword is required', '검색 키워드를 입력해주세요.');
  }
  const keyword = body.keyword.trim();
  if (keyword.length === 0) {
    throw new ValidationError('keyword cannot be empty', '검색 키워드를 입력해주세요.');
  }
  if (keyword.length > 100) {
    throw new ValidationError('keyword too long', '키워드는 100자 이내로 입력해주세요.');
  }

  // platforms
  if (!Array.isArray(body.platforms) || body.platforms.length === 0) {
    throw new ValidationError(
      'platforms must be a non-empty array',
      '하나 이상의 매체를 선택해주세요.',
    );
  }

  const platforms = body.platforms.filter((p: any): p is Platform =>
    VALID_PLATFORMS.includes(p),
  );

  if (platforms.length === 0) {
    throw new ValidationError(
      'no valid platforms',
      '유효한 매체를 선택해주세요.',
    );
  }

  // period (선택, 기본값 month)
  let period: Period = 'month';
  if (body.period) {
    if (!VALID_PERIODS.includes(body.period)) {
      throw new ValidationError(`invalid period: ${body.period}`);
    }
    period = body.period;
  }

  // result_count (선택, 기본값 10)
  let result_count = 10;
  if (body.result_count !== undefined) {
    const count = Number(body.result_count);
    if (!VALID_COUNTS.includes(count)) {
      throw new ValidationError(`invalid result_count: ${body.result_count}`);
    }
    result_count = count;
  }

  return {
    user_id: body.user_id,
    notion_page_id: body.notion_page_id,
    keyword,
    platforms,
    period,
    result_count,
  };
}

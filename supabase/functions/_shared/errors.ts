// 커스텀 에러 클래스
// 에러 발생 위치 추적 + 사용자 안내 메시지 분리

export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public userMessage?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, userMessage?: string) {
    super(message, 'VALIDATION_ERROR', 400, userMessage || message);
  }
}

export class AuthError extends AppError {
  constructor(message: string = 'Authentication failed') {
    super(message, 'AUTH_ERROR', 401, '인증에 실패했습니다.');
  }
}

export class QuotaExceededError extends AppError {
  constructor(limit: number) {
    super(
      `Daily quota exceeded: ${limit}`,
      'QUOTA_EXCEEDED',
      429,
      `일일 검색 한도(${limit}회)를 초과했습니다.`,
    );
  }
}

export class ExternalApiError extends AppError {
  constructor(api: string, message: string) {
    super(`${api} API error: ${message}`, 'EXTERNAL_API_ERROR', 502);
  }
}

export class NotionApiError extends AppError {
  constructor(message: string) {
    super(`Notion API error: ${message}`, 'NOTION_ERROR', 502, '노션 API 호출에 실패했습니다.');
  }
}

// CORS 헤더
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

// 에러를 HTTP 응답으로 변환
export function errorToResponse(error: unknown): Response {
  if (error instanceof AppError) {
    return new Response(
      JSON.stringify({
        error: error.code,
        message: error.userMessage || error.message,
      }),
      {
        status: error.statusCode,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }

  const message = error instanceof Error ? error.message : 'Unknown error';
  return new Response(
    JSON.stringify({ error: 'INTERNAL_ERROR', message: '서버 오류가 발생했습니다.' }),
    {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  );
}

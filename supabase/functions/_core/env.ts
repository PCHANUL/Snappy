// 환경 변수 중앙 관리
// 모든 환경 변수는 이 파일을 통해 접근

function required(key: string): string {
  const value = Deno.env.get(key);
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optional(key: string, fallback: string): string {
  return Deno.env.get(key) || fallback;
}

export const env = {
  supabase: {
    url: required('SUPABASE_URL'),
    anonKey: required('SUPABASE_ANON_KEY'),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  },
  naver: {
    clientId: required('NAVER_CLIENT_ID'),
    clientSecret: required('NAVER_CLIENT_SECRET'),
  },
  youtube: {
    apiKey: required('YOUTUBE_API_KEY'),
  },
  youcom: {
    apiKey: required('YOUCOM_API_KEY'),
  },
  security: {
    notionKeyEncryptionSecret: required('NOTION_KEY_ENCRYPTION_SECRET'),
  },
  app: {
    environment: optional('ENVIRONMENT', 'development'),
    logLevel: optional('LOG_LEVEL', 'info'),
  },
  admin: {
    secret: optional('ADMIN_SECRET', ''),
  },
  anthropic: {
    apiKey: optional('ANTHROPIC_API_KEY', ''),
  },
  instagram: {
    accessToken: optional('INSTAGRAM_ACCESS_TOKEN', ''),
    businessAccountId: optional('INSTAGRAM_BUSINESS_ACCOUNT_ID', ''),
  },
  notion: {
    clientId: optional('NOTION_CLIENT_ID', ''),
    clientSecret: optional('NOTION_CLIENT_SECRET', ''),
    redirectUri: optional('NOTION_REDIRECT_URI', ''),
  },
};

export const isDev = env.app.environment === 'development';

// 구조화된 로깅
// JSON 형식으로 출력해 Supabase 로그에서 검색 용이

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogMeta {
  [key: string]: any;
}

function log(level: LogLevel, msg: string, meta?: LogMeta) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    msg,
    ...meta,
  };

  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

export const logger = {
  info: (msg: string, meta?: LogMeta) => log('info', msg, meta),
  warn: (msg: string, meta?: LogMeta) => log('warn', msg, meta),
  debug: (msg: string, meta?: LogMeta) => log('debug', msg, meta),
  error: (msg: string, error?: Error | unknown, meta?: LogMeta) => {
    const errorMeta = error instanceof Error
      ? { error: error.message, stack: error.stack }
      : { error: String(error) };
    log('error', msg, { ...errorMeta, ...meta });
  },
};

// 구조화된 로깅 — LOG_LEVEL 환경변수로 출력 레벨 제어
// LOG_LEVEL=debug|info|warn|error (기본: info)

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogMeta {
  [key: string]: any;
}

const PRIORITY: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const configuredLevel = (Deno.env.get('LOG_LEVEL') || 'info') as LogLevel;
const minPriority = PRIORITY[configuredLevel] ?? 1;

function log(level: LogLevel, msg: string, meta?: LogMeta) {
  if (PRIORITY[level] < minPriority) return;

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
  info:  (msg: string, meta?: LogMeta) => log('info', msg, meta),
  warn:  (msg: string, meta?: LogMeta) => log('warn', msg, meta),
  debug: (msg: string, meta?: LogMeta) => log('debug', msg, meta),
  error: (msg: string, error?: Error | unknown, meta?: LogMeta) => {
    const errorMeta = error instanceof Error
      ? { error: error.message, stack: error.stack }
      : error !== undefined ? { error: String(error) } : {};
    log('error', msg, { ...errorMeta, ...meta });
  },
};

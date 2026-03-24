import path from 'node:path';

type AppEnvironment = 'development' | 'production' | 'test';

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveEnvironment(value: string | undefined): AppEnvironment {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'production' || normalized === 'test') {
    return normalized;
  }
  return 'development';
}

const env = resolveEnvironment(process.env.NODE_ENV);
const defaultDbPath = env === 'production'
  ? '/data/router.sqlite'
  : path.join(process.cwd(), 'router.sqlite');

export const appConfig = {
  env,
  isDevelopment: env === 'development',
  isProduction: env === 'production',
  isTest: env === 'test',
  host: process.env.HOST?.trim() || '0.0.0.0',
  port: parseNumber(process.env.PORT, 3000),
  logLevel: process.env.LOG_LEVEL?.trim() || (env === 'production' ? 'info' : 'debug'),
  prettyLogs: parseBoolean(process.env.PRETTY_LOGS, env !== 'production' && env !== 'test'),
  dbPath: process.env.ROUTER_DB_PATH?.trim() || defaultDbPath,
  responseCacheEnabled: parseBoolean(process.env.RESPONSE_CACHE_ENABLED, true),
  responseCacheBackend: (process.env.RESPONSE_CACHE_BACKEND?.trim().toLowerCase() || 'hybrid') as 'memory' | 'sqlite' | 'hybrid',
  responseCacheTtlSeconds: parseNumber(process.env.RESPONSE_CACHE_TTL_SECONDS, 300),
} as const;

export type { AppEnvironment };

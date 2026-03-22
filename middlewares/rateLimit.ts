import { logger } from '../utils/logger';

interface RateLimitToken {
  count: number;
  resetAt: number;
}

const map = new Map<string, RateLimitToken>();
const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX) || 50; // Max 50 request per minute per IP by default

export function isRateLimited(ip: string): boolean {
  const now = Date.now();
  let record = map.get(ip);

  if (!record || record.resetAt <= now) {
    record = { count: 1, resetAt: now + WINDOW_MS };
    map.set(ip, record);
    return false;
  }

  if (record.count >= MAX_REQUESTS) {
    logger.warn({ ip, attempts: record.count }, `Rate limit exceeded para IP: ${ip}`);
    return true; // Is rate limited
  }

  record.count++;
  return false;
}

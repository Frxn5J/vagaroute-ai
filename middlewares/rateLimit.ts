import { checkAndIncrementRequestRateLimit, type RequestRateLimitResult } from '../core/db';
import { logger } from '../utils/logger';

export type RateLimitResult = RequestRateLimitResult;

const WINDOW_MS = 60_000;

export function checkRateLimit(key: string, limit: number): RateLimitResult {
  const result = checkAndIncrementRequestRateLimit(key, limit, WINDOW_MS);
  if (result.limited) {
    logger.warn({ key, limit: result.limit, resetAt: result.resetAt }, 'Rate limit exceeded');
  }
  return result;
}

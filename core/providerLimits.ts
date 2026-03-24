import {
  getProviderCooldownMap,
  getProviderUsageSnapshots,
  getRateLimitRulesMap,
  setProviderRateLimited,
} from './db';
import { emptyUsageSnapshot, evaluateRateLimit, normalizeProviderId, type UsageEstimate } from './usageLimits';

export function ensureProviderLimitAvailable(providerId: string, estimate: UsageEstimate): void {
  const normalizedProviderId = normalizeProviderId(providerId);
  const now = Date.now();
  const providerCooldown = getProviderCooldownMap().get(normalizedProviderId);
  if ((providerCooldown?.cooldownUntil ?? 0) > now) {
    const retryAfter = Math.max(1, Math.ceil(((providerCooldown?.cooldownUntil ?? now) - now) / 1_000));
    throw Object.assign(
      new Error(`El proveedor '${normalizedProviderId}' esta en cooldown. Reintenta en ${retryAfter}s.`),
      { code: 'rate_limit_exceeded', httpStatus: 429, retryAfter },
    );
  }

  const rule = getRateLimitRulesMap('provider').get(normalizedProviderId);
  if (!rule) {
    return;
  }

  const usage = getProviderUsageSnapshots([normalizedProviderId]).get(normalizedProviderId) ?? emptyUsageSnapshot();
  const evaluation = evaluateRateLimit(rule, usage, estimate);
  if (!evaluation.blocked) {
    return;
  }

  setProviderRateLimited(normalizedProviderId, evaluation.until, evaluation.reasons.join(' | '));
  const retryAfter = Math.max(1, Math.ceil((evaluation.until - now) / 1_000));
  throw Object.assign(
    new Error(`El proveedor '${normalizedProviderId}' alcanzo su limite configurado. Reintenta en ${retryAfter}s.`),
    { code: 'rate_limit_exceeded', httpStatus: 429, retryAfter },
  );
}

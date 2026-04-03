import {
  clearServiceApiKeyCooldown,
  getDecryptedServiceKeysByProvider,
  listServiceApiKeys,
  replaceServiceApiKeySecret,
  setServiceApiKeyActive,
  setServiceApiKeyCooldown,
  touchServiceApiKey,
} from './db';
import { logger } from '../utils/logger';
import { encryptSecret, hashToken, maskSecret } from '../utils/crypto';

export type ProviderName =
  | 'alibaba'
  | 'cerebras'
  | 'codestral'
  | 'cohere'
  | 'gemini'
  | 'groq'
  | 'mistral'
  | 'nvidia'
  | 'openrouter'
  | 'pollinations'
  | 'puter'
  | 'qwenchat'
  | 'witai';

export interface ProviderKeyCandidate {
  provider: ProviderName;
  key: string;
  source: 'db' | 'env';
  id?: string;
  label: string;
  priority: number;
  metadata?: Record<string, unknown>;
}

export interface ConfiguredProviderKeyRecord {
  id: string;
  provider: string;
  name: string;
  keyHint: string;
  priority: number;
  isActive: boolean;
  cooldownUntil: number;
  failCount: number;
  totalRequests: number;
  lastUsedAt: number | null;
  lastError: string | null;
  createdAt: number;
  source: 'db' | 'system';
  isReadonly: boolean;
}

const ENV_PROVIDER_KEYS: Record<ProviderName, { envName: string; metadata?: Record<string, unknown> }[]> = {
  alibaba: [{ envName: 'ALIBABA_API_KEY' }],
  cerebras: [{ envName: 'CEREBRAS_API_KEY' }],
  codestral: [
    { envName: 'CODESTRAL_API_KEY', metadata: { dedicatedEndpoint: true } },
    { envName: 'MISTRAL_API_KEY', metadata: { dedicatedEndpoint: false } },
  ],
  cohere: [{ envName: 'COHERE_API_KEY' }],
  gemini: [{ envName: 'GEMINI_API_KEY' }],
  groq: [{ envName: 'GROQ_API_KEY' }],
  mistral: [{ envName: 'MISTRAL_API_KEY' }],
  nvidia: [{ envName: 'NVIDIA_API_KEY' }],
  openrouter: [{ envName: 'OPENROUTER_API_KEY' }],
  pollinations: [{ envName: 'POLLINATIONS_API_KEY' }],
  puter: [{ envName: 'puterAuthToken' }, { envName: 'PUTER_API_KEY' }],
  qwenchat: [{ envName: 'QWEN_CHAT_API_KEY' }, { envName: 'QWEN_API_KEY' }],
  witai: [{ envName: 'WITAI_API_KEY' }],
};

const HOUR_MS = 60 * 60_000;
const QWEN_REFRESH_THRESHOLD_MS = 10 * 60_000;
const QWEN_REFRESH_TIMEOUT_MS = 10_000;
const QWEN_REFRESH_URL = 'https://qwen.aikit.club/v1/refresh';
const envCooldowns = new Map<string, number>();
const runtimeEnvProviderKeys = new Map<string, string>();
const qwenRefreshInFlight = new Map<string, Promise<ProviderKeyCandidate>>();

function getCandidateRuntimeKey(provider: ProviderName, label: string): string {
  return `${provider}:${label}:runtime`;
}

function candidateKey(provider: ProviderName, label: string): string {
  return `${provider}:${label}`;
}

function parseJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }

  try {
    const payloadPart = parts[1];
    if (!payloadPart) {
      return null;
    }

    const base64 = payloadPart
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(payloadPart.length / 4) * 4, '=');
    const raw = Buffer.from(base64, 'base64').toString('utf8');
    const payload = JSON.parse(raw) as Record<string, unknown>;
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

function getJwtExpiry(token: string): number | null {
  const exp = parseJwtPayload(token)?.exp;
  return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1_000 : null;
}

function shouldRefreshQwenToken(token: string): { shouldRefresh: boolean; expiresAt: number | null } {
  const expiresAt = getJwtExpiry(token);
  if (!expiresAt) {
    return { shouldRefresh: false, expiresAt: null };
  }

  return {
    shouldRefresh: expiresAt - Date.now() <= QWEN_REFRESH_THRESHOLD_MS,
    expiresAt,
  };
}

function getRefreshTokenFromPayload(payload: unknown): string | null {
  if (typeof payload === 'string' && payload.trim()) {
    return payload.trim();
  }

  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const candidates: unknown[] = [
    record.token,
    record.access_token,
    record.accessToken,
    record.api_key,
    record.apiKey,
    record.jwt,
    record.data,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
    if (candidate && typeof candidate === 'object') {
      const nested = getRefreshTokenFromPayload(candidate);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

function getRefreshErrorMessage(status: number, payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message.trim();
    }
    if (record.error && typeof record.error === 'object') {
      const nested = record.error as Record<string, unknown>;
      if (typeof nested.message === 'string' && nested.message.trim()) {
        return nested.message.trim();
      }
    }
  }

  if (typeof payload === 'string' && payload.trim()) {
    return payload.trim().slice(0, 240);
  }

  return `Qwen refresh HTTP ${status}`;
}

async function requestQwenTokenRefresh(token: string): Promise<string> {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  let response = await fetch(QWEN_REFRESH_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ token }),
    signal: AbortSignal.timeout(QWEN_REFRESH_TIMEOUT_MS),
  });

  let contentType = response.headers.get('content-type') || '';
  let payload: unknown = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    response = await fetch(`${QWEN_REFRESH_URL}?token=${encodeURIComponent(token)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(QWEN_REFRESH_TIMEOUT_MS),
    });

    contentType = response.headers.get('content-type') || '';
    payload = contentType.includes('application/json')
      ? await response.json()
      : await response.text();
  }

  if (!response.ok) {
    throw Object.assign(new Error(getRefreshErrorMessage(response.status, payload)), {
      status: response.status,
    });
  }

  const refreshedToken = getRefreshTokenFromPayload(payload);
  if (!refreshedToken) {
    throw new Error('Qwen refresh no devolvio un token utilizable');
  }

  return refreshedToken;
}

function persistDbCandidateKey(candidate: ProviderKeyCandidate, nextToken: string): void {
  if (!candidate.id) {
    return;
  }

  const encrypted = encryptSecret(nextToken);
  replaceServiceApiKeySecret(candidate.id, {
    keyHash: hashToken(nextToken),
    keyHint: maskSecret(nextToken),
    encryptedValue: encrypted.ciphertext,
    valueIv: encrypted.iv,
    valueTag: encrypted.tag,
  });
}

function persistEnvCandidateKey(candidate: ProviderKeyCandidate, nextToken: string): void {
  runtimeEnvProviderKeys.set(getCandidateRuntimeKey(candidate.provider, candidate.label), nextToken);
}

async function maybeRefreshQwenCandidate(candidate: ProviderKeyCandidate): Promise<ProviderKeyCandidate> {
  const { shouldRefresh, expiresAt } = shouldRefreshQwenToken(candidate.key);
  if (!shouldRefresh) {
    return candidate;
  }

  const refreshKey = candidate.id ?? candidateKey(candidate.provider, candidate.label);
  const existing = qwenRefreshInFlight.get(refreshKey);
  if (existing) {
    return await existing;
  }

  const refreshPromise = (async () => {
    try {
      const nextToken = await requestQwenTokenRefresh(candidate.key);
      if (!nextToken || nextToken === candidate.key) {
        return candidate;
      }

      if (candidate.source === 'db' && candidate.id) {
        persistDbCandidateKey(candidate, nextToken);
      } else {
        persistEnvCandidateKey(candidate, nextToken);
      }

      logger.info({ provider: candidate.provider, candidate: candidate.label, source: candidate.source }, 'Qwen token refreshed before expiry');
      return {
        ...candidate,
        key: nextToken,
      };
    } catch (err) {
      if (expiresAt && expiresAt > Date.now()) {
        logger.warn({ provider: candidate.provider, candidate: candidate.label, source: candidate.source, err }, 'Qwen token refresh failed before expiry; using current token');
        return candidate;
      }
      throw err;
    } finally {
      qwenRefreshInFlight.delete(refreshKey);
    }
  })();

  qwenRefreshInFlight.set(refreshKey, refreshPromise);
  return await refreshPromise;
}

async function prepareProviderCandidate(candidate: ProviderKeyCandidate): Promise<ProviderKeyCandidate> {
  if (candidate.provider !== 'qwenchat') {
    return candidate;
  }

  return await maybeRefreshQwenCandidate(candidate);
}

function getStatusFromError(err: unknown): number {
  const value = err as {
    status?: number;
    statusCode?: number;
    response?: { status?: number };
    error?: { status?: number };
    cause?: { status?: number };
    message?: string;
  };

  return (
    value?.status ??
    value?.statusCode ??
    value?.response?.status ??
    value?.error?.status ??
    value?.cause?.status ??
    Number.parseInt(value?.message?.match(/\b(\d{3})\b/)?.[1] ?? '0', 10)
  );
}

function getHeader(err: unknown, key: string): string | null {
  const value = err as {
    headers?: Record<string, string> | Headers;
    response?: { headers?: Record<string, string> | Headers };
  };
  const headers = value?.headers ?? value?.response?.headers;
  if (!headers) {
    return null;
  }

  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(key);
  }

  const record = headers as Record<string, string>;
  return record[key] ?? record[key.toLowerCase()] ?? null;
}

function getRetryAfterMs(err: unknown): number | null {
  const retryHeader = getHeader(err, 'retry-after')
    ?? getHeader(err, 'x-ratelimit-reset')
    ?? getHeader(err, 'x-ratelimit-reset-requests');

  if (!retryHeader) {
    return null;
  }

  const numeric = Number.parseFloat(retryHeader);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  if (numeric > 1_000_000_000) {
    return Math.max(1_000, numeric * 1_000 - Date.now());
  }

  return numeric * 1_000;
}

function classifyProviderFailure(err: unknown): {
  retryWithNextKey: boolean;
  cooldownMs: number;
  disable: boolean;
  reason: string;
} {
  const status = getStatusFromError(err);
  const message = ((err as { message?: string })?.message ?? 'Provider key failed').toLowerCase();

  if (status === 429) {
    return {
      retryWithNextKey: true,
      cooldownMs: getRetryAfterMs(err) ?? 15 * 60_000,
      disable: false,
      reason: 'Rate limited',
    };
  }

  if (
    status === 402
    || message.includes('insufficient_quota')
    || message.includes('quota')
    || message.includes('credit')
    || message.includes('billing')
  ) {
    return {
      retryWithNextKey: true,
      cooldownMs: 24 * HOUR_MS,
      disable: false,
      reason: 'Quota exhausted',
    };
  }

  if (status === 401 || status === 403) {
    return {
      retryWithNextKey: true,
      cooldownMs: 24 * HOUR_MS,
      disable: true,
      reason: 'Unauthorized key',
    };
  }

  return {
    retryWithNextKey: false,
    cooldownMs: 0,
    disable: false,
    reason: 'Unhandled provider error',
  };
}

function getEnvCandidates(provider: ProviderName): ProviderKeyCandidate[] {
  const now = Date.now();
  const seen = new Set<string>();
  const candidates: ProviderKeyCandidate[] = [];

  for (const spec of ENV_PROVIDER_KEYS[provider] ?? []) {
    const runtimeKey = runtimeEnvProviderKeys.get(getCandidateRuntimeKey(provider, spec.envName));
    const raw = runtimeKey?.trim() || process.env[spec.envName]?.trim();
    if (!raw || seen.has(raw)) {
      continue;
    }

    const key = candidateKey(provider, spec.envName);
    const cooldownUntil = envCooldowns.get(key) ?? 0;
    if (cooldownUntil > now) {
      continue;
    }

    seen.add(raw);
    candidates.push({
      provider,
      key: raw,
      source: 'env',
      label: spec.envName,
      priority: 10_000 + candidates.length,
      metadata: spec.metadata,
    });
  }

  return candidates;
}

function listSystemProviderKeys(): ConfiguredProviderKeyRecord[] {
  const now = Date.now();
  const records: ConfiguredProviderKeyRecord[] = [];

  for (const [provider, specs] of Object.entries(ENV_PROVIDER_KEYS) as Array<
    [ProviderName, { envName: string; metadata?: Record<string, unknown> }[]]
  >) {
    const seen = new Set<string>();

    for (const [index, spec] of specs.entries()) {
      const runtimeKey = runtimeEnvProviderKeys.get(getCandidateRuntimeKey(provider, spec.envName));
      const raw = runtimeKey?.trim() || process.env[spec.envName]?.trim();
      if (!raw || seen.has(raw)) {
        continue;
      }

      seen.add(raw);
      const cooldownUntil = envCooldowns.get(candidateKey(provider, spec.envName)) ?? 0;
      const metadataSuffix = spec.metadata?.dedicatedEndpoint === false ? ' (fallback)' : '';

      records.push({
        id: `system:${provider}:${spec.envName}`,
        provider,
        name: `System: ${spec.envName}${metadataSuffix}`,
        keyHint: spec.envName,
        priority: 10_000 + index,
        isActive: true,
        cooldownUntil,
        failCount: 0,
        totalRequests: 0,
        lastUsedAt: null,
        lastError: cooldownUntil > now ? 'Cooldown temporal por error del proveedor' : null,
        createdAt: 0,
        source: 'system',
        isReadonly: true,
      });
    }
  }

  return records.sort((left, right) => {
    if (left.provider !== right.provider) {
      return left.provider.localeCompare(right.provider);
    }
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }
    return left.name.localeCompare(right.name);
  });
}

export function listConfiguredProviderKeys(): ConfiguredProviderKeyRecord[] {
  const dbRecords: ConfiguredProviderKeyRecord[] = listServiceApiKeys().map((item) => ({
    ...item,
    source: 'db',
    isReadonly: false,
  }));

  return [...dbRecords, ...listSystemProviderKeys()];
}

export function getProviderKeyCandidates(provider: ProviderName): ProviderKeyCandidate[] {
  const dbCandidates = getDecryptedServiceKeysByProvider(provider).map((item) => ({
    provider,
    key: item.value,
    source: 'db' as const,
    id: item.id,
    label: item.name,
    priority: item.priority,
    metadata: provider === 'codestral' ? { dedicatedEndpoint: true } : undefined,
  }));

  const seen = new Set(dbCandidates.map((item) => item.key));
  const envCandidates = getEnvCandidates(provider).filter((item) => !seen.has(item.key));

  return [...dbCandidates, ...envCandidates];
}

export async function withProviderKey<T>(
  provider: ProviderName,
  operation: (candidate: ProviderKeyCandidate) => Promise<T>,
): Promise<T> {
  const candidates = getProviderKeyCandidates(provider);
  if (candidates.length === 0) {
    throw Object.assign(new Error(`No hay API keys configuradas para ${provider}`), {
      code: 'provider_key_missing',
      httpStatus: 503,
    });
  }

  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      const preparedCandidate = await prepareProviderCandidate(candidate);
      const result = await operation(preparedCandidate);
      if (preparedCandidate.id) {
        clearServiceApiKeyCooldown(preparedCandidate.id);
        touchServiceApiKey(preparedCandidate.id);
      } else {
        envCooldowns.delete(candidateKey(provider, preparedCandidate.label));
      }
      return result;
    } catch (err) {
      lastError = err;
      const classification = classifyProviderFailure(err);
      logger.warn(
        { provider, candidate: candidate.label, source: candidate.source, classification, err },
        'Provider key attempt failed',
      );

      if (candidate.id) {
        if (classification.disable) {
          setServiceApiKeyActive(candidate.id, false, classification.reason);
        } else if (classification.cooldownMs > 0) {
          setServiceApiKeyCooldown(candidate.id, Date.now() + classification.cooldownMs, classification.reason);
        }
      } else if (classification.cooldownMs > 0) {
        envCooldowns.set(candidateKey(provider, candidate.label), Date.now() + classification.cooldownMs);
      }

      if (!classification.retryWithNextKey) {
        throw err;
      }
    }
  }

  throw lastError ?? new Error(`All keys failed for provider ${provider}`);
}

import {
  clearServiceApiKeyCooldown,
  getDecryptedServiceKeysByProvider,
  listServiceApiKeys,
  setServiceApiKeyActive,
  setServiceApiKeyCooldown,
  touchServiceApiKey,
} from './db';
import { logger } from '../utils/logger';

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
  witai: [{ envName: 'WITAI_API_KEY' }],
};

const HOUR_MS = 60 * 60_000;
const envCooldowns = new Map<string, number>();

function candidateKey(provider: ProviderName, label: string): string {
  return `${provider}:${label}`;
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
    const raw = process.env[spec.envName]?.trim();
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
      const raw = process.env[spec.envName]?.trim();
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
      const result = await operation(candidate);
      if (candidate.id) {
        clearServiceApiKeyCooldown(candidate.id);
        touchServiceApiKey(candidate.id);
      } else {
        envCooldowns.delete(candidateKey(provider, candidate.label));
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

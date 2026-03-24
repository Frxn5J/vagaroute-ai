import type { ChatRequest } from '../types';
import { estimateMessageTokens, estimateTextTokens } from './tokenizer';

export type RateLimitMode = 'none' | 'tokens' | 'groq';

export interface UsageEstimate {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  audioSeconds: number;
}

export interface LimitRuleLike {
  mode: RateLimitMode;
  rpm: number | null;
  rpd: number | null;
  tpm: number | null;
  tpd: number | null;
  ash: number | null;
  asd: number | null;
}

export interface UsageWindowSnapshot {
  requestsLastMinute: number;
  requestsLastDay: number;
  tokensLastMinute: number;
  tokensLastDay: number;
  audioSecondsLastHour: number;
  audioSecondsLastDay: number;
  firstRequestAtMinute: number | null;
  firstRequestAtDay: number | null;
  firstTokenAtMinute: number | null;
  firstTokenAtDay: number | null;
  firstAudioAtHour: number | null;
  firstAudioAtDay: number | null;
}

export interface LimitEvaluation {
  blocked: boolean;
  until: number;
  reasons: string[];
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function toPositiveInteger(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : null;
}

export function buildUsageEstimate(input: Partial<UsageEstimate>): UsageEstimate {
  const promptTokens = Math.max(0, Math.floor(input.promptTokens ?? 0));
  const completionTokens = Math.max(0, Math.floor(input.completionTokens ?? 0));
  const totalTokens = Math.max(
    0,
    Math.floor(input.totalTokens ?? promptTokens + completionTokens),
  );

  return {
    requests: Math.max(1, Math.floor(input.requests ?? 1)),
    promptTokens,
    completionTokens,
    totalTokens,
    audioSeconds: Math.max(0, Math.floor(input.audioSeconds ?? 0)),
  };
}

export function estimateChatUsage(request: ChatRequest): UsageEstimate {
  const promptTokens = (request.messages ?? []).reduce((total, message) => total + estimateMessageTokens(message), 0)
    + estimateTextTokens(JSON.stringify(request.tools ?? []));
  const completionTokens = Math.max(0, Math.floor(request.max_tokens ?? 4096));
  return buildUsageEstimate({
    requests: 1,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  });
}

export function estimateEmbeddingsUsage(input: string | string[]): UsageEstimate {
  const values = Array.isArray(input) ? input : [input];
  const promptTokens = values.reduce((total, item) => total + estimateTextTokens(String(item ?? '')), 0);
  return buildUsageEstimate({
    requests: 1,
    promptTokens,
    totalTokens: promptTokens,
  });
}

export function normalizeProviderId(value: string | null | undefined): string {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replaceAll('.', '')
    .replaceAll(' ', '')
    .replaceAll('_', '')
    .replaceAll('-', '');

  if (normalized === 'witai' || normalized === 'wit') {
    return 'witai';
  }

  return normalized;
}

export function getProviderIdFromServiceName(serviceName: string): string {
  const provider = serviceName.split('/')[0] ?? '';
  return normalizeProviderId(provider);
}

export function normalizeServiceId(serviceName: string): string {
  const [provider, ...rest] = serviceName.split('/');
  const providerId = normalizeProviderId(provider);
  const modelId = rest.join('/').trim();
  return modelId ? `${providerId}/${modelId}` : providerId;
}

export function emptyUsageSnapshot(): UsageWindowSnapshot {
  return {
    requestsLastMinute: 0,
    requestsLastDay: 0,
    tokensLastMinute: 0,
    tokensLastDay: 0,
    audioSecondsLastHour: 0,
    audioSecondsLastDay: 0,
    firstRequestAtMinute: null,
    firstRequestAtDay: null,
    firstTokenAtMinute: null,
    firstTokenAtDay: null,
    firstAudioAtHour: null,
    firstAudioAtDay: null,
  };
}

function evaluateWindow(args: {
  limit: number | null;
  current: number;
  next: number;
  firstAt: number | null;
  durationMs: number;
  label: string;
}): { blocked: boolean; until: number; reason: string | null } {
  const limit = toPositiveInteger(args.limit);
  if (!limit || args.next <= 0 || args.current + args.next <= limit) {
    return { blocked: false, until: 0, reason: null };
  }

  const until = Math.max(Date.now() + 1_000, (args.firstAt ?? Date.now()) + args.durationMs);
  return {
    blocked: true,
    until,
    reason: `${args.label} excedido (${args.current + args.next}/${limit})`,
  };
}

export function evaluateRateLimit(rule: LimitRuleLike | null | undefined, usage: UsageWindowSnapshot, estimate: UsageEstimate): LimitEvaluation {
  if (!rule || rule.mode === 'none') {
    return { blocked: false, until: 0, reasons: [] };
  }

  const checks = [];
  if (rule.mode === 'tokens' || rule.mode === 'groq') {
    checks.push(
      evaluateWindow({
        limit: rule.tpm,
        current: usage.tokensLastMinute,
        next: estimate.totalTokens,
        firstAt: usage.firstTokenAtMinute,
        durationMs: MINUTE_MS,
        label: 'TPM',
      }),
      evaluateWindow({
        limit: rule.tpd,
        current: usage.tokensLastDay,
        next: estimate.totalTokens,
        firstAt: usage.firstTokenAtDay,
        durationMs: DAY_MS,
        label: 'TPD',
      }),
    );
  }

  if (rule.mode === 'groq') {
    checks.push(
      evaluateWindow({
        limit: rule.rpm,
        current: usage.requestsLastMinute,
        next: estimate.requests,
        firstAt: usage.firstRequestAtMinute,
        durationMs: MINUTE_MS,
        label: 'RPM',
      }),
      evaluateWindow({
        limit: rule.rpd,
        current: usage.requestsLastDay,
        next: estimate.requests,
        firstAt: usage.firstRequestAtDay,
        durationMs: DAY_MS,
        label: 'RPD',
      }),
      evaluateWindow({
        limit: rule.ash,
        current: usage.audioSecondsLastHour,
        next: estimate.audioSeconds,
        firstAt: usage.firstAudioAtHour,
        durationMs: HOUR_MS,
        label: 'ASH',
      }),
      evaluateWindow({
        limit: rule.asd,
        current: usage.audioSecondsLastDay,
        next: estimate.audioSeconds,
        firstAt: usage.firstAudioAtDay,
        durationMs: DAY_MS,
        label: 'ASD',
      }),
    );
  }

  const blockedChecks = checks.filter((item) => item.blocked);
  if (blockedChecks.length === 0) {
    return { blocked: false, until: 0, reasons: [] };
  }

  return {
    blocked: true,
    until: Math.max(...blockedChecks.map((item) => item.until)),
    reasons: blockedChecks.flatMap((item) => (item.reason ? [item.reason] : [])),
  };
}

export function parseLimitNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const normalized = Math.floor(numeric);
  return normalized > 0 ? normalized : null;
}

export function sanitizeLimitRule(input: {
  mode?: unknown;
  rpm?: unknown;
  rpd?: unknown;
  tpm?: unknown;
  tpd?: unknown;
  ash?: unknown;
  asd?: unknown;
}): LimitRuleLike {
  const mode = input.mode === 'tokens' || input.mode === 'groq' ? input.mode : 'none';
  return {
    mode,
    rpm: parseLimitNumber(input.rpm),
    rpd: parseLimitNumber(input.rpd),
    tpm: parseLimitNumber(input.tpm),
    tpd: parseLimitNumber(input.tpd),
    ash: parseLimitNumber(input.ash),
    asd: parseLimitNumber(input.asd),
  };
}

export function extractAudioSecondsFromPayload(payload: unknown): number {
  const value = payload as {
    duration?: number;
    audio_duration?: number;
    seconds?: number;
    segments?: Array<{ end?: number }>;
  } | null;

  const direct = value?.duration ?? value?.audio_duration ?? value?.seconds;
  if (typeof direct === 'number' && Number.isFinite(direct) && direct > 0) {
    return Math.ceil(direct);
  }

  if (Array.isArray(value?.segments) && value.segments.length > 0) {
    const end = value.segments.reduce((highest, segment) => {
      const candidate = typeof segment?.end === 'number' && Number.isFinite(segment.end) ? segment.end : 0;
      return Math.max(highest, candidate);
    }, 0);
    if (end > 0) {
      return Math.ceil(end);
    }
  }

  return 0;
}

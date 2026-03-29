import { loadAlibabaServices } from '../services/alibaba';
import { loadCerebrasServices } from '../services/cerebras';
import { loadCodestralServices } from '../services/codestral';
import { loadCohereServices } from '../services/cohere';
import { loadCustomServices } from '../services/custom';
import { loadGeminiServices } from '../services/gemini';
import { loadGroqServices } from '../services/groq';
import { loadMistralServices } from '../services/mistral';
import { loadNvidiaServices } from '../services/nvidia';
import { loadOpenRouterServices } from '../services/openrouter';
import { loadPuterServices } from '../services/puter';
import type { AIService, ChatRequest } from '../types';
import { logger } from '../utils/logger';
import {
  getAllModelStats,
  getAppSettings,
  getModelTierOverridesMap,
  getModelUsageSnapshots,
  getProviderCooldownMap,
  getProviderUsageSnapshots,
  getRateLimitRulesMap,
  incrementModelUsage,
  setModelRateLimited,
  setProviderRateLimited,
  syncModelsToDb,
  syncProvidersToDb,
} from './db';
import {
  emptyUsageSnapshot,
  estimateChatUsage,
  evaluateRateLimit,
  getProviderIdFromServiceName,
  normalizeServiceId,
  type UsageEstimate,
} from './usageLimits';

const MIN_MS = 60 * 1_000;
const HOUR_MS = 60 * MIN_MS;
const MAX_RETRIES = 10;

export interface ServiceState {
  service: AIService;
  cooldownUntil: number;
  disabled: boolean;
  paidOnly: boolean;
  tier: number;
}

export let states: ServiceState[] = [];

const AGENT_MODEL_NAMES: string[] = (process.env.AGENT_MODELS ?? '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

function getModelTier(modelName: string): number {
  const name = modelName.toLowerCase();

  if (
    name.includes('70b')
    || name.includes('72b')
    || name.includes('gpt-4o')
    || name.includes('claude-3-7')
    || name.includes('claude-3.5')
    || name.includes('gemini-1.5-pro')
    || name.includes('opus')
    || name.includes('405b')
    || name.includes('deepseek-r1')
  ) {
    return 1;
  }

  if (
    name.includes('8b')
    || name.includes('flash')
    || name.includes('grok-2')
    || name.includes('sonnet')
    || name.includes('haiku')
    || name.includes('mixtral')
    || name.includes('qwen')
    || name.includes('nemotron')
  ) {
    return 2;
  }

  return 3;
}

function buildStates(freeServices: AIService[], paidServices: AIService[]): ServiceState[] {
  const allServices = [...freeServices, ...paidServices];
  syncModelsToDb(allServices.map((service) => ({
    id: service.name,
    provider: service.name.split('/')[0] || 'Unknown',
  })));
  syncProvidersToDb(allServices.map((service) => getProviderIdFromServiceName(service.name)));

  const dbStats = getAllModelStats();
  const dbStatusMap = new Map(dbStats.map((row) => [row.id, row]));
  const tierOverrides = getModelTierOverridesMap();

  return [
    ...freeServices.map((service) => {
      const dbRow = dbStatusMap.get(service.name);
      return {
        service,
        cooldownUntil: dbRow?.rate_limited_until ?? 0,
        disabled: dbRow?.status === 'disabled',
        paidOnly: false,
        tier: tierOverrides.get(service.name) ?? getModelTier(service.name),
      };
    }),
    ...paidServices.map((service) => {
      const dbRow = dbStatusMap.get(service.name);
      return {
        service,
        cooldownUntil: dbRow?.rate_limited_until ?? 0,
        disabled: dbRow?.status === 'disabled',
        paidOnly: true,
        tier: 100,
      };
    }),
  ];
}

export async function initializePool(): Promise<void> {
  await reloadPool('startup');
}

export async function reloadPool(reason: string = 'manual'): Promise<void> {
  const [
    groqServices,
    cerebrasServices,
    openRouter,
    mistralServices,
    codestralServices,
    geminiServices,
    cohereServices,
    nvidiaServices,
    alibabaServices,
    puterServices,
    customServices,
  ] = await Promise.all([
    loadGroqServices(),
    loadCerebrasServices(),
    loadOpenRouterServices(),
    loadMistralServices(),
    loadCodestralServices(),
    loadGeminiServices(),
    loadCohereServices(),
    loadNvidiaServices(),
    loadAlibabaServices(),
    loadPuterServices(),
    loadCustomServices(),
  ]);

  const freeServices = [
    ...groqServices,
    ...openRouter.freeServices,
    ...cerebrasServices,
    ...geminiServices,
    ...alibabaServices,
    ...mistralServices,
    ...codestralServices,
    ...cohereServices,
    ...nvidiaServices,
    ...puterServices,
    ...customServices,
  ];
  const settings = getAppSettings();
  const paidServices = settings.openRouterFreeOnly ? [] : openRouter.paidServices;

  states = buildStates(freeServices, paidServices);
  logger.info(
    {
      reason,
      total: states.length,
      available: states.filter((state) => !state.disabled).length,
    },
    'Service pool reloaded',
  );
}

export function replacePoolStates(nextStates: ServiceState[]): void {
  states = nextStates;
  syncModelsToDb(nextStates.map((state) => ({
    id: state.service.name,
    provider: state.service.name.split('/')[0] || 'Unknown',
  })));
  syncProvidersToDb(nextStates.map((state) => getProviderIdFromServiceName(state.service.name)));
}

export function hasImage(request: ChatRequest): boolean {
  if (!request.messages) {
    return false;
  }

  return request.messages.some((message) =>
    Array.isArray(message.content) && message.content.some((part) => part.type === 'image_url'),
  );
}

function getCandidatePool(requireTools: boolean, requireVision: boolean): ServiceState[] {
  let pool = states.filter((state) => !state.disabled && !state.paidOnly);

  if (requireTools) {
    if (AGENT_MODEL_NAMES.length > 0) {
      pool = pool.filter((state) => AGENT_MODEL_NAMES.includes(state.service.name) && state.service.supportsTools);
    } else {
      pool = pool.filter((state) => state.service.supportsTools);
    }
  }

  if (requireVision) {
    pool = pool.filter((state) => state.service.supportsVision);
  }

  return pool.sort((left, right) => {
    if (left.tier !== right.tier) {
      return left.tier - right.tier;
    }
    return Math.random() - 0.5;
  });
}

export function getPool(requireTools: boolean, requireVision: boolean): ServiceState[] {
  const providerCooldowns = getProviderCooldownMap();
  const now = Date.now();
  return getCandidatePool(requireTools, requireVision)
    .filter((state) => {
      const providerCooldownUntil = providerCooldowns.get(getProviderIdFromServiceName(state.service.name))?.cooldownUntil ?? 0;
      return Math.max(state.cooldownUntil, providerCooldownUntil) <= now;
    });
}

function applyConfiguredCooldowns(pool: ServiceState[], estimate: UsageEstimate): void {
  const providerRules = getRateLimitRulesMap('provider');
  const modelRules = getRateLimitRulesMap('model');
  const providerIds = Array.from(new Set(
    pool
      .map((state) => getProviderIdFromServiceName(state.service.name))
      .filter((providerId) => providerRules.has(providerId)),
  ));
  const modelIds = Array.from(new Set(
    pool
      .map((state) => normalizeServiceId(state.service.name))
      .filter((modelId) => modelRules.has(modelId)),
  ));

  const providerUsage = getProviderUsageSnapshots(providerIds);
  const modelUsage = getModelUsageSnapshots(modelIds);

  for (const state of pool) {
    const providerId = getProviderIdFromServiceName(state.service.name);
    const providerRule = providerRules.get(providerId);
    if (providerRule) {
      const evaluation = evaluateRateLimit(
        providerRule,
        providerUsage.get(providerId) ?? emptyUsageSnapshot(),
        estimate,
      );
      if (evaluation.blocked) {
        setProviderRateLimited(providerId, evaluation.until, evaluation.reasons.join(' | '));
      }
    }

    const modelId = normalizeServiceId(state.service.name);
    const modelRule = modelRules.get(modelId);
    if (modelRule) {
      const evaluation = evaluateRateLimit(
        modelRule,
        modelUsage.get(modelId) ?? emptyUsageSnapshot(),
        estimate,
      );
      if (evaluation.blocked) {
        state.cooldownUntil = Math.max(state.cooldownUntil, evaluation.until);
        setModelRateLimited(state.service.name, state.cooldownUntil);
      }
    }
  }
}

function getStateCooldownUntil(state: ServiceState, providerCooldowns: ReturnType<typeof getProviderCooldownMap>): number {
  const providerCooldownUntil = providerCooldowns.get(getProviderIdFromServiceName(state.service.name))?.cooldownUntil ?? 0;
  return Math.max(state.cooldownUntil, providerCooldownUntil);
}

function pickNextAvailableState(
  pool: ServiceState[],
  attempted: Set<string>,
): { state: ServiceState | null; retryAfter: number | null } {
  const providerCooldowns = getProviderCooldownMap();
  const now = Date.now();
  let earliestCooldownUntil = Number.POSITIVE_INFINITY;

  for (const state of pool) {
    if (attempted.has(state.service.name)) {
      continue;
    }

    const cooldownUntil = getStateCooldownUntil(state, providerCooldowns);
    if (cooldownUntil <= now) {
      return { state, retryAfter: null };
    }

    earliestCooldownUntil = Math.min(earliestCooldownUntil, cooldownUntil);
  }

  if (Number.isFinite(earliestCooldownUntil)) {
    return {
      state: null,
      retryAfter: Math.max(1, Math.ceil((earliestCooldownUntil - now) / 1_000)),
    };
  }

  return { state: null, retryAfter: null };
}

export function handleServiceError(state: ServiceState, err: unknown): void {
  const value = err as {
    status?: number;
    statusCode?: number;
    error?: { status?: number };
    headers?: Headers | Record<string, string>;
    response?: { headers?: Headers | Record<string, string> };
    message?: string;
  };
  const status = value?.status
    ?? value?.statusCode
    ?? value?.error?.status
    ?? Number.parseInt(value?.message?.match(/Error (\d{3}):/)?.[1] ?? '0', 10)
    ?? 0;
  const name = state.service.name;

  if (status === 429) {
    let resetTimeMs = Date.now() + 15 * 60_000;
    const headers = value?.headers ?? value?.response?.headers;
    if (headers) {
      const getHeader = (key: string) => (
        typeof (headers as Headers).get === 'function'
          ? (headers as Headers).get(key)
          : (headers as Record<string, string>)[key] ?? (headers as Record<string, string>)[key.toLowerCase()]
      );
      const resetValue = getHeader('x-ratelimit-reset')
        ?? getHeader('x-ratelimit-reset-requests')
        ?? getHeader('retry-after');
      const seconds = Number.parseFloat(resetValue ?? '');
      if (Number.isFinite(seconds)) {
        resetTimeMs = seconds > 1_000_000_000 ? seconds * 1_000 : Date.now() + seconds * 1_000;
      }
    } else if (name.startsWith('Groq/')) {
      resetTimeMs = Date.now() + 60_000;
    }

    state.cooldownUntil = resetTimeMs;
    setModelRateLimited(name, resetTimeMs);
    logger.warn({ name, status, until: new Date(resetTimeMs).toISOString() }, 'Model moved to cooldown');
    return;
  }

  if (status === 402) {
    const deadline = Date.now() + 24 * HOUR_MS;
    state.cooldownUntil = deadline;
    setModelRateLimited(name, deadline);
    logger.warn({ name, status }, 'Model quota exhausted');
    return;
  }

  if (status === 413) {
    state.cooldownUntil = Date.now() + HOUR_MS;
    logger.warn({ name, status }, 'Payload too large for model');
    return;
  }

  if (status === 401 || status === 403 || status === 404) {
    state.disabled = true;
    logger.error({ name, status }, 'Model disabled after provider error');
    return;
  }

  state.cooldownUntil = Date.now() + 10_000;
  logger.warn({ name, status }, 'Model hit temporary error and entered short cooldown');
}

export function resetStates(modelName?: string): boolean {
  if (modelName) {
    const state = states.find((item) => item.service.name === modelName);
    if (!state) {
      return false;
    }
    state.cooldownUntil = 0;
    state.disabled = false;
    return true;
  }

  states.forEach((state) => {
    state.cooldownUntil = 0;
    state.disabled = false;
  });
  return true;
}

export async function tryServices(
  request: ChatRequest,
  id: string,
  forceTools: boolean = false,
  forceVision: boolean = false,
): Promise<{ stream: AsyncIterable<string>; serviceName: string }> {
  const requireTools = forceTools || Boolean(request.tools?.length);
  const requireVision = forceVision || hasImage(request);
  const errors: string[] = [];
  const attempted = new Set<string>();
  const pool = getCandidatePool(requireTools, requireVision);
  const estimate = estimateChatUsage(request);

  if (pool.length === 0) {
    throw Object.assign(new Error('No hay modelos compatibles disponibles para esta solicitud.'), {
      code: 'service_unavailable',
      httpStatus: 503,
    });
  }

  applyConfiguredCooldowns(pool, estimate);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const { state, retryAfter } = pickNextAvailableState(pool, attempted);
    if (!state) {
      throw Object.assign(
        new Error(retryAfter
          ? `Todos los modelos compatibles estan en cooldown. Reintenta en ${retryAfter}s.`
          : 'No hay modelos compatibles disponibles en este momento.'),
        {
          code: retryAfter ? 'rate_limit_exceeded' : 'service_unavailable',
          httpStatus: retryAfter ? 429 : 503,
          retryAfter: retryAfter ?? undefined,
          details: errors,
        },
      );
    }

    attempted.add(state.service.name);
    logger.info({
      attempt,
      maxRetries: MAX_RETRIES,
      serviceName: state.service.name,
      tier: state.tier,
      requireTools,
      requireVision,
    }, 'Trying pooled service');

    try {
      const stream = await state.service.chat(request, id);
      incrementModelUsage(state.service.name);
      return { stream, serviceName: state.service.name };
    } catch (err) {
      const message = (err as { message?: string })?.message ?? String(err);
      logger.error({ attempt, serviceName: state.service.name, message }, 'Service request failed');
      errors.push(`${state.service.name}: ${message}`);
      handleServiceError(state, err);
    }
  }

  throw Object.assign(new Error('All retries failed'), { details: errors });
}

export async function trySpecificService(
  modelName: string,
  request: ChatRequest,
  id: string,
): Promise<{ stream: AsyncIterable<string>; serviceName: string }> {
  const state = states.find((item) => item.service.name === modelName);

  if (!state) {
    throw Object.assign(
      new Error(`Model '${modelName}' not found. Use GET /v1/models to list available models.`),
      { code: 'model_not_found', httpStatus: 404 },
    );
  }

  if (state.disabled) {
    throw Object.assign(
      new Error(`Model '${modelName}' is permanently disabled.`),
      { code: 'model_disabled', httpStatus: 503 },
    );
  }

  applyConfiguredCooldowns([state], estimateChatUsage(request));

  const now = Date.now();
  const providerCooldownUntil = getProviderCooldownMap().get(getProviderIdFromServiceName(state.service.name))?.cooldownUntil ?? 0;
  const cooldownUntil = Math.max(state.cooldownUntil, providerCooldownUntil);
  if (cooldownUntil > now) {
    const retryAfter = Math.ceil((cooldownUntil - now) / 1_000);
    throw Object.assign(
      new Error(`Model '${modelName}' is rate-limited. Retry after ${retryAfter}s.`),
      { code: 'rate_limit_exceeded', httpStatus: 429, retryAfter },
    );
  }

  try {
    const stream = await state.service.chat(request, id);
    incrementModelUsage(state.service.name);
    return { stream, serviceName: state.service.name };
  } catch (err) {
    handleServiceError(state, err);
    throw err;
  }
}

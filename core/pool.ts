import { groqServices } from '../services/groq';
import { cerebrasServices } from '../services/cerebras';
import { openrouterFreeServices, openrouterPaidServices } from '../services/openrouter';
import { mistralServices } from '../services/mistral';
import { codestralServices } from '../services/codestral';
import { geminiServices } from '../services/gemini';
import { cohereServices } from '../services/cohere';
import { nvidiaServices } from '../services/nvidia';
import { alibabaServices } from '../services/alibaba';
import { puterServices } from '../services/puter';
import type { AIService, ChatRequest } from '../types';
import { logger } from '../utils/logger';

/** Free models — included in automatic rotation */
const freeServices: AIService[] = [
  ...groqServices,
  ...openrouterFreeServices,
  ...cerebrasServices,
  ...geminiServices,
  ...alibabaServices,
  ...mistralServices,
  ...codestralServices,
  ...cohereServices,
  ...nvidiaServices,
  ...puterServices,
];

/** Paid OpenRouter models — only used when explicitly requested by name */
const paidServices: AIService[] = [
  ...openrouterPaidServices,
];

const MIN_MS = 60 * 1_000;
const HOUR_MS = 60 * MIN_MS;

export interface ServiceState {
  service: AIService;
  cooldownUntil: number;
  disabled: boolean;
  paidOnly: boolean;
}

export const states: ServiceState[] = [
  ...freeServices.map(s => ({ service: s, cooldownUntil: 0, disabled: false, paidOnly: false })),
  ...paidServices.map(s => ({ service: s, cooldownUntil: 0, disabled: false, paidOnly: true })),
];

const AGENT_MODEL_NAMES: string[] = (process.env.AGENT_MODELS ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

export function hasImage(request: ChatRequest): boolean {
  if (!request.messages) return false;
  for (const msg of request.messages) {
    if (Array.isArray(msg.content)) {
      if (msg.content.some((p: any) => p.type === 'image_url')) return true;
    }
  }
  return false;
}

export function getPool(requireTools: boolean, requireVision: boolean): ServiceState[] {
  let pool = states.filter(s => !s.disabled && !s.paidOnly);

  if (requireTools) {
    if (AGENT_MODEL_NAMES.length > 0) {
      pool = pool.filter(s => AGENT_MODEL_NAMES.includes(s.service.name) && s.service.supportsTools);
    } else {
      pool = pool.filter(s => s.service.supportsTools);
    }
  }

  if (requireVision) {
    pool = pool.filter(s => s.service.supportsVision);
  }

  return pool;
}

let preferredChat = 0;
let preferredAgent = 0;
let preferredVision = 0;

export function getService(requireTools: boolean, requireVision: boolean): ServiceState {
  const now = Date.now();
  const pool = getPool(requireTools, requireVision);

  if (pool.length === 0) {
    return states.find(s => !s.disabled) ?? states[0]!;
  }

  const pref = requireVision ? preferredVision : (requireTools ? preferredAgent : preferredChat);

  for (let i = 0; i < pool.length; i++) {
    const s = pool[(pref + i) % pool.length]!;
    if (s.cooldownUntil <= now) {
      const next = (pref + i) % pool.length;
      if (requireVision) preferredVision = next;
      else if (requireTools) preferredAgent = next;
      else preferredChat = next;
      return s;
    }
  }

  return pool.reduce((a, b) => (a.cooldownUntil < b.cooldownUntil ? a : b))!;
}

export function handleServiceError(state: ServiceState, err: any): void {
  const status: number = err?.status ?? err?.statusCode ?? err?.error?.status ?? 0;
  const name = state.service.name;

  if (status === 429) {
    state.cooldownUntil = Date.now() + MIN_MS;
    logger.warn({ name, status: 429 }, 'Rate limited → cooldown 1 min');
  } else if (status === 402) {
    state.cooldownUntil = Date.now() + HOUR_MS;
    logger.warn({ name, status: 402 }, 'Quota exceeded → cooldown 1 h');
  } else if (status === 413) {
    state.cooldownUntil = Date.now() + HOUR_MS;
    logger.warn({ name, status: 413 }, 'Payload too large → cooldown 1 h');
  } else if (status === 401 || status === 403) {
    state.disabled = true;
    logger.error({ name, status }, 'Unauthorized / Forbidden (Paid Model) → permanently disabled');
  } else if (status === 404) {
    state.disabled = true;
    logger.error({ name, status: 404 }, 'Model not found → permanently disabled');
  } else {
    state.cooldownUntil = Date.now() + 10_000;
    logger.warn({ name, status }, 'Error unknown → cooldown 10 s');
  }

  const pool = getPool(state.service.supportsTools, !!state.service.supportsVision);
  const idxInPool = pool.indexOf(state);
  if (idxInPool >= 0) {
    const next = (idxInPool + 1) % pool.length;
    if (state.service.supportsVision) preferredVision = next;
    else if (state.service.supportsTools) preferredAgent = next;
    else preferredChat = next;
  }
}

export function resetStates(modelName?: string) {
    if(modelName) {
        const state = states.find(s => s.service.name === modelName);
        if(!state) return false;
        state.cooldownUntil = 0;
        state.disabled = false;
        return true;
    }
    states.forEach(s => { s.cooldownUntil = 0; s.disabled = false; });
    preferredChat = 0; preferredAgent = 0; preferredVision = 0;
    return true;
}

const MAX_RETRIES = 10;

export async function tryServices(
  request: ChatRequest,
  id: string,
  forceTools: boolean = false,
  forceVision: boolean = false
): Promise<{ stream: AsyncIterable<string>; serviceName: string }> {
  const requireTools = forceTools || !!(request.tools?.length);
  const requireVision = forceVision || hasImage(request);
  const errors: string[] = [];

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const state = getService(requireTools, requireVision);
    logger.info({ attempt, max_retries: MAX_RETRIES, serviceName: state.service.name, requireTools, requireVision }, `Try Service Loop`);

    try {
      const stream = await state.service.chat(request, id);
      return { stream, serviceName: state.service.name };
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      logger.error({ attempt, serviceName: state.service.name, msg }, `Error during chat completion`);
      errors.push(`${state.service.name}: ${msg}`);
      handleServiceError(state, err);
    }
  }

  throw Object.assign(new Error('All retries failed'), { details: errors });
}

export async function trySpecificService(
  modelName: string,
  request: ChatRequest,
  id: string
): Promise<{ stream: AsyncIterable<string>; serviceName: string }> {
  const state = states.find(s => s.service.name === modelName);

  if (!state) {
    throw Object.assign(
      new Error(`Model '${modelName}' not found. Use GET /v1/models to list available models.`),
      { code: 'model_not_found', httpStatus: 404 }
    );
  }
  if (state.disabled) {
    throw Object.assign(
      new Error(`Model '${modelName}' is permanently disabled.`),
      { code: 'model_disabled', httpStatus: 503 }
    );
  }
  const now = Date.now();
  if (state.cooldownUntil > now) {
    const retryAfter = Math.ceil((state.cooldownUntil - now) / 1000);
    throw Object.assign(
      new Error(`Model '${modelName}' is rate-limited. Retry after ${retryAfter}s.`),
      { code: 'rate_limit_exceeded', httpStatus: 429, retryAfter }
    );
  }

  logger.info({ serviceName: modelName }, `Try Specific Service`);
  try {
    const stream = await state.service.chat(request, id);
    return { stream, serviceName: state.service.name };
  } catch (err: any) {
    handleServiceError(state, err);
    throw err;
  }
}

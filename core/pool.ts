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
import { syncModelsToDb, getAllModelStats, setModelRateLimited, incrementModelUsage } from './db';

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
  tier: number;
}

function getModelTier(modelName: string): number {
  const name = modelName.toLowerCase();
  
  // Tier 1: Los gigantes de la IA (Masivos, súper capaces, visuales)
  if (name.includes('70b') || name.includes('72b') || name.includes('gpt-4o') || name.includes('claude-3-7') || name.includes('claude-3.5') || name.includes('gemini-1.5-pro') || name.includes('opus') || name.includes('405b') || name.includes('deepseek-r1')) {
      return 1;
  }
  // Tier 2: Modelos muy rápidos, decentes y ágiles
  if (name.includes('8b') || name.includes('flash') || name.includes('grok-2') || name.includes('sonnet') || name.includes('haiku') || name.includes('mixtral') || name.includes('qwen') || name.includes('nemotron')) {
      return 2;
  }
  // Tier 3: Todo el resto
  return 3;
}

// 1. Initial Database Sync
syncModelsToDb(freeServices.map(s => ({ id: s.name, provider: s.name.split('/')[0] || 'Unknown' })));
const dbStats = getAllModelStats();
const dbStatusMap = new Map(dbStats.map(row => [row.id, row]));

export const states: ServiceState[] = [
  ...freeServices.map(s => {
      const dbRow = dbStatusMap.get(s.name);
      return { 
          service: s, 
          cooldownUntil: dbRow ? dbRow.rate_limited_until : 0, 
          disabled: dbRow?.status === 'disabled', 
          paidOnly: false,
          tier: getModelTier(s.name)
      };
  }),
  ...paidServices.map(s => ({ service: s, cooldownUntil: 0, disabled: false, paidOnly: true, tier: 100 })),
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

  // Smart Routing: We strictly prioritize Tier 1 first, then 2, etc. Randomize inside tiers for load balancing.
  return pool.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      return Math.random() - 0.5; // Agitamos un poco los de la misma jerarquía
  });
}

export function getService(requireTools: boolean, requireVision: boolean): ServiceState {
  const now = Date.now();
  const pool = getPool(requireTools, requireVision);

  if (pool.length === 0) {
    return states.find(s => !s.disabled) ?? states[0]!;
  }

  // Encuentra el mejor modelo (más rápido, mejor tier) que no esté en cooldown
  for (let i = 0; i < pool.length; i++) {
    const s = pool[i]!;
    if (s.cooldownUntil <= now) {
      return s;
    }
  }

  // Si todos explotaron (Rate Limits masivos), devolvemos el que se vaya a liberar más rápido.
  return pool.reduce((a, b) => (a.cooldownUntil < b.cooldownUntil ? a : b))!;
}

export function handleServiceError(state: ServiceState, err: any): void {
  const status: number = err?.status ?? err?.statusCode ?? err?.error?.status ?? parseInt(err?.message?.match(/Error (\d{3}):/)?.[1] || "0", 10) ?? 0;
  const name = state.service.name;

  if (status === 429) {
    let resetTimeMs = Date.now() + 15 * 60 * 1000; // 15 Min fallback para la mayoría

    // Parseo Agresivo de Headers de Proveedores (Para Groq, OpenRouter, etc)
    const headers = err?.headers ?? err?.response?.headers;
    if (headers) {
      const getHdr = (key: string) => (typeof headers.get === 'function' ? headers.get(key) : headers[key]);
      const resetStr = getHdr('x-ratelimit-reset') || getHdr('x-ratelimit-reset-requests') || getHdr('retry-after');
      
      if (resetStr) {
          const sec = parseFloat(resetStr);
          if (!isNaN(sec)) {
              if (sec > 1000000000) resetTimeMs = sec * 1000; // UNIX timestamp crudo
              else resetTimeMs = Date.now() + sec * 1000; // Segundos relativos
          }
      }
    } else if (name.startsWith('Groq/')) {
        // Groq resetea rapidísimo si no pudimos atrapar su header
        resetTimeMs = Date.now() + 60 * 1000; 
    }

    state.cooldownUntil = resetTimeMs;
    setModelRateLimited(name, resetTimeMs); // Guardado asíncrono persistente en disco (SQLite)
    logger.warn({ name, status: 429, until: new Date(resetTimeMs).toISOString() }, 'Rate limited → locked in SQLite');
  } else if (status === 402) {
    const deadline = Date.now() + HOUR_MS * 24; // Sin saldo: 24 horas
    state.cooldownUntil = deadline;
    setModelRateLimited(name, deadline);
    logger.warn({ name, status: 402 }, 'Quota exceeded → locked for 24h');
  } else if (status === 413) {
    state.cooldownUntil = Date.now() + HOUR_MS;
    logger.warn({ name, status: 413 }, 'Payload too large → cooldown 1 h');
  } else if (status === 401 || status === 403) {
    state.disabled = true;
    logger.error({ name, status }, 'Unauthorized / Forbidden → permanently disabled');
  } else if (status === 404) {
    state.disabled = true;
    logger.error({ name, status: 404 }, 'Model not found → permanently disabled');
  } else {
    const deadline = Date.now() + 10_000;
    state.cooldownUntil = deadline;
    // No guardamos errores pasajeros de red en la DB, solo la RAM
    logger.warn({ name, status }, 'Error unknown → cooldown 10 s');
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
    logger.info({ attempt, max_retries: MAX_RETRIES, serviceName: state.service.name, tier: state.tier, requireTools, requireVision }, `Try Service Loop`);

    try {
      const stream = await state.service.chat(request, id);
      incrementModelUsage(state.service.name); // Async DB telemetry
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

  logger.info({ serviceName: modelName, tier: state.tier }, `Try Specific Service`);
  try {
    const stream = await state.service.chat(request, id);
    incrementModelUsage(state.service.name);
    return { stream, serviceName: state.service.name };
  } catch (err: any) {
    handleServiceError(state, err);
    throw err;
  }
}

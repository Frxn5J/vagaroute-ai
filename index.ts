import { groqServices } from './services/groq';
import { cerebrasServices } from './services/cerebras';
import { openrouterFreeServices, openrouterPaidServices } from './services/openrouter';
import { mistralServices } from './services/mistral';
import { codestralServices } from './services/codestral';
import { geminiServices } from './services/gemini';
import { cohereServices } from './services/cohere';
import { nvidiaServices } from './services/nvidia';
import { alibabaServices } from './services/alibaba';
import type { AIService, ChatRequest } from './types';

// ─── Service pool ─────────────────────────────────────────────────────────────

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
];

/** Paid OpenRouter models — only used when explicitly requested by name */
const paidServices: AIService[] = [
  ...openrouterPaidServices,
];

// ─── State tracking ──────────────────────────────────────────────────────────

const MIN_MS = 60 * 1_000;
const HOUR_MS = 60 * MIN_MS;

interface ServiceState {
  service: AIService;
  cooldownUntil: number;
  disabled: boolean;
  /** If true, excluded from auto-routing pools — only accessible by explicit name */
  paidOnly: boolean;
}

const states: ServiceState[] = [
  ...freeServices.map(s => ({ service: s, cooldownUntil: 0, disabled: false, paidOnly: false })),
  ...paidServices.map(s => ({ service: s, cooldownUntil: 0, disabled: false, paidOnly: true })),
];

// ─── Routing pools ──────────────────────────────────────────────────────────

/**
 * AGENT_MODELS: comma-separated list of model names to use exclusively
 * when the request includes tools (agent/agentic mode).
 *
 * Example in .env:
 *   AGENT_MODELS=Groq/llama-3.3-70b-versatile,Mistral (La Plateforme),Cerebras/llama-3.3-70b
 *
 * If not set, the router uses all models that support tools.
 */
const AGENT_MODEL_NAMES: string[] = (process.env.AGENT_MODELS ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function hasImage(request: ChatRequest): boolean {
  if (!request.messages) return false;
  for (const msg of request.messages) {
    if (Array.isArray(msg.content)) {
      if (msg.content.some((p: any) => p.type === 'image_url')) return true;
    }
  }
  return false;
}

/** Returns the sub-pool for the given mode. Paid-only models are always excluded. */
function getPool(requireTools: boolean, requireVision: boolean): ServiceState[] {
  let pool = states.filter(s => !s.disabled && !s.paidOnly);

  if (requireTools) {
    // Agent pool: use explicit list if configured, else all tool-supporting models
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

/** Separate sticky indices for each pool. */
let preferredChat = 0;
let preferredAgent = 0;
let preferredVision = 0;

function getService(requireTools: boolean, requireVision: boolean): ServiceState {
  const now = Date.now();
  const pool = getPool(requireTools, requireVision);

  if (pool.length === 0) {
    // Fallback: any non-disabled service
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

  // All in cooldown — pick soonest available
  return pool.reduce((a, b) => (a.cooldownUntil < b.cooldownUntil ? a : b))!;
}

function handleServiceError(state: ServiceState, err: any): void {
  const status: number = err?.status ?? err?.statusCode ?? err?.error?.status ?? 0;
  const name = state.service.name;
  const idx = states.indexOf(state);

  if (status === 429) {
    state.cooldownUntil = Date.now() + MIN_MS;
    console.warn(`[${name}] Rate limited → cooldown 1 min`);
  } else if (status === 402) {
    state.cooldownUntil = Date.now() + HOUR_MS;
    console.warn(`[${name}] Quota exceeded → cooldown 1 h`);
  } else if (status === 413) {
    // Payload too large — model can't handle this context size.
    // Cool down for 1 hour; payload may be smaller later.
    state.cooldownUntil = Date.now() + HOUR_MS;
    console.warn(`[${name}] Payload too large → cooldown 1 h`);
  } else if (status === 401 || status === 403) {
    state.disabled = true;
    console.warn(`[${name}] Unauthorized / Forbidden (Paid Model) → permanently disabled`);
  } else if (status === 404) {
    state.disabled = true;
    console.warn(`[${name}] Model not found → permanently disabled`);
  } else {
    state.cooldownUntil = Date.now() + 10_000;
    console.warn(`[${name}] Error ${status || 'unknown'} → cooldown 10 s`);
  }

  // Advance the preferred index away from the failed service
  const pool = getPool(state.service.supportsTools, !!state.service.supportsVision);
  const idxInPool = pool.indexOf(state);
  if (idxInPool >= 0) {
    const next = (idxInPool + 1) % pool.length;
    if (state.service.supportsVision) preferredVision = next;
    else if (state.service.supportsTools) preferredAgent = next;
    else preferredChat = next;
  }
}

// ─── CORS ────────────────────────────────────────────────────────────────────

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function withCors(headers: Record<string, string> = {}): Record<string, string> {
  return { ...CORS, ...headers };
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

const API_SECRET = process.env.API_SECRET;

function isAuthorized(req: Request): boolean {
  if (!API_SECRET) return true; // auth disabled
  const header = req.headers.get('Authorization') ?? '';
  return header === `Bearer ${API_SECRET}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const startTime = Date.now();

function genId(): string {
  return `chatcmpl-${Math.random().toString(36).slice(2, 11)}`;
}

/** Wraps a stream to catch mid-stream errors and emit a proper SSE error before [DONE]. */
async function* withErrorBoundary(
  source: AsyncIterable<string>,
  serviceName: string
): AsyncGenerator<string> {
  try {
    for await (const chunk of source) {
      if (chunk.trim() === 'data: [DONE]') {
        yield `data: ${JSON.stringify({
          id: 'chatcmpl-auth', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: serviceName,
          choices: [],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        })}\n\n`;
      }
      yield chunk;
    }
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    console.error(`[${serviceName}] Mid-stream error: ${msg}`);
    yield `data: ${JSON.stringify({
      error: { message: msg, type: 'stream_error' }
    })}\n\n`;
    yield 'data: [DONE]\n\n';
  }
}

/**
 * Collects a stream of SSE lines and assembles a complete message
 * (including tool_calls for agent use cases).
 */
async function collectSSE(source: AsyncIterable<string>): Promise<{
  content: string;
  tool_calls: any[];
  finish_reason: string;
}> {
  let content = '';
  const toolCallMap: Record<number, any> = {};
  let finish_reason = 'stop';

  for await (const line of source) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data: ') || trimmed === 'data: [DONE]') continue;

    try {
      const chunk = JSON.parse(trimmed.slice(6));
      const choice = chunk.choices?.[0];
      if (!choice) continue;

      if (choice.finish_reason) finish_reason = choice.finish_reason;

      const delta = choice.delta;
      if (delta?.content) content += delta.content;

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCallMap[idx]) {
            toolCallMap[idx] = {
              id: tc.id ?? '',
              type: 'function',
              function: { name: '', arguments: '' },
            };
          }
          if (tc.id) toolCallMap[idx].id = tc.id;
          if (tc.function?.name) toolCallMap[idx].function.name += tc.function.name;
          if (tc.function?.arguments) toolCallMap[idx].function.arguments += tc.function.arguments;
        }
      }
    } catch { /* non-JSON SSE lines, skip */ }
  }

  const tool_calls = Object.values(toolCallMap);
  return { content, tool_calls, finish_reason };
}

// ─── Service dispatchers ──────────────────────────────────────────────────────

const MAX_RETRIES = 10;

async function tryServices(
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
    console.log(`[Attempt ${attempt}/${MAX_RETRIES}] Using ${state.service.name} (Tools: ${requireTools}, Vision: ${requireVision})`);

    try {
      const stream = await state.service.chat(request, id);
      return { stream, serviceName: state.service.name };
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error(`[${state.service.name}] Error (attempt ${attempt}): ${msg}`);
      errors.push(`${state.service.name}: ${msg}`);
      handleServiceError(state, err);
    }
  }

  throw Object.assign(new Error('All retries failed'), { details: errors });
}

async function trySpecificService(
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

  console.log(`[Specific] Using ${modelName}`);
  try {
    const stream = await state.service.chat(request, id);
    return { stream, serviceName: state.service.name };
  } catch (err: any) {
    handleServiceError(state, err);
    throw err;
  }
}

// ─── HTTP Server ─────────────────────────────────────────────────────────────

const server = Bun.serve({
  port: process.env.PORT ?? 3000,
  hostname: '0.0.0.0',

  async fetch(req) {
    const { pathname } = new URL(req.url);

    // ── CORS preflight ────────────────────────────────────────────────────────
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: withCors() });
    }

    // ── Auth check (skip /health) ─────────────────────────────────────────────
    if (pathname !== '/health' && !isAuthorized(req)) {
      return new Response(
        JSON.stringify({ error: { message: 'Unauthorized', type: 'auth_error' } }),
        { status: 401, headers: withCors({ 'Content-Type': 'application/json' }) }
      );
    }

    // ── Health ───────────────────────────────────────────────────────────────
    if (req.method === 'GET' && pathname === '/health') {
      const now = Date.now();
      const available = states.filter(s => !s.disabled && s.cooldownUntil <= now).length;
      return new Response(JSON.stringify({
        status: 'ok',
        uptime_seconds: Math.floor((now - startTime) / 1000),
        services: { total: states.length, available, disabled: states.filter(s => s.disabled).length },
      }), { headers: withCors({ 'Content-Type': 'application/json' }) });
    }

    // ── Admin reset ─────────────────────────────────────────────────────────
    if (req.method === 'POST' && pathname.startsWith('/admin/reset')) {
      const modelName = decodeURIComponent(pathname.replace('/admin/reset/', '').replace('/admin/reset', '').trim());
      if (modelName) {
        const state = states.find(s => s.service.name === modelName);
        if (!state) {
          return new Response(JSON.stringify({ error: `Model '${modelName}' not found` }),
            { status: 404, headers: withCors({ 'Content-Type': 'application/json' }) });
        }
        state.cooldownUntil = 0;
        state.disabled = false;
        console.log(`[Admin] Reset ${modelName}`);
        return new Response(JSON.stringify({ ok: true, reset: modelName }),
          { headers: withCors({ 'Content-Type': 'application/json' }) });
      }
      // Reset all
      states.forEach(s => { s.cooldownUntil = 0; s.disabled = false; });
      preferredChat = 0; preferredAgent = 0;
      console.log('[Admin] Reset ALL services');
      return new Response(JSON.stringify({ ok: true, reset: 'all', count: states.length }),
        { headers: withCors({ 'Content-Type': 'application/json' }) });
    }

    // ── Status ───────────────────────────────────────────────────────────────
    if (req.method === 'GET' && pathname === '/status') {
      const now = Date.now();
      const report = states.map(s => ({
        name: s.service.name,
        supportsTools: s.service.supportsTools,
        status: s.disabled
          ? 'disabled'
          : s.cooldownUntil > now
            ? `cooldown ${Math.ceil((s.cooldownUntil - now) / 1000)}s`
            : 'available',
      }));
      return new Response(JSON.stringify(report, null, 2), {
        headers: withCors({ 'Content-Type': 'application/json' }),
      });
    }

    // ── Audio Transcriptions ──────────────────────────────────────────────────
    if (req.method === 'POST' && pathname === '/v1/audio/transcriptions') {
      try {
        const formData = await req.formData();
        const file = formData.get('file') as File;
        if (!file) throw new Error("Falta el campo 'file' en el FormData");
        
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) throw new Error("Falta GROQ_API_KEY en .env para transcripciones");
        
        const groqForm = new FormData();
        groqForm.append('file', file);
        groqForm.append('model', 'whisper-large-v3'); // or whisper-large-v3-turbo

        const lang = formData.get('language');
        if (lang) groqForm.append('language', lang);
        
        const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}` },
          body: groqForm
        });

        if (!res.ok) throw new Error(`Groq Audio Error: ${await res.text()}`);
        const data = await res.json();
        
        return new Response(JSON.stringify(data), {
          headers: withCors({ 'Content-Type': 'application/json' })
        });
      } catch (err: any) {
        return new Response(
          JSON.stringify({ error: { message: err.message } }), 
          { status: 500, headers: withCors({ 'Content-Type': 'application/json' }) }
        );
      }
    }

    // ── Embeddings ────────────────────────────────────────────────────────────
    if (req.method === 'POST' && pathname === '/v1/embeddings') {
      try {
        const body = await req.json() as any;
        const input = body.input;
        const texts = Array.isArray(input) ? input : [input];

        if (process.env.MISTRAL_API_KEY) {
          const res = await fetch('https://api.mistral.ai/v1/embeddings', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ input: texts, model: 'mistral-embed' })
          });
          if (res.ok) {
            return new Response(await res.text(), { headers: withCors({ 'Content-Type': 'application/json' }) });
          }
        }
        
        // Fallback to Cohere if Mistral fails or is missing
        if (process.env.COHERE_API_KEY) {
          const res = await fetch('https://api.cohere.com/v1/embed', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.COHERE_API_KEY}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify({ texts, model: 'embed-multilingual-v3.0', input_type: 'search_document' })
          });
          if (res.ok) {
            const dataHash = await res.json() as any;
            const openAiFormat = {
              object: "list",
              data: dataHash.embeddings.map((emb: number[], i: number) => ({ object: "embedding", embedding: emb, index: i })),
              model: "cohere/embed-multilingual",
              usage: { prompt_tokens: dataHash.meta?.billed_units?.input_tokens ?? 0, total_tokens: dataHash.meta?.billed_units?.input_tokens ?? 0 }
            };
            return new Response(JSON.stringify(openAiFormat), { headers: withCors({ 'Content-Type': 'application/json' }) });
          }
        }

        throw new Error("No hay proveedores de Embeddings disponibles (Asegúrate de tener MISTRAL_API_KEY o COHERE_API_KEY)");
      } catch (err: any) {
        return new Response(
          JSON.stringify({ error: { message: err.message } }), 
          { status: 500, headers: withCors({ 'Content-Type': 'application/json' }) }
        );
      }
    }

    // ── Models list ──────────────────────────────────────────────────────────
    if (req.method === 'GET' && pathname === '/v1/models') {
      const now = Date.now();
      const virtualModels = [
        { id: 'auto', object: 'model', created: Math.floor(now / 1000), owned_by: 'system', supports_tools: true, status: 'available' },
        { id: 'img', object: 'model', created: Math.floor(now / 1000), owned_by: 'system', supports_tools: false, status: 'available' },
        { id: 'tools', object: 'model', created: Math.floor(now / 1000), owned_by: 'system', supports_tools: true, status: 'available' },
      ];
      
      const data = states.filter(s => !s.disabled).map(s => ({
        id: s.service.name,
        object: 'model',
        created: Math.floor(now / 1000),
        owned_by: s.service.name.split('/')[0],
        supports_tools: s.service.supportsTools,
        status: s.cooldownUntil > now ? 'cooldown' : 'available',
      }));
      return new Response(JSON.stringify({ object: 'list', data: [...virtualModels, ...data] }, null, 2), {
        headers: withCors({ 'Content-Type': 'application/json' }),
      });
    }

    // ── Chat completions ─────────────────────────────────────────────────────
    if (req.method === 'POST' &&
      (pathname === '/v1/chat/completions' || pathname === '/chat')) {

      let body: ChatRequest & { stream?: boolean; model?: string; stream_options?: any };
      try {
        body = await req.json() as ChatRequest & { stream?: boolean; model?: string; stream_options?: any };
      } catch {
        return new Response(
          JSON.stringify({ error: { message: 'Invalid JSON body', type: 'invalid_request_error' } }),
          { status: 400, headers: withCors({ 'Content-Type': 'application/json' }) }
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { stream: wantsStream = true, model = 'auto', stream_options: _so, ...chatRequest } = body;
      const id = genId();
      const useAuto = !model || ['auto', 'img', 'tools'].includes(model);
      const forceTools = model === 'tools';
      const forceVision = model === 'img';

      const hasTools = !!(chatRequest.tools?.length);
      if (hasTools) {
        console.log(`[Tools] Request includes ${chatRequest.tools!.length} tool(s)`);
      }

      try {
        const { stream, serviceName } = useAuto
          ? await tryServices(chatRequest, id, forceTools, forceVision)
          : await trySpecificService(model, chatRequest, id);

        // ── Streaming ──────────────────────────────────────────────────────
        if (wantsStream) {
          return new Response(withErrorBoundary(stream, serviceName), {
            headers: withCors({
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
              'X-Service': serviceName,
            }),
          });
        }

        // ── Non-streaming ──────────────────────────────────────────────────
        const { content, tool_calls, finish_reason } = await collectSSE(stream);
        const created = Math.floor(Date.now() / 1000);

        const message: any = { role: 'assistant', content: content || null };
        if (tool_calls.length) message.tool_calls = tool_calls;

        return new Response(
          JSON.stringify({
            id,
            object: 'chat.completion',
            created,
            model: serviceName,
            choices: [{ index: 0, message, finish_reason }],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          }),
          { headers: withCors({ 'Content-Type': 'application/json', 'X-Service': serviceName }) }
        );

      } catch (err: any) {
        const httpStatus = err?.httpStatus ?? 502;
        const headers = withCors({ 'Content-Type': 'application/json' });
        if (err?.retryAfter) headers['Retry-After'] = String(err.retryAfter);

        return new Response(
          JSON.stringify({
            error: {
              message: err.message ?? 'Request failed',
              type: err.code ?? 'service_unavailable',
              details: err.details ?? [],
            },
          }),
          { status: httpStatus, headers }
        );
      }
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: withCors({ 'Content-Type': 'application/json' }),
    });
  },
});

console.log(`Server running on ${server.url}`);
console.log(`Services: ${states.length} total | ${states.filter(s => !s.disabled).length} enabled | ${states.filter(s => s.service.supportsTools).length} support tools`);
console.log(`OpenAI-compatible: ${server.url}v1/chat/completions`);

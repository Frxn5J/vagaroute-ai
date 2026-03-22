import { tryServices, trySpecificService, states, resetStates } from './core/pool';
import { withCors } from './utils/cors';
import { isAuthorized } from './middlewares/auth';
import { isRateLimited } from './middlewares/rateLimit';
import { genId, withErrorBoundary, collectSSE } from './utils/stream';
import { logger } from './utils/logger';
import type { ChatRequest } from './types';

const startTime = Date.now();

const server = Bun.serve({
  port: process.env.PORT ?? 3000,
  hostname: '0.0.0.0',

  async fetch(req, server) {
    const { pathname } = new URL(req.url);

    // Rate Limit Check
    const ip = server.requestIP(req)?.address || req.headers.get("x-forwarded-for") || 'unknown-ip';
    if(pathname !== '/health' && isRateLimited(ip)) {
      return new Response(JSON.stringify({ error: { message: 'Too many requests', type: 'rate_limit_error'} }), {
         status: 429, headers: withCors({ 'Content-Type': 'application/json' })
      });
    }

    // ── CORS preflight ────────────────────────────────────────────────────────
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: withCors() });
    }

    // ── Auth check (skip /health) ─────────────────────────────────────────────
    if (pathname !== '/health' && !isAuthorized(req)) {
      logger.warn({ ip, pathname }, 'Unauthorized request attempt');
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
      if(resetStates(modelName)) {
         logger.info({ admin: true, modelName: modelName || 'all' }, 'Reset service(s) requested via Admin');
         return new Response(JSON.stringify({ ok: true, reset: modelName || 'all' }),
          { headers: withCors({ 'Content-Type': 'application/json' }) });
      }
      return new Response(JSON.stringify({ error: `Model '${modelName}' not found` }),
        { status: 404, headers: withCors({ 'Content-Type': 'application/json' }) });
    }

    // ── Status ───────────────────────────────────────────────────────────────
    if (req.method === 'GET' && pathname === '/status') {
      const now = Date.now();
      const report = states.map(s => ({
        name: s.service.name,
        supportsTools: s.service.supportsTools,
        status: s.disabled ? 'disabled' : s.cooldownUntil > now ? `cooldown ${Math.ceil((s.cooldownUntil - now) / 1000)}s` : 'available',
      }));
      return new Response(JSON.stringify(report, null, 2), {
        headers: withCors({ 'Content-Type': 'application/json' }),
      });
    }

    // ── Image Generation ──────────────────────────────────────────────────────
    if (req.method === 'POST' && pathname === '/v1/images/generations') {
      try {
        const body = await req.json() as any;
        if (!body.prompt) throw new Error("Falta el parámetro 'prompt' para generar la imagen");
        
        logger.info({ prompt: body.prompt, model: body.model }, 'Servicio Imagen Solicitado');
        const apiKey = process.env.POLLINATIONS_API_KEY?.trim();
        const targetModel = body.model && body.model !== 'auto' ? body.model : 'flux';
        
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        const originalResponseFormat = body.response_format || 'url';
        const res = await fetch('https://gen.pollinations.ai/v1/images/generations', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            prompt: body.prompt, model: targetModel, n: body.n || 1, size: body.size || '1024x1024',
            quality: body.quality, response_format: 'b64_json'
          })
        });

        if (!res.ok) throw new Error(`Pollinations API Error: ${await res.text()}`);
        const json = await res.json() as any;
        if (originalResponseFormat === 'url' && json.data && Array.isArray(json.data)) {
          json.data = json.data.map((item: any) => {
            if (item.b64_json) { item.url = `data:image/jpeg;base64,${item.b64_json}`; delete item.b64_json; }
            return item;
          });
        }
        return new Response(JSON.stringify(json), { headers: withCors({ 'Content-Type': 'application/json' }) });
      } catch (err: any) {
        logger.error({ error: err.message }, 'Error in Image Generation');
        return new Response(JSON.stringify({ error: { message: err.message } }), 
          { status: 400, headers: withCors({ 'Content-Type': 'application/json' }) }
        );
      }
    }

    // ── Audio Transcriptions ──────────────────────────────────────────────────
    if (req.method === 'POST' && pathname === '/v1/audio/transcriptions') {
      try {
        const formData = await req.formData();
        const file = formData.get('file') as File;
        if (!file) throw new Error("Falta el campo 'file' en el FormData");

        logger.info({ file: file.name }, 'Servicio Transcripción Solicitado');
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) throw new Error("Falta GROQ_API_KEY en .env para transcripciones");

        const groqForm = new FormData();
        groqForm.append('file', file);
        groqForm.append('model', 'whisper-large-v3'); 
        const lang = formData.get('language');
        if (lang) groqForm.append('language', lang);

        const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}` },
          body: groqForm
        });

        if (!res.ok) throw new Error(`Groq Audio Error: ${await res.text()}`);
        return new Response(JSON.stringify(await res.json()), { headers: withCors({ 'Content-Type': 'application/json' }) });
      } catch (err: any) {
        logger.error({ error: err.message }, 'Error in Audio Transcription');
        return new Response(JSON.stringify({ error: { message: err.message } }), { status: 500, headers: withCors({ 'Content-Type': 'application/json' }) });
      }
    }

    // ── Embeddings ────────────────────────────────────────────────────────────
    if (req.method === 'POST' && pathname === '/v1/embeddings') {
      try {
        const body = await req.json() as any;
        const texts = Array.isArray(body.input) ? body.input : [body.input];
        logger.info({ textsLength: texts.length }, 'Servicio Embeddings Solicitado');

        if (process.env.MISTRAL_API_KEY) {
          const res = await fetch('https://api.mistral.ai/v1/embeddings', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ input: texts, model: 'mistral-embed' })
          });
          if (res.ok) return new Response(await res.text(), { headers: withCors({ 'Content-Type': 'application/json' }) });
        }

        if (process.env.COHERE_API_KEY) {
          const res = await fetch('https://api.cohere.com/v1/embed', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${process.env.COHERE_API_KEY}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ texts, model: 'embed-multilingual-v3.0', input_type: 'search_document' })
          });
          if (res.ok) {
            const dataHash = await res.json() as any;
            const openAiFormat = {
              object: "list", model: "cohere/embed-multilingual",
              data: dataHash.embeddings.map((emb: number[], i: number) => ({ object: "embedding", embedding: emb, index: i })),
              usage: { prompt_tokens: dataHash.meta?.billed_units?.input_tokens ?? 0, total_tokens: dataHash.meta?.billed_units?.input_tokens ?? 0 }
            };
            return new Response(JSON.stringify(openAiFormat), { headers: withCors({ 'Content-Type': 'application/json' }) });
          }
        }
        throw new Error("No hay proveedores de Embeddings disponibles (Asegúrate de tener MISTRAL_API_KEY o COHERE_API_KEY)");
      } catch (err: any) {
        logger.error({ error: err.message }, 'Error in Embeddings');
        return new Response(JSON.stringify({ error: { message: err.message } }), { status: 500, headers: withCors({ 'Content-Type': 'application/json' }) });
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
        id: s.service.name, object: 'model', created: Math.floor(now / 1000), owned_by: s.service.name.split('/')[0],
        supports_tools: s.service.supportsTools, status: s.cooldownUntil > now ? 'cooldown' : 'available',
      }));
      return new Response(JSON.stringify({ object: 'list', data: [...virtualModels, ...data] }, null, 2), {
        headers: withCors({ 'Content-Type': 'application/json' }),
      });
    }

    // ── Chat completions ─────────────────────────────────────────────────────
    if (req.method === 'POST' && (pathname === '/v1/chat/completions' || pathname === '/chat')) {
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

      logger.info({ reqId: id, model, hasTools, stream: wantsStream }, `Initiating Chat Completion`);

      try {
        const { stream, serviceName } = useAuto
          ? await tryServices(chatRequest, id, forceTools, forceVision)
          : await trySpecificService(model, chatRequest, id);

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

        const { content, tool_calls, finish_reason } = await collectSSE(stream);
        const created = Math.floor(Date.now() / 1000);
        const message: any = { role: 'assistant', content: content || null };
        if (tool_calls.length) message.tool_calls = tool_calls;

        return new Response(
          JSON.stringify({
            id, object: 'chat.completion', created, model: serviceName,
            choices: [{ index: 0, message, finish_reason }],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          }),
          { headers: withCors({ 'Content-Type': 'application/json', 'X-Service': serviceName }) }
        );
      } catch (err: any) {
        const httpStatus = err?.httpStatus ?? 502;
        const headers = withCors({ 'Content-Type': 'application/json' });
        if (err?.retryAfter) headers['Retry-After'] = String(err.retryAfter);
        
        logger.error({ err, httpStatus }, 'Chat completion entirely failed');
        return new Response(
          JSON.stringify({ error: { message: err.message ?? 'Request failed', type: err.code ?? 'service_unavailable', details: err.details ?? [] } }),
          { status: httpStatus, headers }
        );
      }
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404, headers: withCors({ 'Content-Type': 'application/json' }),
    });
  },
});

logger.info(`Server running on ${server.url}`);
logger.info(`Services: ${states.length} total | ${states.filter(s => !s.disabled).length} enabled`);
logger.info(`OpenAI-compatible endpoints mapped.`);

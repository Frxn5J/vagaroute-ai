import type { AuthContext } from '../middlewares/auth';
import {
  buildUsageEstimate,
  estimateEmbeddingsUsage,
  extractAudioSecondsFromPayload,
} from '../core/usageLimits';
import { ensureProviderLimitAvailable } from '../core/providerLimits';
import { getProviderKeyCandidates, withProviderKey } from '../core/providerKeys';
import {
  buildProviderError,
  errorResponse,
  getHttpStatusFromError,
  jsonResponse,
  readJsonBody,
  recordServiceMetric,
  type RouteContext,
} from './_shared';

// ─── Audio helpers ──────────────────────────────────────────────────────────

type AudioTranscriptionProvider = 'groq' | 'witai';

function normalizeAudioProvider(value: unknown): AudioTranscriptionProvider {
  if (typeof value !== 'string' || !value.trim()) return 'groq';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'groq') return 'groq';
  if (normalized === 'witai' || normalized === 'wit.ai' || normalized === 'wit') return 'witai';
  throw Object.assign(new Error(`Proveedor de audio no soportado: ${value}`), {
    code: 'audio_provider_invalid',
    httpStatus: 400,
  });
}

function getAudioProviderMeta(provider: AudioTranscriptionProvider): { provider: string; model: string } {
  if (provider === 'witai') return { provider: 'witai', model: 'speech' };
  return { provider: 'groq', model: 'whisper-large-v3' };
}

function getAudioContentType(file: File): string {
  if (file.type?.trim()) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith('.wav')) return 'audio/wav';
  if (name.endsWith('.mp3')) return 'audio/mpeg';
  if (name.endsWith('.m4a')) return 'audio/mp4';
  if (name.endsWith('.ogg')) return 'audio/ogg';
  if (name.endsWith('.webm')) return 'audio/webm';
  if (name.endsWith('.flac')) return 'audio/flac';
  return 'application/octet-stream';
}

async function transcribeAudioWithGroq(file: File, language: string | null): Promise<unknown> {
  return await withProviderKey('groq', async ({ key }) => {
    const form = new FormData();
    form.append('file', file);
    form.append('model', 'whisper-large-v3');
    if (language) form.append('language', language);

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!response.ok) throw buildProviderError(response.status, await response.text(), response.headers);
    return await response.json();
  });
}

async function transcribeAudioWithWitAi(file: File): Promise<Record<string, unknown>> {
  const raw = await withProviderKey('witai', async ({ key }) => {
    const response = await fetch('https://api.wit.ai/speech?v=20200513', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
        'Content-Type': getAudioContentType(file),
      },
      body: file,
    });
    if (!response.ok) throw buildProviderError(response.status, await response.text(), response.headers);
    return await response.json() as Record<string, unknown>;
  });

  const text =
    typeof raw.text === 'string' ? raw.text : typeof raw._text === 'string' ? raw._text : '';
  return typeof raw.text === 'string' ? raw : { ...raw, text };
}

// ─── Route handlers ─────────────────────────────────────────────────────────

export async function handleMedia(
  req: Request,
  auth: AuthContext,
  ctx: RouteContext,
): Promise<Response | null> {
  const { pathname, ip, startedAt } = ctx;

  // ── Image generation ──────────────────────────────────────────────────────

  if (req.method === 'POST' && pathname === '/v1/images/generations') {
    try {
      const body = await readJsonBody<{
        prompt?: string;
        model?: string;
        n?: number;
        size?: string;
        quality?: string;
        response_format?: 'url' | 'b64_json';
      }>(req);

      if (!body.prompt) throw new Error("Falta el parametro 'prompt' para generar la imagen");

      const targetModel = body.model && body.model !== 'auto' ? body.model : 'flux';
      const usageEstimate = buildUsageEstimate({ requests: 1 });
      ensureProviderLimitAvailable('pollinations', usageEstimate);

      const pollinationKeys = getProviderKeyCandidates('pollinations');
      const payload = {
        prompt: body.prompt,
        model: targetModel,
        n: body.n || 1,
        size: body.size || '1024x1024',
        quality: body.quality,
        response_format: 'b64_json',
      };

      let json: { data?: Array<Record<string, unknown>> };

      if (pollinationKeys.length > 0) {
        json = await withProviderKey('pollinations', async ({ key }) => {
          const response = await fetch('https://gen.pollinations.ai/v1/images/generations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify(payload),
          });
          if (!response.ok) throw buildProviderError(response.status, await response.text(), response.headers);
          return await response.json() as { data?: Array<Record<string, unknown>> };
        });
      } else {
        const response = await fetch('https://gen.pollinations.ai/v1/images/generations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error(await response.text());
        json = await response.json() as { data?: Array<Record<string, unknown>> };
      }

      if ((body.response_format || 'url') === 'url' && Array.isArray(json.data)) {
        json.data = json.data.map((item) => {
          const next = { ...item };
          if (typeof next.b64_json === 'string') {
            next.url = `data:image/jpeg;base64,${next.b64_json}`;
            delete next.b64_json;
          }
          return next;
        });
      }

      recordServiceMetric(req, auth, ip, {
        requestType: 'images',
        provider: 'pollinations',
        model: targetModel,
        statusCode: 200,
        durationMs: Date.now() - startedAt,
        totalTokens: usageEstimate.totalTokens,
      });
      return jsonResponse(req, json);
    } catch (err) {
      const message = (err as { message?: string })?.message ?? 'Image generation failed';
      const status = getHttpStatusFromError(err, 400);
      recordServiceMetric(req, auth, ip, {
        requestType: 'images',
        provider: 'pollinations',
        model: null,
        statusCode: status,
        durationMs: Date.now() - startedAt,
        errorMessage: message,
      });
      return errorResponse(req, status, message, 'image_error');
    }
  }

  // ── Audio transcription ───────────────────────────────────────────────────

  if (req.method === 'POST' && pathname === '/v1/audio/transcriptions') {
    let providerMeta = getAudioProviderMeta('groq');
    let estimatedAudioSeconds = 0;
    try {
      const formData = await req.formData();
      const provider = normalizeAudioProvider(formData.get('provider'));
      providerMeta = getAudioProviderMeta(provider);
      const file = formData.get('file');
      if (!(file instanceof File)) throw new Error("Falta el campo 'file' en el FormData");

      const language =
        typeof formData.get('language') === 'string' && String(formData.get('language')).trim()
          ? String(formData.get('language')).trim()
          : null;
      const durationField = Number(formData.get('duration_seconds') ?? formData.get('audio_seconds') ?? 0);
      estimatedAudioSeconds = Number.isFinite(durationField) && durationField > 0 ? Math.ceil(durationField) : 0;

      const usageEstimate = buildUsageEstimate({ requests: 1, audioSeconds: estimatedAudioSeconds });
      ensureProviderLimitAvailable(provider, usageEstimate);

      const json =
        provider === 'witai'
          ? await transcribeAudioWithWitAi(file)
          : await transcribeAudioWithGroq(file, language);

      const actualAudioSeconds = extractAudioSecondsFromPayload(json) || estimatedAudioSeconds;
      recordServiceMetric(req, auth, ip, {
        requestType: 'audio',
        provider: providerMeta.provider,
        model: providerMeta.model,
        statusCode: 200,
        durationMs: Date.now() - startedAt,
        audioSeconds: actualAudioSeconds,
      });
      return jsonResponse(req, json);
    } catch (err) {
      const message = (err as { message?: string })?.message ?? 'Audio transcription failed';
      const status = getHttpStatusFromError(err, 500);
      recordServiceMetric(req, auth, ip, {
        requestType: 'audio',
        provider: providerMeta.provider,
        model: providerMeta.model,
        statusCode: status,
        durationMs: Date.now() - startedAt,
        audioSeconds: estimatedAudioSeconds,
        errorMessage: message,
      });
      return errorResponse(req, status, message, 'audio_error');
    }
  }

  // ── Embeddings ────────────────────────────────────────────────────────────

  if (req.method === 'POST' && pathname === '/v1/embeddings') {
    try {
      const body = await readJsonBody<{ input: string | string[] }>(req);
      const texts = Array.isArray(body.input) ? body.input : [body.input];
      if (texts.length === 0) throw new Error('No hay textos para generar embeddings');

      const usageEstimate = estimateEmbeddingsUsage(texts);

      try {
        ensureProviderLimitAvailable('mistral', usageEstimate);
        const data = await withProviderKey('mistral', async ({ key }) => {
          const response = await fetch('https://api.mistral.ai/v1/embeddings', {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ input: texts, model: 'mistral-embed' }),
          });
          if (!response.ok) throw buildProviderError(response.status, await response.text(), response.headers);
          return await response.json();
        });

        recordServiceMetric(req, auth, ip, {
          requestType: 'embeddings',
          provider: 'mistral',
          model: 'mistral-embed',
          statusCode: 200,
          durationMs: Date.now() - startedAt,
          promptTokens: usageEstimate.promptTokens,
          totalTokens: usageEstimate.totalTokens,
        });
        return jsonResponse(req, data);
      } catch {
        // Fallback to Cohere
        ensureProviderLimitAvailable('cohere', usageEstimate);
        const data = await withProviderKey('cohere', async ({ key }) => {
          const response = await fetch('https://api.cohere.com/v1/embed', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${key}`,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({ texts, model: 'embed-multilingual-v3.0', input_type: 'search_document' }),
          });
          if (!response.ok) throw buildProviderError(response.status, await response.text(), response.headers);
          const payload = await response.json() as {
            embeddings: number[][];
            meta?: { billed_units?: { input_tokens?: number } };
          };
          return {
            object: 'list',
            model: 'cohere/embed-multilingual',
            data: payload.embeddings.map((embedding, index) => ({ object: 'embedding', embedding, index })),
            usage: {
              prompt_tokens: payload.meta?.billed_units?.input_tokens ?? 0,
              total_tokens: payload.meta?.billed_units?.input_tokens ?? 0,
            },
          };
        });

        recordServiceMetric(req, auth, ip, {
          requestType: 'embeddings',
          provider: 'cohere',
          model: 'embed-multilingual-v3.0',
          statusCode: 200,
          durationMs: Date.now() - startedAt,
          promptTokens: usageEstimate.promptTokens,
          totalTokens: usageEstimate.totalTokens,
        });
        return jsonResponse(req, data);
      }
    } catch (err) {
      const message = (err as { message?: string })?.message ?? 'Embeddings failed';
      const status = getHttpStatusFromError(err, 500);
      recordServiceMetric(req, auth, ip, {
        requestType: 'embeddings',
        provider: null,
        model: null,
        statusCode: status,
        durationMs: Date.now() - startedAt,
        totalTokens: 0,
        errorMessage: message,
      });
      return errorResponse(req, status, message, 'embeddings_error');
    }
  }

  return null;
}

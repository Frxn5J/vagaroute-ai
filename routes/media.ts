import type { AuthContext } from '../middlewares/auth';
import {
  buildUsageEstimate,
  estimateEmbeddingsUsage,
  extractAudioSecondsFromPayload,
  normalizeProviderId,
} from '../core/usageLimits';
import { ensureProviderLimitAvailable } from '../core/providerLimits';
import { getProviderKeyCandidates, withProviderKey } from '../core/providerKeys';
import {
  getDecryptedCustomProviderKey,
  listActiveCustomMediaModels,
  type CustomProviderMediaModel,
} from '../core/customProviders';
import { resolveModelAliasByCategory } from '../core/db';
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

type ImageGenerationProvider = 'pollinations' | 'qwenchat';
type QwenMediaProvider = 'qwenchat';

type AudioTranscriptionProvider = 'groq' | 'witai';

const QWEN_API_BASE_URL = 'https://qwen.aikit.club/v1';

function buildCustomProviderHeaders(provider: CustomProviderMediaModel): Headers {
  const headers = new Headers({ Accept: 'application/json' });
  const apiKey = getDecryptedCustomProviderKey(provider.providerId);
  if (!apiKey) {
    return headers;
  }
  if (provider.protocol === 'gemini') {
    headers.set('x-goog-api-key', apiKey);
  } else if (provider.protocol === 'anthropic') {
    headers.set('x-api-key', apiKey);
    headers.set('anthropic-version', '2023-06-01');
  } else {
    headers.set('Authorization', `Bearer ${apiKey}`);
  }
  return headers;
}

function normalizeCustomProviderBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function normalizeCustomProviderHint(value: unknown): string | null {
  const normalized = normalizeProviderId(typeof value === 'string' ? value : '');
  return normalized || null;
}

function findCustomMediaProviderModel(kind: 'images' | 'videos', model: unknown, providerHint: unknown): CustomProviderMediaModel | null {
  const resolvedModel = resolveMultimediaModel(model, kind);
  const requestedModel = normalizeRequestedModel(resolvedModel);
  const normalizedProviderHint = normalizeCustomProviderHint(providerHint);
  const candidates = listActiveCustomMediaModels(kind);

  if (requestedModel) {
    const matched = candidates.find((item) => `${item.providerSlug}/${item.model.id}` === requestedModel || item.model.id === requestedModel);
    if (matched && (!normalizedProviderHint || normalizeProviderId(matched.providerSlug) === normalizedProviderHint)) {
      return matched;
    }
  }

  if (normalizedProviderHint) {
    return candidates.find((item) => normalizeProviderId(item.providerSlug) === normalizedProviderHint) ?? null;
  }

  return null;
}

async function requestCustomProviderJson<T>(provider: CustomProviderMediaModel, path: string, payload: unknown): Promise<T> {
  const headers = buildCustomProviderHeaders(provider);
  headers.set('Content-Type', 'application/json');

  const response = await fetch(`${normalizeCustomProviderBaseUrl(provider.baseUrl)}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw buildProviderError(response.status, await response.text(), response.headers);
  }

  return await response.json() as T;
}

function normalizeRequestedModel(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  return value.trim();
}

function normalizeRequestedModelId(value: unknown): string {
  return normalizeProviderId(normalizeRequestedModel(value) ?? '');
}

function hasQwenMediaKeysConfigured(): boolean {
  return getProviderKeyCandidates('qwenchat').length > 0;
}

function isOpenAiImageAlias(modelId: string): boolean {
  return modelId === 'gptimage1' || modelId === 'dalle2' || modelId === 'dalle3';
}

function isQwenImageModel(modelId: string): boolean {
  return modelId.includes('qwen')
    || modelId.includes('wan')
    || modelId === 'imagegeneration'
    || modelId === 'qwenimage';
}

function isPollinationsImageModel(modelId: string): boolean {
  return modelId.includes('flux')
    || modelId.includes('sdxl')
    || modelId.includes('turbo')
    || modelId.includes('playground')
    || modelId.includes('illustrious');
}

// Resolve model alias for multimedia before any provider logic
function resolveMultimediaModel(model: unknown, category: 'images' | 'imageEdit' | 'videos'): string {
  const requestedModel = normalizeRequestedModel(model);
  if (!requestedModel) {
    return requestedModel ?? '';
  }
  
  // Try to resolve alias by category
  const resolved = resolveModelAliasByCategory(requestedModel, category);
  return resolved ?? requestedModel;
}

function resolveImageGenerationProvider(value: unknown, model: unknown): ImageGenerationProvider {
  if (value != null && value !== '') {
    return normalizeImageGenerationProvider(value);
  }

  // Resolve alias first before deciding provider
  const resolvedModel = resolveMultimediaModel(model, 'images');
  const modelId = normalizeRequestedModelId(resolvedModel);
  if (!modelId || modelId === 'auto') {
    return hasQwenMediaKeysConfigured() ? 'qwenchat' : 'pollinations';
  }
  if (isOpenAiImageAlias(modelId) || isQwenImageModel(modelId)) {
    return 'qwenchat';
  }
  if (isPollinationsImageModel(modelId)) {
    return 'pollinations';
  }

  return hasQwenMediaKeysConfigured() ? 'qwenchat' : 'pollinations';
}

function resolveQwenImageModel(model: unknown): string | null {
  // First resolve any alias for images category
  const resolvedModel = resolveMultimediaModel(model, 'images');
  const requestedModel = normalizeRequestedModel(resolvedModel);
  const requestedModelId = normalizeRequestedModelId(requestedModel);

  if (!requestedModel || requestedModelId === 'auto' || isOpenAiImageAlias(requestedModelId)) {
    return null;
  }

  return requestedModel;
}

function resolveQwenImageMetricModel(model: unknown): string {
  const upstreamModel = resolveQwenImageModel(model);
  return upstreamModel ?? 'qwen-image';
}

function resolveQwenImageEditMetricModel(model: unknown): string {
  // First resolve any alias for imageEdit category
  const resolvedModel = resolveMultimediaModel(model, 'imageEdit');
  const requestedModel = normalizeRequestedModel(resolvedModel);
  const requestedModelId = normalizeRequestedModelId(requestedModel);

  if (!requestedModel || requestedModelId === 'auto' || isOpenAiImageAlias(requestedModelId)) {
    return 'qwen-image-edit';
  }

  return requestedModel;
}

function resolvePollinationsImageModel(model: unknown): string {
  // First resolve any alias for images category
  const resolvedModel = resolveMultimediaModel(model, 'images');
  const requestedModel = normalizeRequestedModel(resolvedModel);
  const requestedModelId = normalizeRequestedModelId(requestedModel);

  if (!requestedModel || requestedModelId === 'auto' || isOpenAiImageAlias(requestedModelId) || isQwenImageModel(requestedModelId)) {
    return 'flux';
  }

  return requestedModel;
}

function resolveQwenVideoModel(model: unknown): string | null {
  // First resolve any alias for videos category
  const resolvedModel = resolveMultimediaModel(model, 'videos');
  const requestedModel = normalizeRequestedModel(resolvedModel);
  const requestedModelId = normalizeRequestedModelId(requestedModel);

  if (!requestedModel || requestedModelId === 'auto' || requestedModelId === 'sora2' || requestedModelId === 'sora2pro') {
    return null;
  }

  return requestedModel;
}

function resolveQwenVideoMetricModel(model: unknown): string {
  const upstreamModel = resolveQwenVideoModel(model);
  return upstreamModel ?? 'qwen-video';
}

function normalizeImageGenerationProvider(value: unknown): ImageGenerationProvider {
  if (value == null || value === '') {
    return 'pollinations';
  }

  const normalized = normalizeProviderId(typeof value === 'string' ? value : '');
  if (normalized === 'pollinations') {
    return 'pollinations';
  }
  if (normalized === 'qwenchat' || normalized === 'qwen') {
    return 'qwenchat';
  }

  throw Object.assign(new Error(`Proveedor de imagenes no soportado: ${value}`), {
    code: 'image_provider_invalid',
    httpStatus: 400,
  });
}

function normalizeQwenMediaProvider(value: unknown): QwenMediaProvider {
  if (value == null || value === '') {
    return 'qwenchat';
  }

  const normalized = normalizeProviderId(typeof value === 'string' ? value : '');
  if (normalized === 'qwenchat' || normalized === 'qwen') {
    return 'qwenchat';
  }

  throw Object.assign(new Error(`Solo Qwen Chat esta soportado para este endpoint: ${value}`), {
    code: 'media_provider_invalid',
    httpStatus: 400,
  });
}

function cloneFormDataWithout(
  formData: { entries(): IterableIterator<[string, string | Blob]> },
  keysToOmit: string[],
): FormData {
  const cloned = new FormData();
  const omitted = new Set(keysToOmit);

  for (const [key, value] of formData.entries()) {
    if (omitted.has(key)) {
      continue;
    }
    cloned.append(key, value);
  }

  return cloned;
}

async function requestQwenJson<T>(path: string, payload: unknown): Promise<T> {
  return await withProviderKey('qwenchat', async ({ key }) => {
    const response = await fetch(`${QWEN_API_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw buildProviderError(response.status, await response.text(), response.headers);
    }

    return await response.json() as T;
  });
}

async function requestQwenFormData<T>(path: string, payload: unknown): Promise<T> {
  return await withProviderKey('qwenchat', async ({ key }) => {
    const response = await fetch(`${QWEN_API_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
      },
      body: payload as never,
    });

    if (!response.ok) {
      throw buildProviderError(response.status, await response.text(), response.headers);
    }

    return await response.json() as T;
  });
}

async function convertImageUrlsToB64Json<T extends { data?: Array<Record<string, unknown>> }>(payload: T): Promise<T> {
  if (!Array.isArray(payload.data)) {
    return payload;
  }

  const convertedData = await Promise.all(payload.data.map(async (item) => {
    const url = typeof item.url === 'string' ? item.url : null;
    if (!url) {
      return item;
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw buildProviderError(response.status, await response.text(), response.headers);
    }

    const bytes = await response.arrayBuffer();
    const base64 = Buffer.from(bytes).toString('base64');
    const next: Record<string, unknown> = { ...item, b64_json: base64 };
    delete next.url;
    return next;
  }));

  return {
    ...payload,
    data: convertedData,
  };
}

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

  if (req.method === 'POST' && (pathname === '/v1/images/generations' || pathname === '/v1/images')) {
    let imageProvider: ImageGenerationProvider = 'pollinations';
    let imageModel: string | null = null;
    let customImageProvider: CustomProviderMediaModel | null = null;

    try {
      const body = await readJsonBody<{
        prompt?: string;
        provider?: string;
        model?: string;
        n?: number;
        size?: string;
        quality?: string;
        response_format?: 'url' | 'b64_json';
      }>(req);

      if (!body.prompt) throw new Error("Falta el parametro 'prompt' para generar la imagen");

      const usageEstimate = buildUsageEstimate({ requests: 1 });
      customImageProvider = findCustomMediaProviderModel('images', body.model, body.provider);

      if (customImageProvider) {
        imageModel = `${customImageProvider.providerSlug}/${customImageProvider.model.id}`;
        const providerId = normalizeProviderId(customImageProvider.providerSlug);
        ensureProviderLimitAvailable(providerId, usageEstimate);
        const json = await requestCustomProviderJson<{ data?: Array<Record<string, unknown>> }>(
          customImageProvider,
          '/images/generations',
          {
            prompt: body.prompt,
            model: customImageProvider.model.id,
            n: body.n || 1,
            size: body.size || '1024x1024',
            quality: body.quality,
            response_format: body.response_format,
          },
        );
        recordServiceMetric(req, auth, ip, {
          requestType: 'images',
          provider: providerId,
          model: imageModel,
          statusCode: 200,
          durationMs: Date.now() - startedAt,
          totalTokens: usageEstimate.totalTokens,
        });
        return jsonResponse(req, json);
      }

      imageProvider = resolveImageGenerationProvider(body.provider, body.model);

      if (imageProvider === 'qwenchat') {
        ensureProviderLimitAvailable('qwenchat', usageEstimate);
        imageModel = resolveQwenImageMetricModel(body.model);
        const upstreamModel = resolveQwenImageModel(body.model);

        const payload: Record<string, unknown> = {
          prompt: body.prompt,
        };
        if (typeof body.size === 'string' && body.size.trim()) {
          payload.size = body.size.trim();
        }
        if (upstreamModel) {
          payload.model = upstreamModel;
        }

        let json = await requestQwenJson<{ data?: Array<Record<string, unknown>> }>('/images/generations', payload);
        if (body.response_format === 'b64_json') {
          json = await convertImageUrlsToB64Json(json);
        }
        recordServiceMetric(req, auth, ip, {
          requestType: 'images',
          provider: 'qwenchat',
          model: imageModel,
          statusCode: 200,
          durationMs: Date.now() - startedAt,
          totalTokens: usageEstimate.totalTokens,
        });
        return jsonResponse(req, json);
      }

      const targetModel = resolvePollinationsImageModel(body.model);
      imageModel = targetModel;
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
        model: imageModel,
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
        provider: customImageProvider ? normalizeProviderId(customImageProvider.providerSlug) : imageProvider,
        model: imageModel,
        statusCode: status,
        durationMs: Date.now() - startedAt,
        errorMessage: message,
      });
      return errorResponse(req, status, message, 'image_error');
    }
  }

  // ── Image editing ─────────────────────────────────────────────────────────

  if (req.method === 'POST' && (pathname === '/v1/images/edits' || pathname === '/v1/images/edit')) {
    let imageModel: string | null = 'image-edit';

    try {
      const usageEstimate = buildUsageEstimate({ requests: 1 });

      let json: { data?: Array<Record<string, unknown>> } | Record<string, unknown>;
      const contentType = req.headers.get('content-type') ?? '';

      if (contentType.includes('multipart/form-data')) {
        const formData = await req.formData();
        normalizeQwenMediaProvider(formData.get('provider'));

        const prompt = formData.get('prompt');
        const image = formData.get('image');
        if (typeof prompt !== 'string' || !prompt.trim()) {
          throw new Error("Falta el parametro 'prompt' para editar la imagen");
        }
        if (!(image instanceof File) && (typeof image !== 'string' || !image.trim())) {
          throw new Error("Falta el parametro 'image' para editar la imagen");
        }

        imageModel = resolveQwenImageEditMetricModel(formData.get('model'));

        ensureProviderLimitAvailable('qwenchat', usageEstimate);
        const forwardedForm = cloneFormDataWithout(formData, ['provider']);
        const upstreamModel = resolveQwenImageModel(formData.get('model'));
        if (!upstreamModel && typeof formData.get('model') === 'string') {
          forwardedForm.delete('model');
        }

        json = await requestQwenFormData<{ data?: Array<Record<string, unknown>> }>('/images/edits', forwardedForm);
        if (formData.get('response_format') === 'b64_json') {
          json = await convertImageUrlsToB64Json(json);
        }
      } else {
        const body = await readJsonBody<{
          prompt?: string;
          image?: string;
          provider?: string;
          model?: string;
          response_format?: 'url' | 'b64_json';
        }>(req);

        normalizeQwenMediaProvider(body.provider);

        if (!body.prompt?.trim()) {
          throw new Error("Falta el parametro 'prompt' para editar la imagen");
        }
        if (!body.image?.trim()) {
          throw new Error("Falta el parametro 'image' para editar la imagen");
        }
        imageModel = resolveQwenImageEditMetricModel(body.model);
        const upstreamModel = resolveQwenImageModel(body.model);

        const payload: Record<string, unknown> = {
          prompt: body.prompt,
          image: body.image,
        };
        if (upstreamModel) {
          payload.model = upstreamModel;
        }

        ensureProviderLimitAvailable('qwenchat', usageEstimate);
        json = await requestQwenJson<{ data?: Array<Record<string, unknown>> }>('/images/edits', payload);
        if (body.response_format === 'b64_json') {
          json = await convertImageUrlsToB64Json(json);
        }
      }

      recordServiceMetric(req, auth, ip, {
        requestType: 'images',
        provider: 'qwenchat',
        model: imageModel,
        statusCode: 200,
        durationMs: Date.now() - startedAt,
        totalTokens: usageEstimate.totalTokens,
      });
      return jsonResponse(req, json);
    } catch (err) {
      const message = (err as { message?: string })?.message ?? 'Image editing failed';
      const status = getHttpStatusFromError(err, 400);
      recordServiceMetric(req, auth, ip, {
        requestType: 'images',
        provider: 'qwenchat',
        model: imageModel,
        statusCode: status,
        durationMs: Date.now() - startedAt,
        errorMessage: message,
      });
      return errorResponse(req, status, message, 'image_edit_error');
    }
  }

  // ── Video generation ──────────────────────────────────────────────────────

  if (req.method === 'POST' && (pathname === '/v1/videos/generations' || pathname === '/v1/videos')) {
    let videoModel: string | null = 'video-generation';
    let customVideoProvider: CustomProviderMediaModel | null = null;

    try {
      const body = await readJsonBody<{
        prompt?: string;
        provider?: string;
        model?: string;
        size?: string;
      }>(req);

      normalizeQwenMediaProvider(body.provider);

      if (!body.prompt?.trim()) {
        throw new Error("Falta el parametro 'prompt' para generar el video");
      }

      const usageEstimate = buildUsageEstimate({ requests: 1 });
      customVideoProvider = findCustomMediaProviderModel('videos', body.model, body.provider);
      if (customVideoProvider) {
        videoModel = `${customVideoProvider.providerSlug}/${customVideoProvider.model.id}`;
        const providerId = normalizeProviderId(customVideoProvider.providerSlug);
        ensureProviderLimitAvailable(providerId, usageEstimate);
        const json = await requestCustomProviderJson(customVideoProvider, '/videos/generations', {
          prompt: body.prompt,
          model: customVideoProvider.model.id,
          size: body.size,
        });
        recordServiceMetric(req, auth, ip, {
          requestType: 'videos',
          provider: providerId,
          model: videoModel,
          statusCode: 200,
          durationMs: Date.now() - startedAt,
          totalTokens: usageEstimate.totalTokens,
        });
        return jsonResponse(req, json);
      }

      ensureProviderLimitAvailable('qwenchat', usageEstimate);

      videoModel = resolveQwenVideoMetricModel(body.model);
      const upstreamModel = resolveQwenVideoModel(body.model);

      const payload: Record<string, unknown> = {
        prompt: body.prompt,
      };
      if (typeof body.size === 'string' && body.size.trim()) {
        payload.size = body.size.trim();
      }
      if (upstreamModel) {
        payload.model = upstreamModel;
      }

      const json = await requestQwenJson('/videos/generations', payload);
      recordServiceMetric(req, auth, ip, {
        requestType: 'videos',
        provider: 'qwenchat',
        model: videoModel,
        statusCode: 200,
        durationMs: Date.now() - startedAt,
        totalTokens: usageEstimate.totalTokens,
      });
      return jsonResponse(req, json);
    } catch (err) {
      const message = (err as { message?: string })?.message ?? 'Video generation failed';
      const status = getHttpStatusFromError(err, 400);
      recordServiceMetric(req, auth, ip, {
        requestType: 'videos',
        provider: customVideoProvider ? normalizeProviderId(customVideoProvider.providerSlug) : 'qwenchat',
        model: videoModel,
        statusCode: status,
        durationMs: Date.now() - startedAt,
        errorMessage: message,
      });
      return errorResponse(req, status, message, 'video_error');
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

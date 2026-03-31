import type { AuthContext } from '../middlewares/auth';
import { getAppSettings, resolveModelAlias } from '../core/db';
import { states, tryServices, trySpecificService } from '../core/pool';
import { estimateChatUsage } from '../core/usageLimits';
import {
  buildChatCacheKey,
  getCachedResponse,
  setCachedResponse,
} from '../core/responseCache';
import { collectSSE, genId, observeSSE, withErrorBoundary } from '../utils/stream';
import { withCors } from '../utils/cors';
import { getRequestId } from '../utils/requestContext';
import type { ChatRequest } from '../types';
import {
  errorResponse,
  getHttpStatusFromError,
  getRetryAfterFromError,
  isChatCacheEligible,
  jsonResponse,
  readJsonBody,
  recordServiceMetric,
  resolveCacheScopeKey,
  resolveUsage,
  splitServiceName,
  type RouteContext,
} from './_shared';

export async function handleChat(
  req: Request,
  auth: AuthContext,
  ctx: RouteContext,
): Promise<Response | null> {
  const { pathname, ip, startedAt } = ctx;

  if (!(req.method === 'POST' && (pathname === '/v1/chat/completions' || pathname === '/chat'))) {
    return null;
  }

  if (states.length === 0) {
    return errorResponse(req, 503, 'No hay proveedores cargados', 'service_unavailable');
  }

  let body: ChatRequest & { stream?: boolean; model?: string; stream_options?: unknown };
  try {
    body = await readJsonBody<ChatRequest & { stream?: boolean; model?: string; stream_options?: unknown }>(req);
  } catch {
    return errorResponse(req, 400, 'Invalid JSON body', 'invalid_request_error');
  }

  const settings = getAppSettings();
  const {
    stream: wantsStream = true,
    model = settings.defaultChatModel || 'auto',
    stream_options: _ignored,
    ...chatRequest
  } = body;

  const id = genId();
  const useAuto = !model || ['auto', 'img', 'tools'].includes(model);
  const forceTools = model === 'tools';
  const forceVision = model === 'img';
  const resolvedModel = !useAuto ? (resolveModelAlias(model) ?? model) : model;
  const usageEstimate = estimateChatUsage(chatRequest);
  const cacheEligible = isChatCacheEligible(chatRequest, wantsStream);
  const cacheScopeKey = resolveCacheScopeKey(auth, req);
  const cacheKey = cacheEligible
    ? buildChatCacheKey({
        scopeKey: cacheScopeKey,
        model: String(resolvedModel || 'auto'),
        body: { ...chatRequest, model: String(resolvedModel || 'auto') },
      })
    : null;

  // Cache HIT
  if (cacheKey) {
    const cached = getCachedResponse(cacheKey, cacheScopeKey);
    if (cached) {
      const cachedResponse = cached.response as {
        model?: string;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const meta = splitServiceName(cached.model ?? cachedResponse.model ?? null);
      recordServiceMetric(req, auth, ip, {
        requestType: 'chat',
        provider: meta.provider,
        model: meta.model,
        statusCode: cached.statusCode,
        durationMs: Date.now() - startedAt,
        promptTokens: cached.promptTokens,
        completionTokens: cached.completionTokens,
        totalTokens: cached.totalTokens,
        estimatedCostUsd: 0,
      });
      return jsonResponse(req, cached.response, cached.statusCode, {
        'X-Cache': 'HIT',
        ...(cached.model ? { 'X-Service': cached.model } : {}),
      });
    }
  }

  // Dispatch
  try {
    const { stream, serviceName } = useAuto
      ? await tryServices(chatRequest, id, forceTools, forceVision)
      : await trySpecificService(resolvedModel, chatRequest, id);

    const meta = splitServiceName(serviceName);

    // Streaming response
    if (wantsStream) {
      const trackedStream = observeSSE(stream, {
        onComplete: ({ usage, usageSource }) => {
          const finalUsage = resolveUsage(usageEstimate, usage);
          recordServiceMetric(req, auth, ip, {
            requestType: 'chat',
            provider: meta.provider,
            model: meta.model,
            statusCode: 200,
            durationMs: Date.now() - startedAt,
            promptTokens: finalUsage.promptTokens,
            completionTokens: finalUsage.completionTokens,
            totalTokens: finalUsage.totalTokens,
            usageSource,
          });
        },
      });
      return new Response(withErrorBoundary(trackedStream, serviceName), {
        headers: withCors(req, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Service': serviceName,
          'X-Cache': 'MISS',
          'X-Request-Id': getRequestId(req),
        }),
      });
    }

    // Non-streaming response
    const { content, tool_calls, finish_reason, usage, usageSource } = await collectSSE(stream);
    // When the provider gives us real token counts, use them as-is.
    // When usage is estimated (provider gave nothing), blend with the pre-request
    // estimate for prompt tokens since collectSSE can't recover those.
    const finalUsage = usageSource === 'provider'
      ? resolveUsage(usageEstimate, usage)
      : {
          promptTokens: usageEstimate.promptTokens,
          completionTokens: usage?.completionTokens ?? usageEstimate.completionTokens,
          totalTokens: (usageEstimate.promptTokens) + (usage?.completionTokens ?? usageEstimate.completionTokens),
          requests: 1,
          audioSeconds: 0,
        };
    const created = Math.floor(Date.now() / 1000);
    const assistantMessage: Record<string, unknown> = { role: 'assistant', content: content || null };
    if (tool_calls.length) assistantMessage.tool_calls = tool_calls;

    // Use the original model name (alias) if provided, otherwise use serviceName (real model)
    const responseModel = model && !useAuto ? String(model) : serviceName;

    const responseBody = {
      id,
      object: 'chat.completion',
      created,
      model: responseModel,
      choices: [{ index: 0, message: assistantMessage, finish_reason }],
      usage: {
        prompt_tokens: finalUsage.promptTokens,
        completion_tokens: finalUsage.completionTokens,
        total_tokens: finalUsage.totalTokens,
      },
    };

    recordServiceMetric(req, auth, ip, {
      requestType: 'chat',
      provider: meta.provider,
      model: meta.model,
      statusCode: 200,
      durationMs: Date.now() - startedAt,
      promptTokens: finalUsage.promptTokens,
      completionTokens: finalUsage.completionTokens,
      totalTokens: finalUsage.totalTokens,
      usageSource,
    });

    if (cacheKey) {
      setCachedResponse({
        cacheKey,
        scopeKey: cacheScopeKey,
        requestType: 'chat',
        provider: meta.provider,
        model: serviceName,
        response: responseBody,
        promptTokens: finalUsage.promptTokens,
        completionTokens: finalUsage.completionTokens,
        totalTokens: finalUsage.totalTokens,
        statusCode: 200,
      });
    }

    return jsonResponse(req, responseBody, 200, {
      'X-Service': serviceName,
      'X-Cache': cacheKey ? 'MISS' : 'BYPASS',
    });
  } catch (err) {
    const httpStatus = getHttpStatusFromError(err, 502);
    const retryAfter = (err as { retryAfter?: number })?.retryAfter ?? getRetryAfterFromError(err);
    const message = (err as { message?: string })?.message ?? 'Request failed';

    recordServiceMetric(req, auth, ip, {
      requestType: 'chat',
      provider: null,
      model: typeof model === 'string' ? model : null,
      statusCode: httpStatus,
      durationMs: Date.now() - startedAt,
      promptTokens: usageEstimate.promptTokens,
      completionTokens: usageEstimate.completionTokens,
      totalTokens: usageEstimate.totalTokens,
      errorMessage: message,
    });

    const extraHeaders: Record<string, string> = {};
    if (retryAfter) extraHeaders['Retry-After'] = String(retryAfter);

    return errorResponse(req, httpStatus, message, (err as { code?: string })?.code ?? 'service_unavailable', extraHeaders, {
      details: (err as { details?: unknown })?.details ?? [],
    });
  }
}

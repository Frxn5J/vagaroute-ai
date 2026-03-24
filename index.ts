import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  clearAllProviderRateLimits,
  clearModelRateLimit,
  createInvitationToken,
  createProject,
  createServiceApiKey,
  getAllModelStats,
  getAllProviderStats,
  getApiKeyById,
  getAppSettings,
  getDashboardMetrics,
  getInvitationTokenByHash,
  getProjectById,
  getProjectUsageSummaries,
  getRecentErrors,
  getSpendSummary,
  getTokenSummary,
  getUserById,
  getUserUsageSummaries,
  listRateLimitRules,
  listAllApiKeys,
  listApiKeysForUser,
  listAllProjects,
  listInvitationTokens,
  listProjectsForUser,
  listUsers,
  recordRequestMetric,
  setApiKeyActive,
  setUserActive,
  upsertRateLimitRule,
  updateApiKeyRateLimit,
  updateAppSettings,
  updateProject,
  updateUserProductSettings,
  updateServiceApiKey,
  type DashboardMetrics,
  type RequestMetricsScope,
} from './core/db';
import { appConfig } from './core/config';
import { estimateUsageCostUsd } from './core/costs';
import { ensureProviderLimitAvailable } from './core/providerLimits';
import { getProviderKeyCandidates, listConfiguredProviderKeys, withProviderKey, type ProviderName } from './core/providerKeys';
import {
  buildCacheScopeKey,
  buildChatCacheKey,
  getCachedResponse,
  getResponseCacheStats,
  setCachedResponse,
} from './core/responseCache';
import { initializePool, reloadPool, resetStates, states, tryServices, trySpecificService } from './core/pool';
import {
  buildUsageEstimate,
  estimateChatUsage,
  estimateEmbeddingsUsage,
  extractAudioSecondsFromPayload,
  normalizeProviderId,
  sanitizeLimitRule,
} from './core/usageLimits';
import {
  authenticateRequest,
  bootstrapAdmin,
  buildSessionCookie,
  clearSessionCookie,
  createAdditionalApiKey,
  createUserWithDefaultKey,
  acceptInvitation,
  isAdmin,
  loginWithPassword,
  logoutRequest,
  needsBootstrap,
  requestPasswordReset,
  resetPasswordWithToken,
  type AuthContext,
} from './middlewares/auth';
import { checkRateLimit } from './middlewares/rateLimit';
import type { ChatRequest } from './types';
import { getCorsRejectionResponse, withCors } from './utils/cors';
import { encryptSecret, hashToken, maskSecret, randomToken } from './utils/crypto';
import { logger } from './utils/logger';
import { bindRequestContext, getRequestId } from './utils/requestContext';
import { collectSSE, genId, observeSSE, withErrorBoundary, type StreamUsage } from './utils/stream';

const startTime = Date.now();
const publicDir = path.join(process.cwd(), 'public');
const appShellPath = path.join(publicDir, 'index.html');

type RequestServer = {
  requestIP(request: Request): { address: string } | null;
};

if (!appConfig.isTest) {
  await initializePool();
}

function jsonResponse(
  req: Request,
  data: unknown,
  status: number = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: withCors(req, {
      'Content-Type': 'application/json',
      'X-Request-Id': getRequestId(req),
      ...extraHeaders,
    }),
  });
}

function errorResponse(
  req: Request,
  status: number,
  message: string,
  type: string = 'error',
  extraHeaders: Record<string, string> = {},
  extraBody: Record<string, unknown> = {},
): Response {
  return jsonResponse(
    req,
    { error: { message, type, ...extraBody } },
    status,
    extraHeaders,
  );
}

async function readJsonBody<T>(req: Request): Promise<T> {
  return await req.json() as T;
}

function getRequestIp(req: Request, server: RequestServer): string {
  return server.requestIP(req)?.address
    || req.headers.get('x-forwarded-for')
    || 'unknown-ip';
}

function splitServiceName(serviceName: string | null | undefined): { provider: string | null; model: string | null } {
  if (!serviceName) {
    return { provider: null, model: null };
  }

  const [provider, ...rest] = serviceName.split('/');
  return {
    provider: provider ? normalizeProviderId(provider) : null,
    model: rest.length > 0 ? rest.join('/') : null,
  };
}

function isServiceRoute(pathname: string): boolean {
  return pathname === '/chat'
    || pathname === '/status'
    || pathname.startsWith('/v1/')
    || pathname.startsWith('/admin/reset');
}

function applyAnonymousRateLimit(req: Request, ip: string): Response | null {
  const settings = getAppSettings();
  const limit = checkRateLimit(`anon:${ip}`, settings.anonymousRateLimitPerMinute);
  if (!limit.limited) {
    return null;
  }

  return errorResponse(req, 429, 'Too many requests', 'rate_limit_error', {
    'Retry-After': String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))),
  });
}

function applyServiceRateLimit(req: Request, auth: AuthContext, ip: string): Response | null {
  const settings = getAppSettings();
  const limit = auth.apiKey
    ? checkRateLimit(`key:${auth.apiKey.id}`, auth.apiKey.rateLimitPerMinute)
    : checkRateLimit(`user:${auth.user.id || ip}`, settings.defaultApiKeyRateLimit);

  if (!limit.limited) {
    return null;
  }

  return errorResponse(req, 429, 'Too many requests', 'rate_limit_error', {
    'Retry-After': String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))),
  });
}

function resolveProjectIdForRequest(auth: AuthContext | null, req: Request): string | null {
  if (!auth) {
    return null;
  }

  if (auth.apiKey?.projectId) {
    return auth.apiKey.projectId;
  }

  const requestedProjectId = req.headers.get('x-project-id')?.trim() || null;
  if (auth.user.id === 'system') {
    return requestedProjectId;
  }

  const visibleProjects = isAdmin(auth)
    ? listAllProjects()
    : listProjectsForUser(auth.user.id);

  if (requestedProjectId && visibleProjects.some((project) => project.id === requestedProjectId)) {
    return requestedProjectId;
  }

  return visibleProjects[0]?.id ?? null;
}

function resolveCacheScopeKey(auth: AuthContext | null, req: Request): string {
  return buildCacheScopeKey({
    userId: auth?.user.id ?? null,
    apiKeyId: auth?.apiKey?.id ?? null,
    projectId: resolveProjectIdForRequest(auth, req),
  });
}

function resolveRequestMetricsScope(auth: AuthContext): {
  scope: RequestMetricsScope | undefined;
  visibleProjects: ReturnType<typeof listProjectsForUser>;
} {
  const visibleProjects = isAdmin(auth) ? listAllProjects() : listProjectsForUser(auth.user.id);
  if (isAdmin(auth)) {
    return {
      scope: undefined,
      visibleProjects,
    };
  }

  return {
    scope: {
      userId: auth.user.id,
      visibleProjectIds: visibleProjects.map((project) => project.id),
    },
    visibleProjects,
  };
}

function buildScopedModelTelemetry(metrics: DashboardMetrics) {
  return metrics.models
    .map((item) => ({
      id: `${item.provider}/${item.model}`,
      provider: item.provider,
      status: 'scoped',
      rate_limited_until: 0,
      requests_served: item.totalRequests,
    }))
    .sort((left, right) => right.requests_served - left.requests_served)
    .slice(0, 100);
}

function buildDashboardAlerts(
  auth: AuthContext,
  input: {
    tokens: ReturnType<typeof getTokenSummary>;
    userUsage: ReturnType<typeof getUserUsageSummaries>;
    projectUsage: ReturnType<typeof getProjectUsageSummaries>;
    providerStats: ReturnType<typeof getAllProviderStats>;
  },
) {
  const { tokens, userUsage, projectUsage, providerStats } = input;
  const alerts: Array<{
    id: string;
    severity: 'info' | 'warning' | 'error';
    title: string;
    message: string;
  }> = [];

  for (const provider of providerStats) {
    if (isAdmin(auth) && provider.cooldownUntil > Date.now()) {
      alerts.push({
        id: `provider-${provider.id}`,
        severity: 'warning',
        title: `Proveedor degradado: ${provider.id}`,
        message: provider.lastReason || 'El proveedor esta en cooldown y puede afectar la disponibilidad.',
      });
    }
  }

  for (const summary of userUsage) {
    if (summary.status !== 'ok' && (isAdmin(auth) || summary.id === auth.user.id)) {
      alerts.push({
        id: `user-${summary.id}`,
        severity: summary.status === 'exceeded' ? 'error' : 'warning',
        title: `Uso alto de usuario: ${summary.name}`,
        message: `Va en ${summary.requestCount} requests y ${summary.totalTokens} tokens este mes.`,
      });
    }
  }

  for (const summary of projectUsage) {
    if (summary.status !== 'ok') {
      alerts.push({
        id: `project-${summary.id}`,
        severity: summary.status === 'exceeded' ? 'error' : 'warning',
        title: `Proyecto con consumo alto: ${summary.name}`,
        message: `Acumula ${summary.requestCount} requests y ${summary.totalTokens} tokens este mes.`,
      });
    }
  }

  if (tokens.projectedMonthTokens > tokens.currentMonthTokens * 1.25 && tokens.currentMonthTokens > 0) {
    alerts.push({
      id: 'projection',
      severity: 'info',
      title: 'Proyeccion mensual activa',
      message: `La proyeccion del mes va en ${tokens.projectedMonthTokens} tokens.`,
    });
  }

  return alerts.slice(0, 12);
}

function buildDashboardPayload(auth: AuthContext) {
  const now = Date.now();
  const { scope: metricsScope, visibleProjects } = resolveRequestMetricsScope(auth);
  const metrics = getDashboardMetrics(metricsScope);
  const spend = getSpendSummary(metricsScope);
  const tokens = getTokenSummary(metricsScope);
  const providerStats = getAllProviderStats();
  const providerCooldownMap = new Map(providerStats.map((item) => [item.id, item]));
  const modelTelemetry = isAdmin(auth)
    ? getAllModelStats()
      .sort((left, right) => right.requests_served - left.requests_served)
      .slice(0, 100)
    : buildScopedModelTelemetry(metrics);
  const providerNames = Array.from(new Set(states.map((state) => normalizeProviderId(state.service.name.split('/')[0] ?? ''))));
  const userUsage = isAdmin(auth)
    ? getUserUsageSummaries()
    : getUserUsageSummaries(metricsScope);
  const projectUsage = isAdmin(auth)
    ? getProjectUsageSummaries()
    : getProjectUsageSummaries(metricsScope);
  const recentErrors = getRecentErrors(15, metricsScope);

  return {
    me: auth.user,
    auth: {
      via: auth.via,
      isAdmin: isAdmin(auth),
      sessionExpiresAt: auth.session?.expiresAt ?? null,
      apiKeyId: auth.apiKey?.id ?? null,
    },
    settings: getAppSettings(),
    pool: {
      total: states.length,
      available: states.filter((state) => {
        const providerCooldownUntil = providerCooldownMap.get(normalizeProviderId(state.service.name.split('/')[0] ?? ''))?.cooldownUntil ?? 0;
        return !state.disabled && Math.max(state.cooldownUntil, providerCooldownUntil) <= now;
      }).length,
      disabled: states.filter((state) => state.disabled).length,
      cooldown: states.filter((state) => {
        const providerCooldownUntil = providerCooldownMap.get(normalizeProviderId(state.service.name.split('/')[0] ?? ''))?.cooldownUntil ?? 0;
        return !state.disabled && Math.max(state.cooldownUntil, providerCooldownUntil) > now;
      }).length,
      providers: providerNames.map((providerId) => {
        const providerState = providerCooldownMap.get(providerId);
        return {
          id: providerId,
          status: (providerState?.cooldownUntil ?? 0) > now ? 'cooldown' : 'available',
          cooldownUntil: providerState?.cooldownUntil ?? 0,
          lastReason: providerState?.lastReason ?? null,
          models: states.filter((state) => normalizeProviderId(state.service.name.split('/')[0] ?? '') === providerId).length,
        };
      }),
      models: states.map((state) => ({
        id: state.service.name,
        provider: state.service.name.split('/')[0] ?? 'Unknown',
        supportsTools: state.service.supportsTools,
        supportsVision: Boolean(state.service.supportsVision),
        paidOnly: state.paidOnly,
        status: state.disabled
          ? 'disabled'
          : Math.max(
            state.cooldownUntil,
            providerCooldownMap.get(normalizeProviderId(state.service.name.split('/')[0] ?? ''))?.cooldownUntil ?? 0,
          ) > now
            ? 'cooldown'
            : 'available',
        cooldownUntil: Math.max(
          state.cooldownUntil,
          providerCooldownMap.get(normalizeProviderId(state.service.name.split('/')[0] ?? ''))?.cooldownUntil ?? 0,
        ),
      })),
    },
    users: isAdmin(auth) ? listUsers() : [],
    apiKeys: isAdmin(auth) ? listAllApiKeys() : listApiKeysForUser(auth.user.id),
    serviceKeys: isAdmin(auth) ? listConfiguredProviderKeys() : [],
    rateLimits: isAdmin(auth)
      ? {
        providerRules: listRateLimitRules('provider'),
        modelRules: listRateLimitRules('model'),
      }
      : {
        providerRules: [],
        modelRules: [],
      },
    metrics,
    modelTelemetry,
    spend,
    tokens,
    projects: visibleProjects,
    invitations: isAdmin(auth) ? listInvitationTokens() : [],
    recentErrors,
    userUsage,
    projectUsage,
    alerts: buildDashboardAlerts(auth, {
      tokens,
      userUsage,
      projectUsage,
      providerStats,
    }),
    cache: getResponseCacheStats(isAdmin(auth) ? undefined : { userId: auth.user.id }),
    tokenization: {
      mode: 'provider-usage-with-fallback',
      exactForCompletedResponses: true,
    },
  };
}

function buildProviderError(status: number, message: string, headers?: Headers): Error & {
  status: number;
  headers?: Headers;
} {
  return Object.assign(new Error(message), { status, headers });
}

function getHttpStatusFromError(err: unknown, fallback: number): number {
  const candidate = (err as { httpStatus?: number; status?: number })?.httpStatus
    ?? (err as { httpStatus?: number; status?: number })?.status;
  return typeof candidate === 'number' && candidate >= 400 && candidate < 600 ? candidate : fallback;
}

function getRetryAfterFromError(err: unknown): number | null {
  const value = err as {
    headers?: Headers | Record<string, string>;
    response?: { headers?: Headers | Record<string, string> };
  };
  const headers = value.headers ?? value.response?.headers;

  if (!headers) {
    return null;
  }

  const raw = typeof (headers as Headers).get === 'function'
    ? (headers as Headers).get('retry-after')
      ?? (headers as Headers).get('x-ratelimit-reset')
      ?? (headers as Headers).get('x-ratelimit-reset-requests')
    : (headers as Record<string, string>)['retry-after']
      ?? (headers as Record<string, string>)['x-ratelimit-reset']
      ?? (headers as Record<string, string>)['x-ratelimit-reset-requests'];

  const seconds = Number.parseFloat(raw ?? '');
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
}

type AudioTranscriptionProvider = 'groq' | 'witai';

function normalizeAudioProvider(value: unknown): AudioTranscriptionProvider {
  if (typeof value !== 'string' || !value.trim()) {
    return 'groq';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'groq') {
    return 'groq';
  }

  if (normalized === 'witai' || normalized === 'wit.ai' || normalized === 'wit') {
    return 'witai';
  }

  throw Object.assign(new Error(`Proveedor de audio no soportado: ${value}`), {
    code: 'audio_provider_invalid',
    httpStatus: 400,
  });
}

function getAudioProviderMeta(provider: AudioTranscriptionProvider): { provider: string; model: string } {
  if (provider === 'witai') {
    return { provider: 'witai', model: 'speech' };
  }

  return { provider: 'groq', model: 'whisper-large-v3' };
}

function getAudioContentType(file: File): string {
  if (file.type?.trim()) {
    return file.type;
  }

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
    const groqForm = new FormData();
    groqForm.append('file', file);
    groqForm.append('model', 'whisper-large-v3');
    if (language) {
      groqForm.append('language', language);
    }

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: groqForm,
    });

    if (!response.ok) {
      throw buildProviderError(response.status, await response.text(), response.headers);
    }

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

    if (!response.ok) {
      throw buildProviderError(response.status, await response.text(), response.headers);
    }

    return await response.json() as Record<string, unknown>;
  });

  const text = typeof raw.text === 'string'
    ? raw.text
    : typeof raw._text === 'string'
      ? raw._text
      : '';

  return typeof raw.text === 'string' ? raw : { ...raw, text };
}

function recordServiceMetric(
  req: Request,
  auth: AuthContext | null,
  ip: string,
  details: {
    requestType: string;
    provider?: string | null;
    model?: string | null;
    statusCode: number;
    durationMs: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    audioSeconds?: number;
    errorMessage?: string | null;
    estimatedCostUsd?: number;
  },
): void {
  const projectId = resolveProjectIdForRequest(auth, req);
  recordRequestMetric({
    id: `met_${randomToken(10)}`,
    userId: auth?.user.id && auth.user.id !== 'system' ? auth.user.id : null,
    apiKeyId: auth?.apiKey?.id ?? null,
    projectId,
    method: req.method,
    path: new URL(req.url).pathname,
    requestType: details.requestType,
    provider: details.provider ?? null,
    model: details.model ?? null,
    statusCode: details.statusCode,
    durationMs: details.durationMs,
    promptTokens: details.promptTokens ?? 0,
    completionTokens: details.completionTokens ?? 0,
    totalTokens: details.totalTokens ?? 0,
    audioSeconds: details.audioSeconds ?? 0,
    estimatedCostUsd: details.estimatedCostUsd ?? estimateUsageCostUsd({
      requestType: details.requestType,
      provider: details.provider,
      model: details.model,
      promptTokens: details.promptTokens,
      completionTokens: details.completionTokens,
      totalTokens: details.totalTokens,
      audioSeconds: details.audioSeconds,
    }),
    errorMessage: details.errorMessage ?? null,
    sourceIp: ip,
  });
}

function resolveUsage(estimate: ReturnType<typeof buildUsageEstimate>, usage: StreamUsage | null | undefined) {
  return buildUsageEstimate({
    requests: estimate.requests,
    promptTokens: usage?.promptTokens ?? estimate.promptTokens,
    completionTokens: usage?.completionTokens ?? estimate.completionTokens,
    totalTokens: usage?.totalTokens ?? estimate.totalTokens,
    audioSeconds: estimate.audioSeconds,
  });
}

function isChatCacheEligible(request: ChatRequest & { stream?: boolean }, wantsStream: boolean): boolean {
  if (wantsStream || !appConfig.responseCacheEnabled) {
    return false;
  }

  if (Array.isArray(request.tools) && request.tools.length > 0) {
    return false;
  }

  const containsVision = (request.messages ?? []).some((message) =>
    Array.isArray(message.content)
      && message.content.some((part) => part.type !== 'text'),
  );

  return !containsVision;
}

function isPathInsideBase(baseDir: string, candidatePath: string): boolean {
  const relativePath = path.relative(baseDir, candidatePath);
  return relativePath === ''
    || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function tryServeStatic(req: Request, pathname: string): Response | null {
  const normalizedPath = pathname === '/' ? '/index.html' : pathname;
  const relative = normalizedPath.replace(/^\/+/, '');
  const resolved = path.resolve(publicDir, relative);

  if (isPathInsideBase(publicDir, resolved) && existsSync(resolved)) {
    return new Response(Bun.file(resolved), {
      headers: withCors(req, { 'X-Request-Id': getRequestId(req) }),
    });
  }

  if (!pathname.startsWith('/api/') && !isServiceRoute(pathname) && existsSync(appShellPath)) {
    return new Response(Bun.file(appShellPath), {
      headers: withCors(req, {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Request-Id': getRequestId(req),
      }),
    });
  }

  return null;
}

async function routeRequest(
  req: Request,
  server: RequestServer,
  runtime: { pathname: string; ip: string; startedAt: number },
): Promise<Response> {
  const { pathname, ip, startedAt } = runtime;

  const corsRejection = getCorsRejectionResponse(req);
  if (corsRejection) {
    return corsRejection;
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: withCors(req, { 'X-Request-Id': getRequestId(req) }),
    });
  }

  if (req.method === 'GET' && pathname === '/health') {
      const now = Date.now();
      const providerCooldownMap = new Map(getAllProviderStats().map((item) => [item.id, item]));
      const available = states.filter((state) => {
        const providerCooldownUntil = providerCooldownMap.get(normalizeProviderId(state.service.name.split('/')[0] ?? ''))?.cooldownUntil ?? 0;
        return !state.disabled && Math.max(state.cooldownUntil, providerCooldownUntil) <= now;
      }).length;
      return jsonResponse(req, {
        status: 'ok',
        uptime_seconds: Math.floor((now - startTime) / 1000),
        bootstrap_required: needsBootstrap(),
        services: {
          total: states.length,
          available,
          disabled: states.filter((state) => state.disabled).length,
        },
      });
    }

    if (req.method === 'GET' && pathname === '/api/bootstrap/status') {
      return jsonResponse(req, { needsSetup: needsBootstrap() });
    }

    if (req.method === 'POST' && pathname === '/api/bootstrap') {
      const limited = applyAnonymousRateLimit(req, ip);
      if (limited) {
        return limited;
      }

      try {
        const body = await readJsonBody<{ name: string; email: string; password: string }>(req);
        const result = await bootstrapAdmin({
          name: body.name,
          email: body.email,
          password: body.password,
          req,
        });

        return jsonResponse(
          req,
          {
            ok: true,
            user: result.user,
            apiKey: result.defaultApiKey,
            rawApiKey: result.rawApiKey,
          },
          201,
          { 'Set-Cookie': buildSessionCookie(result.sessionToken, result.expiresAt, req) },
        );
      } catch (err) {
        const message = (err as { message?: string })?.message ?? 'Bootstrap failed';
        return errorResponse(req, 400, message, 'bootstrap_error');
      }
    }

    const invitationMatch = pathname.match(/^\/api\/invitations\/([^/]+)$/);
    if (req.method === 'GET' && invitationMatch) {
      const token = decodeURIComponent(invitationMatch[1] ?? '').trim();
      if (!token) {
        return errorResponse(req, 400, 'Token de invitacion invalido', 'validation_error');
      }

      const invitation = getInvitationTokenByHash(hashToken(token));
      if (!invitation) {
        return errorResponse(req, 404, 'La invitacion no existe o expiro', 'not_found');
      }

      return jsonResponse(req, { invitation });
    }

    if (req.method === 'POST' && pathname === '/api/invitations/accept') {
      try {
        const body = await readJsonBody<{ token: string; email?: string | null; name: string; password: string }>(req);
        const result = await acceptInvitation({
          token: body.token,
          email: body.email,
          name: body.name,
          password: body.password,
          req,
        });

        return jsonResponse(
          req,
          {
            ok: true,
            user: result.user,
            apiKey: result.apiKey,
            rawApiKey: result.rawApiKey,
          },
          201,
          { 'Set-Cookie': buildSessionCookie(result.sessionToken, result.expiresAt, req) },
        );
      } catch (err) {
        const message = (err as { message?: string })?.message ?? 'No se pudo aceptar la invitacion';
        return errorResponse(req, 400, message, 'invitation_error');
      }
    }

    if (req.method === 'POST' && pathname === '/api/auth/password-reset/request') {
      try {
        const body = await readJsonBody<{ email: string }>(req);
        const result = await requestPasswordReset({
          email: body.email,
        });
        const resetUrl = result
          ? `${new URL(req.url).origin}/?reset=${encodeURIComponent(result.rawToken)}`
          : null;

        return jsonResponse(req, {
          ok: true,
          resetUrl: appConfig.isProduction ? null : resetUrl,
        });
      } catch (err) {
        const message = (err as { message?: string })?.message ?? 'No se pudo generar el reset';
        return errorResponse(req, 400, message, 'reset_error');
      }
    }

    if (req.method === 'POST' && (pathname === '/api/auth/password-reset/confirm' || pathname === '/api/auth/reset-password')) {
      try {
        const body = await readJsonBody<{ token: string; password: string }>(req);
        await resetPasswordWithToken({
          token: body.token,
          password: body.password,
        });
        return jsonResponse(req, { ok: true });
      } catch (err) {
        const message = (err as { message?: string })?.message ?? 'No se pudo actualizar la contrasena';
        return errorResponse(req, 400, message, 'reset_error');
      }
    }

    if (req.method === 'POST' && (pathname === '/api/auth/login' || pathname === '/api/login')) {
      const limited = applyAnonymousRateLimit(req, ip);
      if (limited) {
        return limited;
      }

      try {
        const body = await readJsonBody<{ email: string; password: string }>(req);
        const result = await loginWithPassword({
          email: body.email,
          password: body.password,
          req,
        });

        return jsonResponse(
          req,
          { ok: true, user: result.user },
          200,
          { 'Set-Cookie': buildSessionCookie(result.sessionToken, result.expiresAt, req) },
        );
      } catch (err) {
        const message = (err as { message?: string })?.message ?? 'Login failed';
        return errorResponse(req, 401, message, 'auth_error');
      }
    }

    if (req.method === 'POST' && pathname === '/api/auth/logout') {
      logoutRequest(req);
      return jsonResponse(req, { ok: true }, 200, { 'Set-Cookie': clearSessionCookie(req) });
    }

    const staticResponse = tryServeStatic(req, pathname);
    if (staticResponse) {
      return staticResponse;
    }

    const auth = await authenticateRequest(req);
    const managementRoute = pathname.startsWith('/api/');

    if ((managementRoute || isServiceRoute(pathname)) && !auth) {
      return errorResponse(req, 401, 'Unauthorized', 'auth_error');
    }

    if (auth && isServiceRoute(pathname)) {
      const limited = applyServiceRateLimit(req, auth, ip);
      if (limited) {
        return limited;
      }
    }

    if (auth && req.method === 'GET' && pathname === '/api/auth/me') {
      return jsonResponse(req, {
        user: auth.user,
        via: auth.via,
        isAdmin: isAdmin(auth),
        sessionExpiresAt: auth.session?.expiresAt ?? null,
      });
    }

    if (auth && req.method === 'GET' && pathname === '/api/dashboard') {
      return jsonResponse(req, buildDashboardPayload(auth));
    }

    if (auth && req.method === 'GET' && pathname === '/api/users') {
      if (!isAdmin(auth)) {
        return errorResponse(req, 403, 'Solo administradores', 'forbidden');
      }
      return jsonResponse(req, { users: listUsers() });
    }

    if (auth && req.method === 'POST' && pathname === '/api/users') {
      if (!isAdmin(auth)) {
        return errorResponse(req, 403, 'Solo administradores', 'forbidden');
      }

      try {
        const body = await readJsonBody<{
          name: string;
          email: string;
          password: string;
          projectId?: string | null;
          monthlyRequestQuota?: number | null;
          monthlyBudgetUsd?: number | null;
        }>(req);
        const result = await createUserWithDefaultKey(body);
        return jsonResponse(req, {
          ok: true,
          user: result.user,
          apiKey: result.defaultApiKey,
          rawApiKey: result.rawApiKey,
        }, 201);
      } catch (err) {
        const message = (err as { message?: string })?.message ?? 'No se pudo crear el usuario';
        return errorResponse(req, 400, message, 'user_error');
      }
    }

    const userMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
    if (auth && req.method === 'PATCH' && userMatch) {
      if (!isAdmin(auth)) {
        return errorResponse(req, 403, 'Solo administradores', 'forbidden');
      }

      const user = getUserById(userMatch[1] ?? '');
      if (!user) {
        return errorResponse(req, 404, 'Usuario no encontrado', 'not_found');
      }

      try {
        const body = await readJsonBody<{
          isActive?: boolean;
          monthlyRequestQuota?: number | null;
          monthlyBudgetUsd?: number | null;
          onboardingCompletedAt?: number | null;
        }>(req);
        if (typeof body.isActive === 'boolean') {
          setUserActive(user.id, body.isActive);
        }
        if (
          body.monthlyRequestQuota !== undefined
          || body.monthlyBudgetUsd !== undefined
          || body.onboardingCompletedAt !== undefined
        ) {
          updateUserProductSettings(user.id, {
            monthlyRequestQuota: body.monthlyRequestQuota,
            monthlyBudgetUsd: body.monthlyBudgetUsd,
            onboardingCompletedAt: body.onboardingCompletedAt,
          });
        }
        return jsonResponse(req, { ok: true, user: getUserById(user.id) });
      } catch (err) {
        const message = (err as { message?: string })?.message ?? 'No se pudo actualizar el usuario';
        return errorResponse(req, 400, message, 'user_error');
      }
    }

    const userResetMatch = pathname.match(/^\/api\/users\/([^/]+)\/password-reset$/);
    if (auth && req.method === 'POST' && userResetMatch) {
      if (!isAdmin(auth)) {
        return errorResponse(req, 403, 'Solo administradores', 'forbidden');
      }

      const user = getUserById(userResetMatch[1] ?? '');
      if (!user) {
        return errorResponse(req, 404, 'Usuario no encontrado', 'not_found');
      }

      const result = await requestPasswordReset({
        email: user.email,
        requestedByUserId: auth.user.id,
      });

      return jsonResponse(req, {
        ok: true,
        resetUrl: result ? `${new URL(req.url).origin}/?reset=${encodeURIComponent(result.rawToken)}` : null,
      });
    }

    if (auth && req.method === 'GET' && pathname === '/api/api-keys') {
      const apiKeys = isAdmin(auth) ? listAllApiKeys() : listApiKeysForUser(auth.user.id);
      return jsonResponse(req, { apiKeys });
    }

    if (auth && req.method === 'POST' && pathname === '/api/api-keys') {
      try {
        const body = await readJsonBody<{
          name?: string;
          userId?: string;
          rateLimitPerMinute?: number;
          projectId?: string | null;
        }>(req);
        const targetUserId = isAdmin(auth) && body.userId ? body.userId : auth.user.id;
        const visibleProjects = isAdmin(auth) ? listAllProjects() : listProjectsForUser(auth.user.id);
        const selectedProjectId = body.projectId?.trim() || null;

        if (!isAdmin(auth) && targetUserId !== auth.user.id) {
          return errorResponse(req, 403, 'No puedes crear llaves para otro usuario', 'forbidden');
        }
        if (selectedProjectId && !visibleProjects.some((project) => project.id === selectedProjectId)) {
          return errorResponse(req, 403, 'No puedes asignar esta API key a ese proyecto', 'forbidden');
        }

        const settings = getAppSettings();
        if (!isAdmin(auth) && !settings.enableUserKeyCreation) {
          return errorResponse(req, 403, 'La generacion de API keys por usuarios esta deshabilitada', 'forbidden');
        }

        const result = await createAdditionalApiKey({
          userId: targetUserId,
          name: body.name?.trim() || `Extra Key ${new Date().toLocaleDateString()}`,
          rateLimitPerMinute: isAdmin(auth) ? body.rateLimitPerMinute : undefined,
          projectId: selectedProjectId,
        });

        return jsonResponse(req, {
          ok: true,
          apiKey: result.apiKey,
          rawApiKey: result.rawApiKey,
        }, 201);
      } catch (err) {
        const message = (err as { message?: string })?.message ?? 'No se pudo generar la API key';
        return errorResponse(req, 400, message, 'api_key_error');
      }
    }

    const apiKeyMatch = pathname.match(/^\/api\/api-keys\/([^/]+)$/);
    if (auth && req.method === 'PATCH' && apiKeyMatch) {
      const apiKey = getApiKeyById(apiKeyMatch[1] ?? '');
      if (!apiKey) {
        return errorResponse(req, 404, 'API key no encontrada', 'not_found');
      }

      const isOwner = apiKey.userId === auth.user.id;
      if (!isOwner && !isAdmin(auth)) {
        return errorResponse(req, 403, 'No puedes modificar esta API key', 'forbidden');
      }

      try {
        const body = await readJsonBody<{ isActive?: boolean; rateLimitPerMinute?: number }>(req);
        if (typeof body.isActive === 'boolean') {
          setApiKeyActive(apiKey.id, body.isActive);
        }
        if (typeof body.rateLimitPerMinute === 'number' && isAdmin(auth)) {
          updateApiKeyRateLimit(apiKey.id, Math.max(1, Math.floor(body.rateLimitPerMinute)));
        }

        return jsonResponse(req, { ok: true, apiKey: getApiKeyById(apiKey.id) });
      } catch (err) {
        const message = (err as { message?: string })?.message ?? 'No se pudo actualizar la API key';
        return errorResponse(req, 400, message, 'api_key_error');
      }
    }

    if (auth && req.method === 'GET' && pathname === '/api/settings') {
      return jsonResponse(req, { settings: getAppSettings() });
    }

    if (auth && req.method === 'GET' && pathname === '/api/projects') {
      return jsonResponse(req, {
        projects: isAdmin(auth) ? listAllProjects() : listProjectsForUser(auth.user.id),
      });
    }

    if (auth && req.method === 'POST' && pathname === '/api/projects') {
      if (!isAdmin(auth)) {
        return errorResponse(req, 403, 'Solo administradores', 'forbidden');
      }

      try {
        const body = await readJsonBody<{
          name: string;
          description?: string | null;
          budgetMonthlyUsd?: number | null;
          requestQuotaMonthly?: number | null;
        }>(req);
        const project = createProject({
          id: `prj_${randomToken(10)}`,
          name: body.name,
          description: body.description,
          budgetMonthlyUsd: body.budgetMonthlyUsd,
          requestQuotaMonthly: body.requestQuotaMonthly,
          ownerUserId: auth.user.id,
        });
        return jsonResponse(req, { ok: true, project }, 201);
      } catch (err) {
        const message = (err as { message?: string })?.message ?? 'No se pudo crear el proyecto';
        return errorResponse(req, 400, message, 'project_error');
      }
    }

    const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (auth && req.method === 'PATCH' && projectMatch) {
      if (!isAdmin(auth)) {
        return errorResponse(req, 403, 'Solo administradores', 'forbidden');
      }

      const projectId = projectMatch[1] ?? '';
      if (!getProjectById(projectId)) {
        return errorResponse(req, 404, 'Proyecto no encontrado', 'not_found');
      }

      try {
        const body = await readJsonBody<{
          name?: string;
          description?: string | null;
          budgetMonthlyUsd?: number | null;
          requestQuotaMonthly?: number | null;
          isActive?: boolean;
        }>(req);
        const project = updateProject(projectId, body);
        return jsonResponse(req, { ok: true, project });
      } catch (err) {
        const message = (err as { message?: string })?.message ?? 'No se pudo actualizar el proyecto';
        return errorResponse(req, 400, message, 'project_error');
      }
    }

    if (auth && req.method === 'POST' && pathname === '/api/invitations') {
      if (!isAdmin(auth)) {
        return errorResponse(req, 403, 'Solo administradores', 'forbidden');
      }

      try {
        const body = await readJsonBody<{
          email?: string | null;
          projectId?: string | null;
          role?: 'owner' | 'member';
          expiresHours?: number;
        }>(req);
        const rawToken = randomToken(32);
        const invitation = createInvitationToken({
          id: `inv_${randomToken(10)}`,
          email: body.email ?? null,
          projectId: body.projectId ?? null,
          role: body.role ?? 'member',
          tokenHash: hashToken(rawToken),
          expiresAt: Date.now() + Math.max(1, Math.floor(body.expiresHours ?? 72)) * 60 * 60_000,
          createdByUserId: auth.user.id,
        });

        return jsonResponse(req, {
          ok: true,
          invitation,
          inviteUrl: `${new URL(req.url).origin}/?invite=${encodeURIComponent(rawToken)}`,
        }, 201);
      } catch (err) {
        const message = (err as { message?: string })?.message ?? 'No se pudo crear la invitacion';
        return errorResponse(req, 400, message, 'invitation_error');
      }
    }

    if (auth && req.method === 'PUT' && pathname === '/api/settings') {
      if (!isAdmin(auth)) {
        return errorResponse(req, 403, 'Solo administradores', 'forbidden');
      }

      try {
        const body = await readJsonBody<{
          appName?: string;
          sessionTimeoutMinutes?: number;
          defaultApiKeyRateLimit?: number;
          anonymousRateLimitPerMinute?: number;
          allowedOrigins?: string;
          defaultChatModel?: string;
          enableUserKeyCreation?: boolean;
          openRouterFreeOnly?: boolean;
        }>(req);
        const settings = updateAppSettings(body);
        await reloadPool('settings-updated');
        return jsonResponse(req, { ok: true, settings });
      } catch (err) {
        const message = (err as { message?: string })?.message ?? 'No se pudieron guardar los ajustes';
        return errorResponse(req, 400, message, 'settings_error');
      }
    }

    const providerLimitMatch = pathname.match(/^\/api\/rate-limits\/provider\/([^/]+)$/);
    if (auth && req.method === 'PUT' && providerLimitMatch) {
      if (!isAdmin(auth)) {
        return errorResponse(req, 403, 'Solo administradores', 'forbidden');
      }

      try {
        const body = await readJsonBody<{
          mode?: unknown;
          rpm?: unknown;
          rpd?: unknown;
          tpm?: unknown;
          tpd?: unknown;
          ash?: unknown;
          asd?: unknown;
        }>(req);
        const providerId = normalizeProviderId(decodeURIComponent(providerLimitMatch[1] ?? ''));
        const rule = sanitizeLimitRule(body);
        const saved = upsertRateLimitRule({
          scopeType: 'provider',
          scopeId: providerId,
          provider: providerId,
          ...rule,
        });
        return jsonResponse(req, { ok: true, rule: saved });
      } catch (err) {
        const message = (err as { message?: string })?.message ?? 'No se pudo guardar el limite del proveedor';
        return errorResponse(req, 400, message, 'rate_limit_error');
      }
    }

    if (auth && req.method === 'PUT' && pathname === '/api/rate-limits/model') {
      if (!isAdmin(auth)) {
        return errorResponse(req, 403, 'Solo administradores', 'forbidden');
      }

      try {
        const body = await readJsonBody<{
          modelId?: string;
          mode?: unknown;
          rpm?: unknown;
          rpd?: unknown;
          tpm?: unknown;
          tpd?: unknown;
          ash?: unknown;
          asd?: unknown;
        }>(req);

        if (!body.modelId?.trim()) {
          return errorResponse(req, 400, 'modelId es obligatorio', 'validation_error');
        }

        const modelId = decodeURIComponent(body.modelId.trim());
        const [provider] = modelId.split('/');
        const rule = sanitizeLimitRule(body);
        const saved = upsertRateLimitRule({
          scopeType: 'model',
          scopeId: modelId,
          provider: provider,
          ...rule,
        });
        return jsonResponse(req, { ok: true, rule: saved });
      } catch (err) {
        const message = (err as { message?: string })?.message ?? 'No se pudo guardar el limite del modelo';
        return errorResponse(req, 400, message, 'rate_limit_error');
      }
    }

    if (auth && req.method === 'GET' && pathname === '/api/service-keys') {
      if (!isAdmin(auth)) {
        return errorResponse(req, 403, 'Solo administradores', 'forbidden');
      }
      return jsonResponse(req, { serviceKeys: listConfiguredProviderKeys() });
    }

    if (auth && req.method === 'POST' && pathname === '/api/service-keys') {
      if (!isAdmin(auth)) {
        return errorResponse(req, 403, 'Solo administradores', 'forbidden');
      }

      try {
        const body = await readJsonBody<{
          provider: ProviderName;
          name: string;
          value: string;
          priority?: number;
        }>(req);

        if (!body.provider || !body.name?.trim() || !body.value?.trim()) {
          return errorResponse(req, 400, 'provider, name y value son obligatorios', 'validation_error');
        }

        const encrypted = encryptSecret(body.value.trim());
        const record = createServiceApiKey({
          id: `sak_${randomToken(10)}`,
          provider: body.provider,
          name: body.name,
          keyHash: hashToken(body.value.trim()),
          keyHint: maskSecret(body.value.trim()),
          encryptedValue: encrypted.ciphertext,
          valueIv: encrypted.iv,
          valueTag: encrypted.tag,
          priority: Math.max(1, Math.floor(body.priority ?? 100)),
        });

        await reloadPool('service-key-created');
        return jsonResponse(req, { ok: true, serviceKey: record }, 201);
      } catch (err) {
        const message = (err as { message?: string })?.message ?? 'No se pudo guardar la service key';
        return errorResponse(req, 400, message, 'service_key_error');
      }
    }

    const serviceKeyMatch = pathname.match(/^\/api\/service-keys\/([^/]+)$/);
    if (auth && req.method === 'PATCH' && serviceKeyMatch) {
      if (!isAdmin(auth)) {
        return errorResponse(req, 403, 'Solo administradores', 'forbidden');
      }

      try {
        const body = await readJsonBody<{ name?: string; priority?: number; isActive?: boolean }>(req);
        updateServiceApiKey(serviceKeyMatch[1] ?? '', {
          name: body.name,
          priority: body.priority !== undefined ? Math.max(1, Math.floor(body.priority)) : undefined,
          isActive: body.isActive,
        });
        await reloadPool('service-key-updated');
        return jsonResponse(req, { ok: true, serviceKeys: listConfiguredProviderKeys() });
      } catch (err) {
        const message = (err as { message?: string })?.message ?? 'No se pudo actualizar la service key';
        return errorResponse(req, 400, message, 'service_key_error');
      }
    }

    if (auth && req.method === 'GET' && pathname === '/api/metrics/overview') {
      const { scope: metricsScope } = resolveRequestMetricsScope(auth);
      const metrics = getDashboardMetrics(metricsScope);
      return jsonResponse(req, {
        metrics,
        modelTelemetry: isAdmin(auth) ? getAllModelStats() : buildScopedModelTelemetry(metrics),
      });
    }

    const adminResetMatch = pathname.match(/^\/api\/admin\/reset(?:\/(.*))?$/);
    if (auth && req.method === 'POST' && adminResetMatch) {
      if (!isAdmin(auth)) {
        return errorResponse(req, 403, 'Solo administradores', 'forbidden');
      }

      const modelName = decodeURIComponent(adminResetMatch[1] ?? '').trim();
      if (resetStates(modelName || undefined)) {
        if (modelName) {
          clearModelRateLimit(modelName);
        } else {
          states.forEach((state) => clearModelRateLimit(state.service.name));
          clearAllProviderRateLimits();
        }
        return jsonResponse(req, { ok: true, reset: modelName || 'all' });
      }
      return errorResponse(req, 404, `Modelo '${modelName}' no encontrado`, 'not_found');
    }

    if (auth && req.method === 'GET' && pathname === '/status') {
      const now = Date.now();
      const providerCooldownMap = new Map(getAllProviderStats().map((item) => [item.id, item]));
      const report = states.map((state) => ({
        name: state.service.name,
        supportsTools: state.service.supportsTools,
        supportsVision: Boolean(state.service.supportsVision),
        status: state.disabled
          ? 'disabled'
          : Math.max(
            state.cooldownUntil,
            providerCooldownMap.get(normalizeProviderId(state.service.name.split('/')[0] ?? ''))?.cooldownUntil ?? 0,
          ) > now
            ? `cooldown ${Math.ceil((
              Math.max(
                state.cooldownUntil,
                providerCooldownMap.get(normalizeProviderId(state.service.name.split('/')[0] ?? ''))?.cooldownUntil ?? 0,
              ) - now
            ) / 1000)}s`
            : 'available',
      }));
      return jsonResponse(req, report);
    }

    if (auth && req.method === 'POST' && pathname.startsWith('/admin/reset')) {
      if (!isAdmin(auth)) {
        return errorResponse(req, 403, 'Solo administradores', 'forbidden');
      }

      const modelName = decodeURIComponent(pathname.replace('/admin/reset/', '').replace('/admin/reset', '').trim());
      if (resetStates(modelName || undefined)) {
        if (modelName) {
          clearModelRateLimit(modelName);
        } else {
          states.forEach((state) => clearModelRateLimit(state.service.name));
          clearAllProviderRateLimits();
        }
        return jsonResponse(req, { ok: true, reset: modelName || 'all' });
      }
      return errorResponse(req, 404, `Modelo '${modelName}' no encontrado`, 'not_found');
    }

    if (auth && req.method === 'GET' && pathname === '/v1/models') {
      const now = Date.now();
      const providerCooldownMap = new Map(getAllProviderStats().map((item) => [item.id, item]));
      const virtualModels = [
        { id: 'auto', object: 'model', created: Math.floor(now / 1000), owned_by: 'system', supports_tools: true, status: 'available' },
        { id: 'img', object: 'model', created: Math.floor(now / 1000), owned_by: 'system', supports_tools: false, status: 'available' },
        { id: 'tools', object: 'model', created: Math.floor(now / 1000), owned_by: 'system', supports_tools: true, status: 'available' },
      ];
      const data = states.filter((state) => !state.disabled).map((state) => ({
        id: state.service.name,
        object: 'model',
        created: Math.floor(now / 1000),
        owned_by: state.service.name.split('/')[0],
        supports_tools: state.service.supportsTools,
        supports_vision: Boolean(state.service.supportsVision),
        status: Math.max(
          state.cooldownUntil,
          providerCooldownMap.get(normalizeProviderId(state.service.name.split('/')[0] ?? ''))?.cooldownUntil ?? 0,
        ) > now ? 'cooldown' : 'available',
      }));
      return jsonResponse(req, { object: 'list', data: [...virtualModels, ...data] });
    }

    if (auth && req.method === 'GET' && pathname === '/v1/metrics') {
      const { scope: metricsScope } = resolveRequestMetricsScope(auth);
      const dashboard = getDashboardMetrics(metricsScope);
      const dbStats = isAdmin(auth) ? getAllModelStats() : buildScopedModelTelemetry(dashboard);
      const active = isAdmin(auth) ? dbStats.filter((item) => item.status === 'active') : [];
      const cooldown = isAdmin(auth) ? dbStats.filter((item) => item.status === 'cooldown') : [];

      return jsonResponse(req, {
        total_models_tracked: dbStats.length,
        available: active.length,
        rate_limited: cooldown.length,
        models_in_cooldown: cooldown.map((item) => ({
          id: item.id,
          locked_until: new Date(item.rate_limited_until).toLocaleString(),
          seconds_remaining: Math.max(0, Math.ceil((item.rate_limited_until - Date.now()) / 1000)),
        })),
        usage_telemetry: dbStats
          .sort((left, right) => right.requests_served - left.requests_served)
          .slice(0, 50)
          .map((item) => ({
            id: item.id,
            provider: item.provider,
            requests_served: item.requests_served,
          })),
        provider_metrics: dashboard.providers,
        model_metrics: dashboard.models,
        daily_metrics: dashboard.daily,
        request_type_metrics: dashboard.requestTypes,
        summary: dashboard.summary,
      });
    }

    if (auth && req.method === 'POST' && pathname === '/v1/images/generations') {
      try {
        const body = await readJsonBody<{
          prompt?: string;
          model?: string;
          n?: number;
          size?: string;
          quality?: string;
          response_format?: 'url' | 'b64_json';
        }>(req);
        if (!body.prompt) {
          throw new Error("Falta el parametro 'prompt' para generar la imagen");
        }

        const targetModel = body.model && body.model !== 'auto' ? body.model : 'flux';
        const usageEstimate = buildUsageEstimate({ requests: 1 });
        ensureProviderLimitAvailable('pollinations', usageEstimate);
        const pollinationKeys = getProviderKeyCandidates('pollinations');
        const json = pollinationKeys.length > 0
          ? await withProviderKey('pollinations', async ({ key }) => {
            const response = await fetch('https://gen.pollinations.ai/v1/images/generations', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${key}`,
              },
              body: JSON.stringify({
                prompt: body.prompt,
                model: targetModel,
                n: body.n || 1,
                size: body.size || '1024x1024',
                quality: body.quality,
                response_format: 'b64_json',
              }),
            });
            if (!response.ok) {
              throw buildProviderError(response.status, await response.text(), response.headers);
            }
            return await response.json() as { data?: Array<Record<string, unknown>> };
          })
          : await (async () => {
            const response = await fetch('https://gen.pollinations.ai/v1/images/generations', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                prompt: body.prompt,
                model: targetModel,
                n: body.n || 1,
                size: body.size || '1024x1024',
                quality: body.quality,
                response_format: 'b64_json',
              }),
            });
            if (!response.ok) {
              throw new Error(await response.text());
            }
            return await response.json() as { data?: Array<Record<string, unknown>> };
          })();

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

    if (auth && req.method === 'POST' && pathname === '/v1/audio/transcriptions') {
      let providerMeta = getAudioProviderMeta('groq');
      let estimatedAudioSeconds = 0;
      try {
        const formData = await req.formData();
        const provider = normalizeAudioProvider(formData.get('provider'));
        providerMeta = getAudioProviderMeta(provider);
        const file = formData.get('file');
        if (!(file instanceof File)) {
          throw new Error("Falta el campo 'file' en el FormData");
        }
        const language = typeof formData.get('language') === 'string' && String(formData.get('language')).trim()
          ? String(formData.get('language')).trim()
          : null;
        const durationField = Number(formData.get('duration_seconds') ?? formData.get('audio_seconds') ?? 0);
        estimatedAudioSeconds = Number.isFinite(durationField) && durationField > 0 ? Math.ceil(durationField) : 0;
        const usageEstimate = buildUsageEstimate({
          requests: 1,
          audioSeconds: estimatedAudioSeconds,
        });
        ensureProviderLimitAvailable(provider, usageEstimate);

        const json = provider === 'witai'
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

    if (auth && req.method === 'POST' && pathname === '/v1/embeddings') {
      try {
        const body = await readJsonBody<{ input: string | string[] }>(req);
        const texts = Array.isArray(body.input) ? body.input : [body.input];
        if (texts.length === 0) {
          throw new Error('No hay textos para generar embeddings');
        }
        const usageEstimate = estimateEmbeddingsUsage(texts);

        try {
          ensureProviderLimitAvailable('mistral', usageEstimate);
          const data = await withProviderKey('mistral', async ({ key }) => {
            const response = await fetch('https://api.mistral.ai/v1/embeddings', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ input: texts, model: 'mistral-embed' }),
            });
            if (!response.ok) {
              throw buildProviderError(response.status, await response.text(), response.headers);
            }
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
          ensureProviderLimitAvailable('cohere', usageEstimate);
          const data = await withProviderKey('cohere', async ({ key }) => {
            const response = await fetch('https://api.cohere.com/v1/embed', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
              },
              body: JSON.stringify({
                texts,
                model: 'embed-multilingual-v3.0',
                input_type: 'search_document',
              }),
            });
            if (!response.ok) {
              throw buildProviderError(response.status, await response.text(), response.headers);
            }
            const payload = await response.json() as {
              embeddings: number[][];
              meta?: { billed_units?: { input_tokens?: number } };
            };
            return {
              object: 'list',
              model: 'cohere/embed-multilingual',
              data: payload.embeddings.map((embedding, index) => ({
                object: 'embedding',
                embedding,
                index,
              })),
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

    if (auth && req.method === 'POST' && (pathname === '/v1/chat/completions' || pathname === '/chat')) {
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
      const { stream: wantsStream = true, model = settings.defaultChatModel || 'auto', stream_options: _ignored, ...chatRequest } = body;
      const id = genId();
      const useAuto = !model || ['auto', 'img', 'tools'].includes(model);
      const forceTools = model === 'tools';
      const forceVision = model === 'img';
      const usageEstimate = estimateChatUsage(chatRequest);
      const cacheEligible = isChatCacheEligible(chatRequest, wantsStream);
      const cacheScopeKey = resolveCacheScopeKey(auth, req);
      const cacheKey = cacheEligible
        ? buildChatCacheKey({
          scopeKey: cacheScopeKey,
          model: String(model || 'auto'),
          body: { ...chatRequest, model: String(model || 'auto') },
        })
        : null;

      if (cacheKey) {
        const cached = getCachedResponse(cacheKey, cacheScopeKey);
        if (cached) {
          const cachedResponse = cached.response as {
            model?: string;
            usage?: {
              prompt_tokens?: number;
              completion_tokens?: number;
              total_tokens?: number;
            };
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

      try {
        const { stream, serviceName } = useAuto
          ? await tryServices(chatRequest, id, forceTools, forceVision)
          : await trySpecificService(model, chatRequest, id);

        const meta = splitServiceName(serviceName);

        if (wantsStream) {
          const trackedStream = observeSSE(stream, {
            onComplete: ({ usage }) => {
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
            }),
          });
        }

        const { content, tool_calls, finish_reason, usage } = await collectSSE(stream);
        const finalUsage = resolveUsage(usageEstimate, usage);
        const created = Math.floor(Date.now() / 1000);
        const assistantMessage: Record<string, unknown> = { role: 'assistant', content: content || null };
        if (tool_calls.length) {
          assistantMessage.tool_calls = tool_calls;
        }

        const responseBody = {
          id,
          object: 'chat.completion',
          created,
          model: serviceName,
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

        const headers: Record<string, string> = {};
        if (retryAfter) {
          headers['Retry-After'] = String(retryAfter);
        }

        return errorResponse(req, httpStatus, message, (err as { code?: string })?.code ?? 'service_unavailable', headers, {
          details: (err as { details?: unknown })?.details ?? [],
        });
      }
    }

  return errorResponse(req, 404, 'Not found', 'not_found');
}

export async function appFetch(req: Request, server: RequestServer): Promise<Response> {
  const url = new URL(req.url);
  const requestId = req.headers.get('x-request-id')?.trim() || crypto.randomUUID();
  const ip = getRequestIp(req, server);
  const startedAt = Date.now();
  const runtime = { pathname: url.pathname, ip, startedAt };

  bindRequestContext(req, { requestId, ip, startedAt });

  const requestLogger = logger.child({
    requestId,
    method: req.method,
    path: runtime.pathname,
    ip,
  });

  requestLogger.info({
    origin: req.headers.get('origin') ?? null,
    userAgent: req.headers.get('user-agent') ?? null,
  }, 'request.received');

  let response: Response;

  try {
    response = await routeRequest(req, server, runtime);
  } catch (err) {
    requestLogger.error({ err }, 'request.failed');
    response = errorResponse(req, 500, 'Internal Server Error', 'internal_error');
  }

  response.headers.set('X-Request-Id', requestId);
  requestLogger.info({
    statusCode: response.status,
    durationMs: Date.now() - startedAt,
  }, 'request.completed');

  return response;
}

type ServeOptions = Parameters<typeof Bun.serve>[0];

export function startServer(overrides: Partial<Omit<ServeOptions, 'fetch'>> = {}) {
  const server = Bun.serve({
    port: appConfig.port,
    hostname: appConfig.host,
    ...overrides,
    fetch: appFetch,
  });

  logger.info({
    env: appConfig.env,
    url: server.url.toString(),
  }, 'server.started');
  logger.info({
    totalServices: states.length,
    enabledServices: states.filter((state) => !state.disabled).length,
  }, 'services.loaded');

  return server;
}

export const server = import.meta.main ? startServer() : null;

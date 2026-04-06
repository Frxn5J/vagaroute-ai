import type { AuthContext } from '../middlewares/auth';
import { isAdmin } from '../middlewares/auth';
import {
  getProjectModelAccess,
  listAllProjects,
  listProjectsForUser,
  recordRequestMetric,
  type DashboardMetrics,
  type ProjectModelAccessMode,
} from '../core/db';
import { buildUsageEstimate, normalizeProviderId } from '../core/usageLimits';
import { buildCacheScopeKey } from '../core/responseCache';
import { appConfig } from '../core/config';
import { withCors } from '../utils/cors';
import { getRequestId } from '../utils/requestContext';
import { randomToken } from '../utils/crypto';
import type { StreamUsage, UsageSource } from '../utils/stream';
import type { ChatRequest } from '../types';
import type { ServiceState } from '../core/pool';

// ─── Context & handler types ───────────────────────────────────────────────

export type RouteContext = {
  pathname: string;
  ip: string;
  startedAt: number;
};

export type AuthedHandler = (
  req: Request,
  auth: AuthContext,
  ctx: RouteContext,
) => Promise<Response | null>;

// ─── Response helpers ──────────────────────────────────────────────────────

export function jsonResponse(
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

export function errorResponse(
  req: Request,
  status: number,
  message: string,
  type: string = 'error',
  extraHeaders: Record<string, string> = {},
  extraBody: Record<string, unknown> = {},
): Response {
  return jsonResponse(req, { error: { message, type, ...extraBody } }, status, extraHeaders);
}

export async function readJsonBody<T>(req: Request): Promise<T> {
  return await req.json() as T;
}

// ─── Error helpers ─────────────────────────────────────────────────────────

export function buildProviderError(
  status: number,
  message: string,
  headers?: Headers,
): Error & { status: number; headers?: Headers } {
  return Object.assign(new Error(message), { status, headers });
}

export function getHttpStatusFromError(err: unknown, fallback: number): number {
  const candidate =
    (err as { httpStatus?: number; status?: number })?.httpStatus ??
    (err as { httpStatus?: number; status?: number })?.status;
  return typeof candidate === 'number' && candidate >= 400 && candidate < 600
    ? candidate
    : fallback;
}

export function getRetryAfterFromError(err: unknown): number | null {
  const value = err as {
    headers?: Headers | Record<string, string>;
    response?: { headers?: Headers | Record<string, string> };
  };
  const headers = value.headers ?? value.response?.headers;
  if (!headers) return null;

  const raw =
    typeof (headers as Headers).get === 'function'
      ? ((headers as Headers).get('retry-after') ??
          (headers as Headers).get('x-ratelimit-reset') ??
          (headers as Headers).get('x-ratelimit-reset-requests'))
      : ((headers as Record<string, string>)['retry-after'] ??
          (headers as Record<string, string>)['x-ratelimit-reset'] ??
          (headers as Record<string, string>)['x-ratelimit-reset-requests']);

  const seconds = Number.parseFloat(raw ?? '');
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
}

// ─── Auth / scope helpers ──────────────────────────────────────────────────

export function resolveProjectIdForRequest(auth: AuthContext | null, req: Request): string | null {
  if (!auth) return null;
  if (auth.apiKey?.projectId) return auth.apiKey.projectId;

  const requestedProjectId = req.headers.get('x-project-id')?.trim() || null;
  if (auth.user.id === 'system') return requestedProjectId;

  const visibleProjects = isAdmin(auth) ? listAllProjects() : listProjectsForUser(auth.user.id);

  if (requestedProjectId && visibleProjects.some((p) => p.id === requestedProjectId)) {
    return requestedProjectId;
  }
  return visibleProjects[0]?.id ?? null;
}

export function resolveCacheScopeKey(auth: AuthContext | null, req: Request): string {
  return buildCacheScopeKey({
    userId: auth?.user.id ?? null,
    apiKeyId: auth?.apiKey?.id ?? null,
    projectId: resolveProjectIdForRequest(auth, req),
  });
}

export function resolveProjectModelPolicy(auth: AuthContext | null, req: Request): {
  projectId: string | null;
  mode: ProjectModelAccessMode;
  allowedModelIds: string[];
} {
  const requestedProjectId = req.headers.get('x-project-id')?.trim() || null;
  let projectId: string | null = null;

  if (auth?.apiKey?.projectId) {
    projectId = auth.apiKey.projectId;
  } else if (auth?.user.id === 'system') {
    projectId = requestedProjectId;
  } else if (auth && requestedProjectId) {
    const visibleProjects = isAdmin(auth) ? listAllProjects() : listProjectsForUser(auth.user.id);
    projectId = visibleProjects.some((project) => project.id === requestedProjectId) ? requestedProjectId : null;
  }

  const access = getProjectModelAccess(projectId);
  return {
    projectId,
    mode: access.mode,
    allowedModelIds: access.allowedModelIds,
  };
}

export function isModelAllowedByProjectPolicy(
  modelId: string,
  policy: { mode: ProjectModelAccessMode; allowedModelIds: string[] },
): boolean {
  if (policy.mode === 'all') {
    return true;
  }
  if (policy.mode === 'none') {
    return false;
  }
  return policy.allowedModelIds.includes(modelId);
}

export function filterStatesByProjectPolicy(
  poolStates: ServiceState[],
  policy: { mode: ProjectModelAccessMode; allowedModelIds: string[] },
): ServiceState[] {
  if (policy.mode === 'all') {
    return poolStates;
  }
  if (policy.mode === 'none') {
    return [];
  }
  const allowed = new Set(policy.allowedModelIds);
  return poolStates.filter((state) => allowed.has(state.service.name));
}

export function resolveRequestMetricsScope(auth: AuthContext): {
  scope: { userId?: string | null; visibleProjectIds?: string[] | null } | undefined;
  visibleProjects: ReturnType<typeof listProjectsForUser>;
} {
  const visibleProjects = isAdmin(auth) ? listAllProjects() : listProjectsForUser(auth.user.id);
  if (isAdmin(auth)) return { scope: undefined, visibleProjects };
  return {
    scope: { userId: auth.user.id, visibleProjectIds: visibleProjects.map((p) => p.id) },
    visibleProjects,
  };
}

export function splitServiceName(serviceName: string | null | undefined): {
  provider: string | null;
  model: string | null;
} {
  if (!serviceName) return { provider: null, model: null };
  const [provider, ...rest] = serviceName.split('/');
  return {
    provider: provider ? normalizeProviderId(provider) : null,
    model: rest.length > 0 ? rest.join('/') : null,
  };
}

export function buildScopedModelTelemetry(metrics: DashboardMetrics) {
  return metrics.models
    .map((item) => ({
      id: `${item.provider}/${item.model}`,
      provider: item.provider,
      status: 'scoped',
      rate_limited_until: 0,
      requests_served: item.totalRequests,
    }))
    .sort((a, b) => b.requests_served - a.requests_served)
    .slice(0, 100);
}

// ─── Usage helpers ─────────────────────────────────────────────────────────

export function resolveUsage(
  estimate: ReturnType<typeof buildUsageEstimate>,
  usage: StreamUsage | null | undefined,
) {
  return buildUsageEstimate({
    requests: estimate.requests,
    promptTokens: usage?.promptTokens ?? estimate.promptTokens,
    completionTokens: usage?.completionTokens ?? estimate.completionTokens,
    totalTokens: usage?.totalTokens ?? estimate.totalTokens,
    audioSeconds: estimate.audioSeconds,
  });
}

export function isChatCacheEligible(
  request: ChatRequest & { stream?: boolean },
  wantsStream: boolean,
): boolean {
  if (wantsStream || !appConfig.responseCacheEnabled) return false;
  if (Array.isArray(request.tools) && request.tools.length > 0) return false;
  const containsVision = (request.messages ?? []).some(
    (message) =>
      Array.isArray(message.content) && message.content.some((part) => part.type !== 'text'),
  );
  return !containsVision;
}

// ─── Metrics recording ─────────────────────────────────────────────────────

export function recordServiceMetric(
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
    /** Tag whether token counts were confirmed by the provider or are local estimates. */
    usageSource?: UsageSource;
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
    errorMessage: details.errorMessage ?? null,
    sourceIp: ip,
    usageSource: details.usageSource ?? 'estimated',
  });
}

import { existsSync } from 'node:fs';
import path from 'node:path';
import { appConfig } from './core/config';
import { getAppSettings } from './core/db';
import { initializePool, states } from './core/pool';
import { getAllProviderStats } from './core/db';
import { normalizeProviderId } from './core/usageLimits';
import { authenticateRequest, isAdmin } from './middlewares/auth';
import { checkRateLimit } from './middlewares/rateLimit';
import { getCorsRejectionResponse, withCors } from './utils/cors';
import { logger } from './utils/logger';
import { bindRequestContext, getRequestId } from './utils/requestContext';

// ─── Route modules ─────────────────────────────────────────────────────────
import { handlePreAuthRoutes } from './routes/auth';
import { handleChat } from './routes/chat';
import { handleMedia } from './routes/media';
import { handleModels } from './routes/models';
import { handleApiKeys } from './routes/admin/apiKeys';
import { handleCustomProviders } from './routes/admin/customProviders';
import { handleAdminMetrics } from './routes/admin/metrics';
import { handleModelTiers } from './routes/admin/modelTiers';
import { handleModelCapabilities } from './routes/admin/modelCapabilities';
import { handleProjects } from './routes/admin/projects';
import { handleRateLimits } from './routes/admin/rateLimits';
import { handleServiceKeys } from './routes/admin/serviceKeys';
import { handleSettings } from './routes/admin/settings';
import { handleModelAliases } from './routes/admin/modelAliases';
import { handleUsers } from './routes/admin/users';
import { errorResponse, jsonResponse, type RouteContext } from './routes/_shared';

// ─── Boot ──────────────────────────────────────────────────────────────────

const startTime = Date.now();
const publicDir = path.join(process.cwd(), 'public');
const appShellPath = path.join(publicDir, 'index.html');

type RequestServer = { requestIP(request: Request): { address: string } | null };

if (!appConfig.isTest) {
  await initializePool();
}

// ─── Static file serving ───────────────────────────────────────────────────

function isPathInsideBase(baseDir: string, candidatePath: string): boolean {
  const rel = path.relative(baseDir, candidatePath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isServiceRoute(pathname: string): boolean {
  return (
    pathname === '/chat' ||
    pathname === '/status' ||
    pathname.startsWith('/v1/') ||
    pathname.startsWith('/admin/reset')
  );
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

// ─── Rate limit helpers ────────────────────────────────────────────────────

function applyAnonymousRateLimit(req: Request, ip: string): Response | null {
  const settings = getAppSettings();
  const limit = checkRateLimit(`anon:${ip}`, settings.anonymousRateLimitPerMinute);
  if (!limit.limited) return null;
  return errorResponse(req, 429, 'Too many requests', 'rate_limit_error', {
    'Retry-After': String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))),
  });
}

function applyServiceRateLimit(req: Request, auth: Awaited<ReturnType<typeof authenticateRequest>>, ip: string): Response | null {
  if (!auth) return null;
  const settings = getAppSettings();
  const limit = auth.apiKey
    ? checkRateLimit(`key:${auth.apiKey.id}`, auth.apiKey.rateLimitPerMinute)
    : checkRateLimit(`user:${auth.user.id || ip}`, settings.defaultApiKeyRateLimit);
  if (!limit.limited) return null;
  return errorResponse(req, 429, 'Too many requests', 'rate_limit_error', {
    'Retry-After': String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))),
  });
}

// ─── Authenticated handler chain ───────────────────────────────────────────

const AUTHED_HANDLERS = [
  handleSettings,
  handleModelAliases,
  handleUsers,
  handleApiKeys,
  handleProjects,
  handleServiceKeys,
  handleRateLimits,
  handleModelTiers,
  handleModelCapabilities,
  handleCustomProviders,
  handleAdminMetrics,
  handleModels,
  handleChat,
  handleMedia,
] as const;

// ─── Router ────────────────────────────────────────────────────────────────

async function routeRequest(req: Request, server: RequestServer, runtime: RouteContext): Promise<Response> {
  const { pathname, ip } = runtime;

  // CORS
  const corsRejection = getCorsRejectionResponse(req);
  if (corsRejection) return corsRejection;

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: withCors(req, { 'X-Request-Id': getRequestId(req) }) });
  }

  // Health (pre-auth, inline — references server state at startup)
  if (req.method === 'GET' && pathname === '/health') {
    const now = Date.now();
    const providerCooldownMap = new Map(getAllProviderStats().map((item) => [item.id, item]));
    return jsonResponse(req, {
      status: 'ok',
      uptime: Math.floor((now - startTime) / 1000),
      services: {
        total: states.length,
        available: states.filter((state) => {
          const providerCooldown =
            providerCooldownMap.get(normalizeProviderId(state.service.name.split('/')[0] ?? ''))?.cooldownUntil ?? 0;
          return !state.disabled && Math.max(state.cooldownUntil, providerCooldown) <= now;
        }).length,
        disabled: states.filter((state) => state.disabled).length,
      },
    });
  }

  // Public routes (login, bootstrap, invitations, password reset)
  const publicResponse = await handlePreAuthRoutes(
    req,
    runtime,
    () => applyAnonymousRateLimit(req, ip),
  );
  if (publicResponse) return publicResponse;

  // Static files
  const staticResponse = tryServeStatic(req, pathname);
  if (staticResponse) return staticResponse;

  // Auth — required for all remaining routes
  const auth = await authenticateRequest(req);
  const isManagementRoute = pathname.startsWith('/api/');

  if ((isManagementRoute || isServiceRoute(pathname)) && !auth) {
    return errorResponse(req, 401, 'Unauthorized', 'auth_error');
  }

  if (!auth) return errorResponse(req, 404, 'Not found', 'not_found');

  if (isServiceRoute(pathname)) {
    const limited = applyServiceRateLimit(req, auth, ip);
    if (limited) return limited;
  }

  // Dispatch authenticated route handlers
  for (const handler of AUTHED_HANDLERS) {
    const response = await handler(req, auth, runtime);
    if (response) return response;
  }

  return errorResponse(req, 404, 'Not found', 'not_found');
}

// ─── Entry point ───────────────────────────────────────────────────────────

export async function appFetch(req: Request, server: RequestServer): Promise<Response> {
  const url = new URL(req.url);
  const requestId = req.headers.get('x-request-id')?.trim() || crypto.randomUUID();
  const ip = server.requestIP(req)?.address || req.headers.get('x-forwarded-for') || 'unknown-ip';
  const startedAt = Date.now();

  bindRequestContext(req, { requestId, ip, startedAt });

  const requestLogger = logger.child({ requestId, method: req.method, path: url.pathname, ip });
  requestLogger.info({ origin: req.headers.get('origin') ?? null, userAgent: req.headers.get('user-agent') ?? null }, 'request.received');

  let response: Response;
  try {
    response = await routeRequest(req, server, { pathname: url.pathname, ip, startedAt });
  } catch (err) {
    requestLogger.error({ err }, 'request.failed');
    response = errorResponse(req, 500, 'Internal Server Error', 'internal_error');
  }

  response.headers.set('X-Request-Id', requestId);
  requestLogger.info({ statusCode: response.status, durationMs: Date.now() - startedAt }, 'request.completed');
  return response;
}

type ServeOptions = Parameters<typeof Bun.serve>[0];

export function startServer(overrides: Partial<Omit<ServeOptions, 'fetch'>> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const server = Bun.serve({ port: appConfig.port, hostname: appConfig.host, ...overrides, fetch: appFetch } as any);

  logger.info({ env: appConfig.env, url: server.url.toString() }, 'server.started');
  logger.info({ totalServices: states.length, enabledServices: states.filter((s) => !s.disabled).length }, 'services.loaded');
  return server;
}

export const server = import.meta.main ? startServer() : null;

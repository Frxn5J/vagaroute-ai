import type { AuthContext } from '../../middlewares/auth';
import { isAdmin } from '../../middlewares/auth';
import {
  getAllModelStats,
  getAllProviderStats,
  getAppSettings,
  getDashboardMetrics,
  getProjectUsageSummaries,
  getRecentErrors,
  getSpendSummary,
  getTokenSummary,
  getUserUsageSummaries,
  listAllApiKeys,
  listAllProjects,
  listApiKeysForUser,
  listInvitationTokens,
  listModelTierOverrides,
  listProjectsForUser,
  listRateLimitRules,
  listUsers,
  updateAppSettings,
  type RequestMetricsScope,
} from '../../core/db';
import { listConfiguredProviderKeys } from '../../core/providerKeys';
import { listCustomProviders } from '../../core/customProviders';
import { reloadPool, states } from '../../core/pool';
import { getResponseCacheStats } from '../../core/responseCache';
import { normalizeProviderId } from '../../core/usageLimits';
import {
  buildScopedModelTelemetry,
  errorResponse,
  jsonResponse,
  readJsonBody,
  resolveRequestMetricsScope,
  type RouteContext,
} from '../_shared';

// ─── Dashboard payload builder ─────────────────────────────────────────────

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
  const alerts: Array<{ id: string; severity: 'info' | 'warning' | 'error'; title: string; message: string }> = [];

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
    ? getAllModelStats().sort((a, b) => b.requests_served - a.requests_served).slice(0, 100)
    : buildScopedModelTelemetry(metrics);
  const providerNames = Array.from(
    new Set(states.map((state) => normalizeProviderId(state.service.name.split('/')[0] ?? ''))),
  );
  const userUsage = isAdmin(auth) ? getUserUsageSummaries() : getUserUsageSummaries(metricsScope);
  const projectUsage = isAdmin(auth) ? getProjectUsageSummaries() : getProjectUsageSummaries(metricsScope);
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
        const providerCooldownUntil =
          providerCooldownMap.get(normalizeProviderId(state.service.name.split('/')[0] ?? ''))?.cooldownUntil ?? 0;
        return !state.disabled && Math.max(state.cooldownUntil, providerCooldownUntil) <= now;
      }).length,
      disabled: states.filter((state) => state.disabled).length,
      cooldown: states.filter((state) => {
        const providerCooldownUntil =
          providerCooldownMap.get(normalizeProviderId(state.service.name.split('/')[0] ?? ''))?.cooldownUntil ?? 0;
        return !state.disabled && Math.max(state.cooldownUntil, providerCooldownUntil) > now;
      }).length,
      providers: providerNames.map((providerId) => {
        const providerState = providerCooldownMap.get(providerId);
        return {
          id: providerId,
          status: (providerState?.cooldownUntil ?? 0) > now ? 'cooldown' : 'available',
          cooldownUntil: providerState?.cooldownUntil ?? 0,
          lastReason: providerState?.lastReason ?? null,
          models: states.filter((s) => normalizeProviderId(s.service.name.split('/')[0] ?? '') === providerId).length,
        };
      }),
      models: states.map((state) => ({
        id: state.service.name,
        provider: state.service.name.split('/')[0] ?? 'Unknown',
        supportsTools: state.service.supportsTools,
        supportsVision: Boolean(state.service.supportsVision),
        paidOnly: state.paidOnly,
        tier: state.tier,
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
      ? { providerRules: listRateLimitRules('provider'), modelRules: listRateLimitRules('model') }
      : { providerRules: [], modelRules: [] },
    metrics,
    modelTelemetry,
    spend,
    tokens,
    projects: visibleProjects,
    invitations: isAdmin(auth) ? listInvitationTokens() : [],
    recentErrors,
    userUsage,
    projectUsage,
    alerts: buildDashboardAlerts(auth, { tokens, userUsage, projectUsage, providerStats }),
    customProviders: isAdmin(auth) ? listCustomProviders() : [],
    modelTierOverrides: isAdmin(auth) ? listModelTierOverrides() : [],
    cache: getResponseCacheStats(isAdmin(auth) ? undefined : { userId: auth.user.id }),
    tokenization: { mode: 'provider-usage-with-fallback', exactForCompletedResponses: true },
  };
}

// ─── Route handlers ─────────────────────────────────────────────────────────

export async function handleSettings(
  req: Request,
  auth: AuthContext,
  ctx: RouteContext,
): Promise<Response | null> {
  const { pathname } = ctx;

  // ── GET /api/auth/me ──────────────────────────────────────────────────────

  if (req.method === 'GET' && pathname === '/api/auth/me') {
    return jsonResponse(req, {
      user: auth.user,
      via: auth.via,
      isAdmin: isAdmin(auth),
      sessionExpiresAt: auth.session?.expiresAt ?? null,
    });
  }

  // ── GET /api/dashboard ────────────────────────────────────────────────────

  if (req.method === 'GET' && pathname === '/api/dashboard') {
    return jsonResponse(req, buildDashboardPayload(auth));
  }

  // ── GET /api/settings ─────────────────────────────────────────────────────

  if (req.method === 'GET' && pathname === '/api/settings') {
    return jsonResponse(req, { settings: getAppSettings() });
  }

  // ── PUT /api/settings ─────────────────────────────────────────────────────

  if (req.method === 'PUT' && pathname === '/api/settings') {
    if (!isAdmin(auth)) return errorResponse(req, 403, 'Solo administradores', 'forbidden');
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

  return null;
}

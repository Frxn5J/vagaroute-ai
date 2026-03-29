import type { AuthContext } from '../middlewares/auth';
import { isAdmin } from '../middlewares/auth';
import { getAllModelStats, getAllProviderStats, getDashboardMetrics } from '../core/db';
import { states } from '../core/pool';
import { normalizeProviderId } from '../core/usageLimits';
import {
  buildScopedModelTelemetry,
  errorResponse,
  jsonResponse,
  resolveRequestMetricsScope,
  type RouteContext,
} from './_shared';

export async function handleModels(
  req: Request,
  auth: AuthContext,
  ctx: RouteContext,
): Promise<Response | null> {
  const { pathname } = ctx;

  // ── GET /v1/models ────────────────────────────────────────────────────────

  if (req.method === 'GET' && pathname === '/v1/models') {
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
      status:
        Math.max(
          state.cooldownUntil,
          providerCooldownMap.get(normalizeProviderId(state.service.name.split('/')[0] ?? ''))?.cooldownUntil ?? 0,
        ) > now
          ? 'cooldown'
          : 'available',
    }));
    return jsonResponse(req, { object: 'list', data: [...virtualModels, ...data] });
  }

  // ── GET /v1/metrics ───────────────────────────────────────────────────────

  if (req.method === 'GET' && pathname === '/v1/metrics') {
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
        .sort((a, b) => b.requests_served - a.requests_served)
        .slice(0, 50)
        .map((item) => ({ id: item.id, provider: item.provider, requests_served: item.requests_served })),
      provider_metrics: dashboard.providers,
      model_metrics: dashboard.models,
      daily_metrics: dashboard.daily,
      request_type_metrics: dashboard.requestTypes,
      summary: dashboard.summary,
    });
  }

  // ── GET /status ───────────────────────────────────────────────────────────

  if (req.method === 'GET' && pathname === '/status') {
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
          ? `cooldown ${Math.ceil((Math.max(state.cooldownUntil, providerCooldownMap.get(normalizeProviderId(state.service.name.split('/')[0] ?? ''))?.cooldownUntil ?? 0) - now) / 1000)}s`
          : 'available',
    }));
    return jsonResponse(req, report);
  }

  return null;
}

// ── Admin: pool reset ─────────────────────────────────────────────────────
// Kept here because it operates on the model pool, not on a specific resource.

export async function handleAdminReset(
  req: Request,
  auth: AuthContext,
  ctx: RouteContext,
): Promise<Response | null> {
  const { pathname } = ctx;
  const { clearAllProviderRateLimits, clearModelRateLimit } = await import('../core/db');
  const { states: poolStates, resetStates } = await import('../core/pool');

  if (req.method === 'POST' && pathname.startsWith('/admin/reset')) {
    if (!isAdmin(auth)) return errorResponse(req, 403, 'Solo administradores', 'forbidden');
    const modelName = decodeURIComponent(
      pathname.replace('/admin/reset/', '').replace('/admin/reset', '').trim(),
    );
    if (resetStates(modelName || undefined)) {
      if (modelName) {
        clearModelRateLimit(modelName);
      } else {
        poolStates.forEach((state) => clearModelRateLimit(state.service.name));
        clearAllProviderRateLimits();
      }
      return jsonResponse(req, { ok: true, reset: modelName || 'all' });
    }
    return errorResponse(req, 404, `Modelo '${modelName}' no encontrado`, 'not_found');
  }

  const adminResetMatch = pathname.match(/^\/api\/admin\/reset(?:\/(.*))?$/);
  if (req.method === 'POST' && adminResetMatch) {
    if (!isAdmin(auth)) return errorResponse(req, 403, 'Solo administradores', 'forbidden');
    const modelName = decodeURIComponent(adminResetMatch[1] ?? '').trim();
    if (resetStates(modelName || undefined)) {
      if (modelName) {
        clearModelRateLimit(modelName);
      } else {
        poolStates.forEach((state) => clearModelRateLimit(state.service.name));
        clearAllProviderRateLimits();
      }
      return jsonResponse(req, { ok: true, reset: modelName || 'all' });
    }
    return errorResponse(req, 404, `Modelo '${modelName}' no encontrado`, 'not_found');
  }

  return null;
}

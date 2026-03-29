import type { AuthContext } from '../../middlewares/auth';
import { isAdmin } from '../../middlewares/auth';
import {
  clearAllProviderRateLimits,
  clearModelRateLimit,
  getDashboardMetrics,
  getAllModelStats,
} from '../../core/db';
import { resetStates, states } from '../../core/pool';
import {
  buildScopedModelTelemetry,
  errorResponse,
  jsonResponse,
  resolveRequestMetricsScope,
  type RouteContext,
} from '../_shared';

export async function handleAdminMetrics(
  req: Request,
  auth: AuthContext,
  ctx: RouteContext,
): Promise<Response | null> {
  const { pathname } = ctx;

  // ── GET /api/metrics/overview ─────────────────────────────────────────────

  if (req.method === 'GET' && pathname === '/api/metrics/overview') {
    const { scope: metricsScope } = resolveRequestMetricsScope(auth);
    const metrics = getDashboardMetrics(metricsScope);
    return jsonResponse(req, {
      metrics,
      modelTelemetry: isAdmin(auth) ? getAllModelStats() : buildScopedModelTelemetry(metrics),
    });
  }

  // ── POST /api/admin/reset[/:modelName] ────────────────────────────────────

  const adminResetMatch = pathname.match(/^\/api\/admin\/reset(?:\/(.*))?$/);
  if (req.method === 'POST' && adminResetMatch) {
    if (!isAdmin(auth)) return errorResponse(req, 403, 'Solo administradores', 'forbidden');
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

  // ── POST /admin/reset (legacy path) ──────────────────────────────────────

  if (req.method === 'POST' && pathname.startsWith('/admin/reset')) {
    if (!isAdmin(auth)) return errorResponse(req, 403, 'Solo administradores', 'forbidden');
    const modelName = decodeURIComponent(
      pathname.replace('/admin/reset/', '').replace('/admin/reset', '').trim(),
    );
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

  return null;
}

import type { AuthContext } from '../../middlewares/auth';
import { isAdmin } from '../../middlewares/auth';
import { listRateLimitRules, upsertRateLimitRule } from '../../core/db';
import { normalizeProviderId, sanitizeLimitRule } from '../../core/usageLimits';
import { errorResponse, jsonResponse, readJsonBody, type RouteContext } from '../_shared';

export async function handleRateLimits(
  req: Request,
  auth: AuthContext,
  ctx: RouteContext,
): Promise<Response | null> {
  const { pathname } = ctx;

  // ── PUT /api/rate-limits/provider/:id ─────────────────────────────────────

  const providerLimitMatch = pathname.match(/^\/api\/rate-limits\/provider\/([^/]+)$/);
  if (req.method === 'PUT' && providerLimitMatch) {
    if (!isAdmin(auth)) return errorResponse(req, 403, 'Solo administradores', 'forbidden');
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
      const saved = upsertRateLimitRule({ scopeType: 'provider', scopeId: providerId, provider: providerId, ...rule });
      return jsonResponse(req, { ok: true, rule: saved });
    } catch (err) {
      const message = (err as { message?: string })?.message ?? 'No se pudo guardar el limite del proveedor';
      return errorResponse(req, 400, message, 'rate_limit_error');
    }
  }

  // ── PUT /api/rate-limits/model ────────────────────────────────────────────

  if (req.method === 'PUT' && pathname === '/api/rate-limits/model') {
    if (!isAdmin(auth)) return errorResponse(req, 403, 'Solo administradores', 'forbidden');
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
      if (!body.modelId?.trim()) return errorResponse(req, 400, 'modelId es obligatorio', 'validation_error');
      const modelId = decodeURIComponent(body.modelId.trim());
      const [provider] = modelId.split('/');
      const rule = sanitizeLimitRule(body);
      const saved = upsertRateLimitRule({ scopeType: 'model', scopeId: modelId, provider, ...rule });
      return jsonResponse(req, { ok: true, rule: saved });
    } catch (err) {
      const message = (err as { message?: string })?.message ?? 'No se pudo guardar el limite del modelo';
      return errorResponse(req, 400, message, 'rate_limit_error');
    }
  }

  // ── GET /api/rate-limits (bonus — lista todas las reglas) ─────────────────

  if (req.method === 'GET' && pathname === '/api/rate-limits') {
    if (!isAdmin(auth)) return errorResponse(req, 403, 'Solo administradores', 'forbidden');
    return jsonResponse(req, {
      providerRules: listRateLimitRules('provider'),
      modelRules: listRateLimitRules('model'),
    });
  }

  return null;
}

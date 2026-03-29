import type { AuthContext } from '../../middlewares/auth';
import { isAdmin } from '../../middlewares/auth';
import {
  deleteModelTierOverride,
  listModelTierOverrides,
  upsertModelTierOverride,
} from '../../core/db';
import { reloadPool, states } from '../../core/pool';
import { errorResponse, jsonResponse, readJsonBody, type RouteContext } from '../_shared';

export async function handleModelTiers(
  req: Request,
  auth: AuthContext,
  ctx: RouteContext,
): Promise<Response | null> {
  const { pathname } = ctx;

  // ── GET /api/model-tiers ──────────────────────────────────────────────────

  if (req.method === 'GET' && pathname === '/api/model-tiers') {
    if (!isAdmin(auth)) return errorResponse(req, 403, 'Solo administradores', 'forbidden');
    return jsonResponse(req, { modelTierOverrides: listModelTierOverrides() });
  }

  // ── PUT /api/model-tiers ──────────────────────────────────────────────────

  if (req.method === 'PUT' && pathname === '/api/model-tiers') {
    if (!isAdmin(auth)) return errorResponse(req, 403, 'Solo administradores', 'forbidden');
    try {
      const body = await readJsonBody<{ modelId: string; tier: number }>(req);
      const modelId = body.modelId?.trim();
      const tier = Number(body.tier);
      if (!modelId) return errorResponse(req, 400, 'modelId es obligatorio', 'validation_error');
      if (![1, 2, 3].includes(tier)) return errorResponse(req, 400, 'tier debe ser 1, 2 o 3', 'validation_error');
      if (!states.some((s) => s.service.name === modelId)) {
        return errorResponse(req, 404, `Modelo '${modelId}' no encontrado en el pool`, 'not_found');
      }
      upsertModelTierOverride(modelId, tier as 1 | 2 | 3);
      await reloadPool('model-tier-override');
      return jsonResponse(req, { ok: true, modelTierOverrides: listModelTierOverrides() });
    } catch (err) {
      const message = (err as { message?: string })?.message ?? 'No se pudo guardar el override de tier';
      return errorResponse(req, 400, message, 'model_tier_error');
    }
  }

  // ── DELETE /api/model-tiers/:modelId ─────────────────────────────────────

  const modelTierMatch = pathname.match(/^\/api\/model-tiers\/(.+)$/);
  if (req.method === 'DELETE' && modelTierMatch) {
    if (!isAdmin(auth)) return errorResponse(req, 403, 'Solo administradores', 'forbidden');
    const modelId = decodeURIComponent(modelTierMatch[1] ?? '').trim();
    const deleted = deleteModelTierOverride(modelId);
    if (!deleted) return errorResponse(req, 404, `No hay override para '${modelId}'`, 'not_found');
    await reloadPool('model-tier-override-removed');
    return jsonResponse(req, { ok: true, modelTierOverrides: listModelTierOverrides() });
  }

  return null;
}

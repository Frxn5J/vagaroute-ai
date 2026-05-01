import type { AuthContext } from '../../middlewares/auth';
import { isAdmin } from '../../middlewares/auth';
import {
  deleteModelCapabilityOverride,
  listModelCapabilityOverrides,
  upsertModelCapabilityOverride,
  type ModelCapabilityOverride
} from '../../core/db';
import { reloadPool, states } from '../../core/pool';
import { errorResponse, jsonResponse, readJsonBody, type RouteContext } from '../_shared';

export async function handleModelCapabilities(
  req: Request,
  auth: AuthContext,
  ctx: RouteContext,
): Promise<Response | null> {
  const { pathname } = ctx;

  if (req.method === 'GET' && pathname === '/api/model-capabilities') {
    if (!isAdmin(auth)) return errorResponse(req, 403, 'Solo administradores', 'forbidden');
    return jsonResponse(req, { overrides: listModelCapabilityOverrides() });
  }

  if (req.method === 'PUT' && pathname === '/api/model-capabilities') {
    if (!isAdmin(auth)) return errorResponse(req, 403, 'Solo administradores', 'forbidden');
    try {
      const body = await readJsonBody<{
        modelId: string;
        supportsTools: boolean | null;
        supportsVision: boolean | null;
        emulateTools: boolean | null;
        supportsImageGeneration: boolean | null;
        supportsVideoGeneration: boolean | null;
      }>(req);
      
      const modelId = body.modelId?.trim();
      if (!modelId) return errorResponse(req, 400, 'modelId es obligatorio', 'validation_error');
      
      if (!states.some((s) => s.service.name === modelId)) {
        return errorResponse(req, 404, `Modelo '${modelId}' no encontrado en el pool`, 'not_found');
      }

      upsertModelCapabilityOverride(modelId, {
        supportsTools: body.supportsTools,
        supportsVision: body.supportsVision,
        emulateTools: body.emulateTools,
        supportsImageGeneration: body.supportsImageGeneration,
        supportsVideoGeneration: body.supportsVideoGeneration,
      });

      await reloadPool('model-capability-override');
      return jsonResponse(req, { ok: true, overrides: listModelCapabilityOverrides() });
    } catch (err) {
      const message = (err as { message?: string })?.message ?? 'No se pudo guardar el override de capacidades';
      return errorResponse(req, 400, message, 'model_capability_error');
    }
  }

  const match = pathname.match(/^\/api\/model-capabilities\/(.+)$/);
  if (req.method === 'DELETE' && match) {
    if (!isAdmin(auth)) return errorResponse(req, 403, 'Solo administradores', 'forbidden');
    const modelId = decodeURIComponent(match[1] ?? '').trim();
    const deleted = deleteModelCapabilityOverride(modelId);
    if (!deleted) return errorResponse(req, 404, `No hay override para '${modelId}'`, 'not_found');
    await reloadPool('model-capability-override-removed');
    return jsonResponse(req, { ok: true, overrides: listModelCapabilityOverrides() });
  }

  return null;
}

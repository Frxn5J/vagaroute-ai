import type { AuthContext } from '../../middlewares/auth';
import { isAdmin } from '../../middlewares/auth';
import {
  getApiKeyById,
  getAppSettings,
  listAllApiKeys,
  listApiKeysForUser,
  listAllProjects,
  listProjectsForUser,
  setApiKeyActive,
  updateApiKeyRateLimit,
} from '../../core/db';
import { createAdditionalApiKey } from '../../middlewares/auth';
import { errorResponse, jsonResponse, readJsonBody, type RouteContext } from '../_shared';

export async function handleApiKeys(
  req: Request,
  auth: AuthContext,
  ctx: RouteContext,
): Promise<Response | null> {
  const { pathname } = ctx;

  // ── GET /api/api-keys ─────────────────────────────────────────────────────

  if (req.method === 'GET' && pathname === '/api/api-keys') {
    const apiKeys = isAdmin(auth) ? listAllApiKeys() : listApiKeysForUser(auth.user.id);
    return jsonResponse(req, { apiKeys });
  }

  // ── POST /api/api-keys ────────────────────────────────────────────────────

  if (req.method === 'POST' && pathname === '/api/api-keys') {
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
      if (selectedProjectId && !visibleProjects.some((p) => p.id === selectedProjectId)) {
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
      return jsonResponse(req, { ok: true, apiKey: result.apiKey, rawApiKey: result.rawApiKey }, 201);
    } catch (err) {
      const message = (err as { message?: string })?.message ?? 'No se pudo generar la API key';
      return errorResponse(req, 400, message, 'api_key_error');
    }
  }

  // ── PATCH /api/api-keys/:id ───────────────────────────────────────────────

  const apiKeyMatch = pathname.match(/^\/api\/api-keys\/([^/]+)$/);
  if (req.method === 'PATCH' && apiKeyMatch) {
    const apiKey = getApiKeyById(apiKeyMatch[1] ?? '');
    if (!apiKey) return errorResponse(req, 404, 'API key no encontrada', 'not_found');
    if (apiKey.userId !== auth.user.id && !isAdmin(auth)) {
      return errorResponse(req, 403, 'No puedes modificar esta API key', 'forbidden');
    }
    try {
      const body = await readJsonBody<{ isActive?: boolean; rateLimitPerMinute?: number }>(req);
      if (typeof body.isActive === 'boolean') setApiKeyActive(apiKey.id, body.isActive);
      if (typeof body.rateLimitPerMinute === 'number' && isAdmin(auth)) {
        updateApiKeyRateLimit(apiKey.id, Math.max(1, Math.floor(body.rateLimitPerMinute)));
      }
      return jsonResponse(req, { ok: true, apiKey: getApiKeyById(apiKey.id) });
    } catch (err) {
      const message = (err as { message?: string })?.message ?? 'No se pudo actualizar la API key';
      return errorResponse(req, 400, message, 'api_key_error');
    }
  }

  return null;
}

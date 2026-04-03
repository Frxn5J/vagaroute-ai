import type { AuthContext } from '../../middlewares/auth';
import { isAdmin } from '../../middlewares/auth';
import { createServiceApiKey, deleteServiceApiKey, updateServiceApiKey } from '../../core/db';
import { listConfiguredProviderKeys } from '../../core/providerKeys';
import { reloadPool } from '../../core/pool';
import { encryptSecret, hashToken, maskSecret, randomToken } from '../../utils/crypto';
import type { ProviderName } from '../../core/providerKeys';
import { errorResponse, jsonResponse, readJsonBody, type RouteContext } from '../_shared';


export async function handleServiceKeys(
  req: Request,
  auth: AuthContext,
  ctx: RouteContext,
): Promise<Response | null> {
  const { pathname } = ctx;

  // ── GET /api/service-keys ─────────────────────────────────────────────────

  if (req.method === 'GET' && pathname === '/api/service-keys') {
    if (!isAdmin(auth)) return errorResponse(req, 403, 'Solo administradores', 'forbidden');
    return jsonResponse(req, { serviceKeys: listConfiguredProviderKeys() });
  }

  // ── POST /api/service-keys ────────────────────────────────────────────────

  if (req.method === 'POST' && pathname === '/api/service-keys') {
    if (!isAdmin(auth)) return errorResponse(req, 403, 'Solo administradores', 'forbidden');
    try {
      const body = await readJsonBody<{ provider: ProviderName; name: string; value: string; priority?: number }>(req);
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

  // ── PATCH /api/service-keys/:id ───────────────────────────────────────────

  const serviceKeyMatch = pathname.match(/^\/api\/service-keys\/([^/]+)$/);
  if (req.method === 'PATCH' && serviceKeyMatch) {
    if (!isAdmin(auth)) return errorResponse(req, 403, 'Solo administradores', 'forbidden');
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

  // ── DELETE /api/service-keys/:id ──────────────────────────────────────────

  if (req.method === 'DELETE' && serviceKeyMatch) {
    if (!isAdmin(auth)) return errorResponse(req, 403, 'Solo administradores', 'forbidden');
    const deleted = deleteServiceApiKey(serviceKeyMatch[1] ?? '');
    if (!deleted) return errorResponse(req, 404, 'Service key no encontrada', 'not_found');
    await reloadPool('service-key-deleted');
    return jsonResponse(req, { ok: true, serviceKeys: listConfiguredProviderKeys() });
  }

  return null;
}

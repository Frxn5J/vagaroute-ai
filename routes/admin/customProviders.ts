import type { AuthContext } from '../../middlewares/auth';
import { isAdmin } from '../../middlewares/auth';
import {
  createCustomProvider,
  deleteCustomProvider,
  discoverCustomProviderModels,
  listCustomProviders,
  updateCustomProvider,
  type CustomModelConfig,
  type CustomProviderProtocol,
} from '../../core/customProviders';
import { reloadPool } from '../../core/pool';
import { randomToken } from '../../utils/crypto';
import { errorResponse, jsonResponse, readJsonBody, type RouteContext } from '../_shared';

export async function handleCustomProviders(
  req: Request,
  auth: AuthContext,
  ctx: RouteContext,
): Promise<Response | null> {
  const { pathname } = ctx;
  const customProviderMatch = pathname.match(/^\/api\/custom-providers\/([^/]+)$/);

  // ── GET /api/custom-providers ─────────────────────────────────────────────

  if (req.method === 'GET' && pathname === '/api/custom-providers') {
    if (!isAdmin(auth)) return errorResponse(req, 403, 'Solo administradores', 'forbidden');
    return jsonResponse(req, { customProviders: listCustomProviders() });
  }

  // ── POST /api/custom-providers ────────────────────────────────────────────

  if (req.method === 'POST' && pathname === '/api/custom-providers') {
    if (!isAdmin(auth)) return errorResponse(req, 403, 'Solo administradores', 'forbidden');
    try {
      const body = await readJsonBody<{
        name: string;
        protocol?: CustomProviderProtocol;
        baseUrl: string;
        apiKey?: string | null;
        models: CustomModelConfig[];
      }>(req);

      if (!body.name?.trim()) return errorResponse(req, 400, 'name es obligatorio', 'validation_error');
      if (!body.baseUrl?.trim()) return errorResponse(req, 400, 'baseUrl es obligatorio', 'validation_error');
      if (!Array.isArray(body.models) || body.models.length === 0) {
        return errorResponse(req, 400, 'models debe ser un array con al menos un modelo', 'validation_error');
      }

      const models: CustomModelConfig[] = body.models
        .map((m) => ({
          id: String(m.id ?? '').trim(),
          supportsTools: m.supportsTools === true,
          supportsVision: m.supportsVision === true,
          inImagePool: m.inImagePool === true,
          inVideoPool: m.inVideoPool === true,
        }))
        .filter((m) => m.id);

      if (models.length === 0) {
        return errorResponse(req, 400, 'Al menos un modelo debe tener un id válido', 'validation_error');
      }

      const record = createCustomProvider({
        id: `cp_${randomToken(10)}`,
        name: body.name,
        protocol: body.protocol,
        baseUrl: body.baseUrl,
        apiKey: body.apiKey ?? null,
        models,
      });
      await reloadPool('custom-provider-created');
      return jsonResponse(req, { ok: true, customProvider: record }, 201);
    } catch (err) {
      const message = (err as { message?: string })?.message ?? 'No se pudo crear el proveedor';
      return errorResponse(req, 400, message, 'custom_provider_error');
    }
  }

  // ── POST /api/custom-providers/discover-models ────────────────────────────

  if (req.method === 'POST' && pathname === '/api/custom-providers/discover-models') {
    if (!isAdmin(auth)) return errorResponse(req, 403, 'Solo administradores', 'forbidden');
    try {
      const body = await readJsonBody<{
        providerId?: string;
        protocol?: CustomProviderProtocol;
        baseUrl?: string;
        apiKey?: string | null;
      }>(req);

      const models = await discoverCustomProviderModels({
        providerId: body.providerId,
        protocol: body.protocol,
        baseUrl: body.baseUrl,
        apiKey: body.apiKey,
      });

      return jsonResponse(req, { ok: true, models });
    } catch (err) {
      const message = (err as { message?: string })?.message ?? 'No se pudieron descubrir modelos del proveedor';
      return errorResponse(req, 400, message, 'custom_provider_error');
    }
  }

  // ── PATCH /api/custom-providers/:id ──────────────────────────────────────

  if (req.method === 'PATCH' && customProviderMatch) {
    if (!isAdmin(auth)) return errorResponse(req, 403, 'Solo administradores', 'forbidden');
    try {
      const body = await readJsonBody<{
        name?: string;
        protocol?: CustomProviderProtocol;
        baseUrl?: string;
        apiKey?: string | null;
        models?: CustomModelConfig[];
        isActive?: boolean;
      }>(req);

      const models: CustomModelConfig[] | undefined = Array.isArray(body.models)
        ? body.models
            .map((m) => ({
              id: String(m.id ?? '').trim(),
              supportsTools: m.supportsTools === true,
              supportsVision: m.supportsVision === true,
              inImagePool: m.inImagePool === true,
              inVideoPool: m.inVideoPool === true,
            }))
            .filter((m) => m.id)
        : undefined;

      const updated = updateCustomProvider(customProviderMatch[1] ?? '', {
        name: body.name,
        protocol: body.protocol,
        baseUrl: body.baseUrl,
        apiKey: body.apiKey,
        models,
        isActive: body.isActive,
      });
      await reloadPool('custom-provider-updated');
      return jsonResponse(req, { ok: true, customProvider: updated });
    } catch (err) {
      const message = (err as { message?: string })?.message ?? 'No se pudo actualizar el proveedor';
      return errorResponse(req, 400, message, 'custom_provider_error');
    }
  }

  // ── DELETE /api/custom-providers/:id ─────────────────────────────────────

  if (req.method === 'DELETE' && customProviderMatch) {
    if (!isAdmin(auth)) return errorResponse(req, 403, 'Solo administradores', 'forbidden');
    const deleted = deleteCustomProvider(customProviderMatch[1] ?? '');
    if (!deleted) return errorResponse(req, 404, 'Proveedor no encontrado', 'not_found');
    await reloadPool('custom-provider-deleted');
    return jsonResponse(req, { ok: true });
  }

  return null;
}

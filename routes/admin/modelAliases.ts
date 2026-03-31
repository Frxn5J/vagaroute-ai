import type { AuthContext } from '../../middlewares/auth';
import { isAdmin } from '../../middlewares/auth';
import {
  deleteModelAlias,
  listModelAliases,
  upsertModelAlias,
  type ModelAliasCategory,
} from '../../core/db';
import {
  getModelAliasCategories,
  isValidAliasTarget,
  MODEL_ALIAS_CATEGORIES,
} from '../../core/modelAliases';
import {
  errorResponse,
  jsonResponse,
  readJsonBody,
  type RouteContext,
} from '../_shared';

// ─── Route handlers ─────────────────────────────────────────────────────────

export async function handleModelAliases(
  req: Request,
  auth: AuthContext,
  ctx: RouteContext,
): Promise<Response | null> {
  const { pathname } = ctx;

  // ── GET /api/model-aliases ─────────────────────────────────────────────────

  if (req.method === 'GET' && pathname === '/api/model-aliases') {
    if (!isAdmin(auth)) {
      return errorResponse(req, 403, 'Solo administradores', 'forbidden');
    }
    return jsonResponse(req, { modelAliases: listModelAliases() });
  }

  // ── GET /api/model-aliases/categories ─────────────────────────────────────

  if (req.method === 'GET' && pathname === '/api/model-aliases/categories') {
    if (!isAdmin(auth)) {
      return errorResponse(req, 403, 'Solo administradores', 'forbidden');
    }
    return jsonResponse(req, { categories: getModelAliasCategories() });
  }

  // ── POST /api/model-aliases ────────────────────────────────────────────────

  if (req.method === 'POST' && pathname === '/api/model-aliases') {
    if (!isAdmin(auth)) {
      return errorResponse(req, 403, 'Solo administradores', 'forbidden');
    }
    try {
      const body = await readJsonBody<{
        alias: string;
        targetModel: string;
        category?: string;
      }>(req);

      if (!body.alias || typeof body.alias !== 'string') {
        return errorResponse(req, 400, 'El campo "alias" es requerido', 'invalid_request_error');
      }
      if (!body.targetModel || typeof body.targetModel !== 'string') {
        return errorResponse(req, 400, 'El campo "targetModel" es requerido', 'invalid_request_error');
      }

      const alias = body.alias.trim().toLowerCase();
      const targetModel = body.targetModel.trim();
      const category = (body.category as ModelAliasCategory) || 'chat';

      // Validate category
      if (!MODEL_ALIAS_CATEGORIES.includes(category)) {
        return errorResponse(req, 400, `Categoría inválida. Debe ser una de: ${MODEL_ALIAS_CATEGORIES.join(', ')}`, 'invalid_request_error');
      }

      // Validate target based on category
      if (!isValidAliasTarget(targetModel, category)) {
        if (category === 'chat') {
          return errorResponse(req, 400, 'El modelo target no existe en el pool actual', 'invalid_request_error');
        }
        return errorResponse(req, 400, `El modelo target "${targetModel}" no es válido para la categoría "${category}"`, 'invalid_request_error');
      }

      // Validate that alias is not a reserved virtual model
      if (['auto', 'img', 'tools'].includes(alias)) {
        return errorResponse(
          req,
          400,
          'No se puede crear un alias con el mismo nombre que un modelo virtual (auto, img, tools)',
          'invalid_request_error',
        );
      }

      const created = upsertModelAlias(alias, targetModel, category);
      return jsonResponse(req, { ok: true, modelAlias: created });
    } catch (err) {
      const message = (err as { message?: string })?.message ?? 'No se pudo crear el alias';
      return errorResponse(req, 400, message, 'alias_error');
    }
  }

  // ── DELETE /api/model-aliases/:alias ─────────────────────────────────────

  const aliasMatch = pathname.match(/^\/api\/model-aliases\/(.+)$/);
  if (req.method === 'DELETE' && aliasMatch) {
    if (!isAdmin(auth)) {
      return errorResponse(req, 403, 'Solo administradores', 'forbidden');
    }

    const alias = decodeURIComponent(aliasMatch[1] ?? '').trim().toLowerCase();
    const categoryParam = new URL(req.url).searchParams.get('category');
    const category = ((categoryParam || 'chat').trim() as ModelAliasCategory);
    if (!alias) {
      return errorResponse(req, 400, 'Alias no valido', 'invalid_request_error');
    }
    if (!MODEL_ALIAS_CATEGORIES.includes(category)) {
      return errorResponse(req, 400, 'Categoría no válida', 'invalid_request_error');
    }

    const deleted = deleteModelAlias(alias, category);
    if (!deleted) {
      return errorResponse(req, 404, 'Alias no encontrado', 'not_found');
    }

    return jsonResponse(req, { ok: true });
  }

  return null;
}

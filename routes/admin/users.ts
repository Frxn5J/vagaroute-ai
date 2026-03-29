import type { AuthContext } from '../../middlewares/auth';
import { isAdmin } from '../../middlewares/auth';
import {
  getUserById,
  listUsers,
  setUserActive,
  updateUserProductSettings,
} from '../../core/db';
import { requestPasswordReset } from '../../middlewares/auth';
import { errorResponse, jsonResponse, readJsonBody, type RouteContext } from '../_shared';

export async function handleUsers(
  req: Request,
  auth: AuthContext,
  ctx: RouteContext,
): Promise<Response | null> {
  const { pathname } = ctx;

  // ── GET /api/users ────────────────────────────────────────────────────────

  if (req.method === 'GET' && pathname === '/api/users') {
    if (!isAdmin(auth)) return errorResponse(req, 403, 'Solo administradores', 'forbidden');
    return jsonResponse(req, { users: listUsers() });
  }

  // ── POST /api/users ───────────────────────────────────────────────────────

  if (req.method === 'POST' && pathname === '/api/users') {
    if (!isAdmin(auth)) return errorResponse(req, 403, 'Solo administradores', 'forbidden');
    try {
      const { createUserWithDefaultKey } = await import('../../middlewares/auth');
      const body = await readJsonBody<{
        name: string;
        email: string;
        password: string;
        projectId?: string | null;
        monthlyRequestQuota?: number | null;
        monthlyBudgetUsd?: number | null;
      }>(req);
      const result = await createUserWithDefaultKey(body);
      return jsonResponse(req, { ok: true, user: result.user, apiKey: result.defaultApiKey, rawApiKey: result.rawApiKey }, 201);
    } catch (err) {
      const message = (err as { message?: string })?.message ?? 'No se pudo crear el usuario';
      return errorResponse(req, 400, message, 'user_error');
    }
  }

  // ── PATCH /api/users/:id ──────────────────────────────────────────────────

  const userMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
  if (req.method === 'PATCH' && userMatch) {
    if (!isAdmin(auth)) return errorResponse(req, 403, 'Solo administradores', 'forbidden');
    const user = getUserById(userMatch[1] ?? '');
    if (!user) return errorResponse(req, 404, 'Usuario no encontrado', 'not_found');
    try {
      const body = await readJsonBody<{
        isActive?: boolean;
        monthlyRequestQuota?: number | null;
        monthlyBudgetUsd?: number | null;
        onboardingCompletedAt?: number | null;
      }>(req);
      if (typeof body.isActive === 'boolean') setUserActive(user.id, body.isActive);
      if (
        body.monthlyRequestQuota !== undefined ||
        body.monthlyBudgetUsd !== undefined ||
        body.onboardingCompletedAt !== undefined
      ) {
        updateUserProductSettings(user.id, {
          monthlyRequestQuota: body.monthlyRequestQuota,
          monthlyBudgetUsd: body.monthlyBudgetUsd,
          onboardingCompletedAt: body.onboardingCompletedAt,
        });
      }
      return jsonResponse(req, { ok: true, user: getUserById(user.id) });
    } catch (err) {
      const message = (err as { message?: string })?.message ?? 'No se pudo actualizar el usuario';
      return errorResponse(req, 400, message, 'user_error');
    }
  }

  // ── POST /api/users/:id/password-reset ────────────────────────────────────

  const userResetMatch = pathname.match(/^\/api\/users\/([^/]+)\/password-reset$/);
  if (req.method === 'POST' && userResetMatch) {
    if (!isAdmin(auth)) return errorResponse(req, 403, 'Solo administradores', 'forbidden');
    const user = getUserById(userResetMatch[1] ?? '');
    if (!user) return errorResponse(req, 404, 'Usuario no encontrado', 'not_found');
    const result = await requestPasswordReset({ email: user.email, requestedByUserId: auth.user.id });
    return jsonResponse(req, {
      ok: true,
      resetUrl: result ? `${new URL(req.url).origin}/?reset=${encodeURIComponent(result.rawToken)}` : null,
    });
  }

  return null;
}

import {
  getInvitationTokenByHash,
} from '../core/db';
import { appConfig } from '../core/config';
import {
  bootstrapAdmin,
  buildSessionCookie,
  clearSessionCookie,
  acceptInvitation,
  loginWithPassword,
  logoutRequest,
  needsBootstrap,
  requestPasswordReset,
  resetPasswordWithToken,
} from '../middlewares/auth';
import { hashToken } from '../utils/crypto';
import { errorResponse, jsonResponse, readJsonBody, type RouteContext } from './_shared';

// Pre-auth public routes — these run BEFORE the auth check in the dispatcher.
// Return Response to short-circuit; return null to let routing continue.
export async function handlePreAuthRoutes(
  req: Request,
  ctx: RouteContext,
  applyAnonRateLimit: () => Response | null,
): Promise<Response | null> {
  const { pathname } = ctx;

  // ── Bootstrap ────────────────────────────────────────────────────────────

  if (req.method === 'GET' && pathname === '/api/bootstrap/status') {
    return jsonResponse(req, { needsSetup: needsBootstrap() });
  }

  if (req.method === 'POST' && pathname === '/api/bootstrap') {
    const limited = applyAnonRateLimit();
    if (limited) return limited;

    try {
      const body = await readJsonBody<{ name: string; email: string; password: string }>(req);
      const result = await bootstrapAdmin({ name: body.name, email: body.email, password: body.password, req });
      return jsonResponse(
        req,
        { ok: true, user: result.user, apiKey: result.defaultApiKey, rawApiKey: result.rawApiKey },
        201,
        { 'Set-Cookie': buildSessionCookie(result.sessionToken, result.expiresAt, req) },
      );
    } catch (err) {
      const message = (err as { message?: string })?.message ?? 'Bootstrap failed';
      return errorResponse(req, 400, message, 'bootstrap_error');
    }
  }

  // ── Invitations ───────────────────────────────────────────────────────────

  const invitationMatch = pathname.match(/^\/api\/invitations\/([^/]+)$/);
  if (req.method === 'GET' && invitationMatch) {
    const token = decodeURIComponent(invitationMatch[1] ?? '').trim();
    if (!token) return errorResponse(req, 400, 'Token de invitacion invalido', 'validation_error');
    const invitation = getInvitationTokenByHash(hashToken(token));
    if (!invitation) return errorResponse(req, 404, 'La invitacion no existe o expiro', 'not_found');
    return jsonResponse(req, { invitation });
  }

  if (req.method === 'POST' && pathname === '/api/invitations/accept') {
    try {
      const body = await readJsonBody<{ token: string; email?: string | null; name: string; password: string }>(req);
      const result = await acceptInvitation({ token: body.token, email: body.email, name: body.name, password: body.password, req });
      return jsonResponse(
        req,
        { ok: true, user: result.user, apiKey: result.apiKey, rawApiKey: result.rawApiKey },
        201,
        { 'Set-Cookie': buildSessionCookie(result.sessionToken, result.expiresAt, req) },
      );
    } catch (err) {
      const message = (err as { message?: string })?.message ?? 'No se pudo aceptar la invitacion';
      return errorResponse(req, 400, message, 'invitation_error');
    }
  }

  // ── Password reset ────────────────────────────────────────────────────────

  if (req.method === 'POST' && pathname === '/api/auth/password-reset/request') {
    try {
      const body = await readJsonBody<{ email: string }>(req);
      const result = await requestPasswordReset({ email: body.email });
      const resetUrl = result
        ? `${new URL(req.url).origin}/?reset=${encodeURIComponent(result.rawToken)}`
        : null;
      return jsonResponse(req, { ok: true, resetUrl: appConfig.isProduction ? null : resetUrl });
    } catch (err) {
      const message = (err as { message?: string })?.message ?? 'No se pudo generar el reset';
      return errorResponse(req, 400, message, 'reset_error');
    }
  }

  if (
    req.method === 'POST' &&
    (pathname === '/api/auth/password-reset/confirm' || pathname === '/api/auth/reset-password')
  ) {
    try {
      const body = await readJsonBody<{ token: string; password: string }>(req);
      await resetPasswordWithToken({ token: body.token, password: body.password });
      return jsonResponse(req, { ok: true });
    } catch (err) {
      const message = (err as { message?: string })?.message ?? 'No se pudo actualizar la contrasena';
      return errorResponse(req, 400, message, 'reset_error');
    }
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  if (req.method === 'POST' && (pathname === '/api/auth/login' || pathname === '/api/login')) {
    const limited = applyAnonRateLimit();
    if (limited) return limited;

    try {
      const body = await readJsonBody<{ email: string; password: string }>(req);
      const result = await loginWithPassword({ email: body.email, password: body.password, req });
      return jsonResponse(
        req,
        { ok: true, user: result.user },
        200,
        { 'Set-Cookie': buildSessionCookie(result.sessionToken, result.expiresAt, req) },
      );
    } catch (err) {
      const message = (err as { message?: string })?.message ?? 'Login failed';
      return errorResponse(req, 401, message, 'auth_error');
    }
  }

  if (req.method === 'POST' && pathname === '/api/auth/logout') {
    logoutRequest(req);
    return jsonResponse(req, { ok: true }, 200, { 'Set-Cookie': clearSessionCookie(req) });
  }

  return null;
}

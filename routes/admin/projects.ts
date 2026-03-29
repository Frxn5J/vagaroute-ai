import type { AuthContext } from '../../middlewares/auth';
import { isAdmin } from '../../middlewares/auth';
import {
  createInvitationToken,
  createProject,
  getProjectById,
  listAllProjects,
  listProjectsForUser,
  updateProject,
} from '../../core/db';
import { hashToken, randomToken } from '../../utils/crypto';
import { errorResponse, jsonResponse, readJsonBody, type RouteContext } from '../_shared';

export async function handleProjects(
  req: Request,
  auth: AuthContext,
  ctx: RouteContext,
): Promise<Response | null> {
  const { pathname } = ctx;

  // ── GET /api/projects ─────────────────────────────────────────────────────

  if (req.method === 'GET' && pathname === '/api/projects') {
    return jsonResponse(req, {
      projects: isAdmin(auth) ? listAllProjects() : listProjectsForUser(auth.user.id),
    });
  }

  // ── POST /api/projects ────────────────────────────────────────────────────

  if (req.method === 'POST' && pathname === '/api/projects') {
    if (!isAdmin(auth)) return errorResponse(req, 403, 'Solo administradores', 'forbidden');
    try {
      const body = await readJsonBody<{
        name: string;
        description?: string | null;
        budgetMonthlyUsd?: number | null;
        requestQuotaMonthly?: number | null;
      }>(req);
      const project = createProject({
        id: `prj_${randomToken(10)}`,
        name: body.name,
        description: body.description,
        budgetMonthlyUsd: body.budgetMonthlyUsd,
        requestQuotaMonthly: body.requestQuotaMonthly,
        ownerUserId: auth.user.id,
      });
      return jsonResponse(req, { ok: true, project }, 201);
    } catch (err) {
      const message = (err as { message?: string })?.message ?? 'No se pudo crear el proyecto';
      return errorResponse(req, 400, message, 'project_error');
    }
  }

  // ── PATCH /api/projects/:id ───────────────────────────────────────────────

  const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (req.method === 'PATCH' && projectMatch) {
    if (!isAdmin(auth)) return errorResponse(req, 403, 'Solo administradores', 'forbidden');
    const projectId = projectMatch[1] ?? '';
    if (!getProjectById(projectId)) return errorResponse(req, 404, 'Proyecto no encontrado', 'not_found');
    try {
      const body = await readJsonBody<{
        name?: string;
        description?: string | null;
        budgetMonthlyUsd?: number | null;
        requestQuotaMonthly?: number | null;
        isActive?: boolean;
      }>(req);
      const project = updateProject(projectId, body);
      return jsonResponse(req, { ok: true, project });
    } catch (err) {
      const message = (err as { message?: string })?.message ?? 'No se pudo actualizar el proyecto';
      return errorResponse(req, 400, message, 'project_error');
    }
  }

  // ── POST /api/invitations ─────────────────────────────────────────────────

  if (req.method === 'POST' && pathname === '/api/invitations') {
    if (!isAdmin(auth)) return errorResponse(req, 403, 'Solo administradores', 'forbidden');
    try {
      const body = await readJsonBody<{
        email?: string | null;
        projectId?: string | null;
        role?: 'owner' | 'member';
        expiresHours?: number;
      }>(req);
      const rawToken = randomToken(32);
      const invitation = createInvitationToken({
        id: `inv_${randomToken(10)}`,
        email: body.email ?? null,
        projectId: body.projectId ?? null,
        role: body.role ?? 'member',
        tokenHash: hashToken(rawToken),
        expiresAt: Date.now() + Math.max(1, Math.floor(body.expiresHours ?? 72)) * 60 * 60_000,
        createdByUserId: auth.user.id,
      });
      return jsonResponse(req, {
        ok: true,
        invitation,
        inviteUrl: `${new URL(req.url).origin}/?invite=${encodeURIComponent(rawToken)}`,
      }, 201);
    } catch (err) {
      const message = (err as { message?: string })?.message ?? 'No se pudo crear la invitacion';
      return errorResponse(req, 400, message, 'invitation_error');
    }
  }

  return null;
}

import {
  addUserToProject,
  countUsers,
  createPasswordResetToken,
  createProject,
  createSession,
  createUser,
  createUserApiKey,
  deleteSessionByTokenHash,
  getApiKeyAuthByHash,
  getAppSettings,
  getInvitationTokenByHash,
  getPasswordResetTokenByHash,
  getSessionByTokenHash,
  getUserByEmail,
  markInvitationTokenAccepted,
  markPasswordResetTokenUsed,
  touchApiKey,
  touchSession,
  type SessionRecord,
  type UserApiKeyRecord,
  type UserRecord,
  updateUserPassword,
  updateUserProductSettings,
  updateUserLastLogin,
  updateUserLastSeen,
} from '../core/db';
import { generateApiKey, hashToken, randomToken } from '../utils/crypto';

const MASTER_API_SECRET = process.env.API_SECRET?.trim();
export const SESSION_COOKIE_NAME = 'router_session';

export interface AuthContext {
  user: UserRecord;
  via: 'session' | 'api_key' | 'master';
  session?: SessionRecord;
  apiKey?: UserApiKeyRecord;
}

function parseCookies(req: Request): Map<string, string> {
  const cookieHeader = req.headers.get('cookie') ?? '';
  const cookies = new Map<string, string>();

  for (const chunk of cookieHeader.split(';')) {
    const [rawName, ...rest] = chunk.split('=');
    const name = rawName?.trim();
    if (!name || rest.length === 0) {
      continue;
    }
    cookies.set(name, decodeURIComponent(rest.join('=').trim()));
  }

  return cookies;
}

function getSessionTokenFromRequest(req: Request): string | null {
  return parseCookies(req).get(SESSION_COOKIE_NAME) ?? null;
}

export function getBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) {
    return null;
  }
  return header.slice('Bearer '.length).trim() || null;
}

function makeId(prefix: string): string {
  return `${prefix}_${randomToken(12)}`;
}

function validateIdentityFields(name: string, email: string, password: string): void {
  if (!name.trim()) {
    throw new Error('El nombre es obligatorio');
  }
  if (!email.trim() || !email.includes('@')) {
    throw new Error('Ingresa un correo valido');
  }
  if (password.length < 8) {
    throw new Error('La contrasena debe tener al menos 8 caracteres');
  }
}

function createSessionCookieValue(token: string, expiresAt: number, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function buildSessionCookie(token: string, expiresAt: number, req: Request): string {
  return createSessionCookieValue(token, expiresAt, new URL(req.url).protocol === 'https:');
}

export function clearSessionCookie(req: Request): string {
  return createSessionCookieValue('', 0, new URL(req.url).protocol === 'https:');
}

async function createManagedApiKey(userId: string, name: string, rateLimitPerMinute: number, projectId?: string | null) {
  const rawKey = generateApiKey('router');
  const record = createUserApiKey({
    id: makeId('uak'),
    userId,
    projectId,
    name,
    keyHash: hashToken(rawKey),
    keyPrefix: rawKey.slice(0, 16),
    rateLimitPerMinute,
  });

  return { record, rawKey };
}

async function createManagedSession(userId: string, req: Request) {
  const settings = getAppSettings();
  const sessionToken = randomToken(32);
  const expiresAt = Date.now() + settings.sessionTimeoutMinutes * 60_000;
  const session = createSession({
    id: makeId('sess'),
    userId,
    tokenHash: hashToken(sessionToken),
    expiresAt,
    ip: req.headers.get('x-forwarded-for') ?? null,
    userAgent: req.headers.get('user-agent'),
  });

  return { session, sessionToken, expiresAt };
}

export function needsBootstrap(): boolean {
  return countUsers() === 0;
}

export async function bootstrapAdmin(input: {
  name: string;
  email: string;
  password: string;
  req: Request;
}) {
  if (!needsBootstrap()) {
    throw new Error('El sistema ya fue inicializado');
  }

  validateIdentityFields(input.name, input.email, input.password);
  const passwordHash = await Bun.password.hash(input.password);
  const user = createUser({
    id: makeId('usr'),
    email: input.email,
    name: input.name,
    passwordHash,
    role: 'admin',
  });

  const settings = getAppSettings();
  const defaultProject = createProject({
    id: makeId('prj'),
    name: 'Proyecto principal',
    description: 'Proyecto creado durante el onboarding inicial.',
    ownerUserId: user.id,
  });
  const defaultApiKey = await createManagedApiKey(
    user.id,
    'Default Key',
    settings.defaultApiKeyRateLimit,
    defaultProject.id,
  );
  const sessionData = await createManagedSession(user.id, input.req);
  updateUserLastLogin(user.id);

  return {
    user,
    defaultApiKey: defaultApiKey.record,
    rawApiKey: defaultApiKey.rawKey,
    session: sessionData.session,
    sessionToken: sessionData.sessionToken,
    expiresAt: sessionData.expiresAt,
  };
}

export async function loginWithPassword(input: {
  email: string;
  password: string;
  req: Request;
}) {
  const user = getUserByEmail(input.email);
  if (!user || !user.isActive) {
    throw new Error('Credenciales invalidas');
  }

  const isValid = await Bun.password.verify(input.password, user.passwordHash);
  if (!isValid) {
    throw new Error('Credenciales invalidas');
  }

  const sessionData = await createManagedSession(user.id, input.req);
  updateUserLastLogin(user.id);

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLoginAt: user.lastLoginAt,
      lastSeenAt: user.lastSeenAt,
    },
    session: sessionData.session,
    sessionToken: sessionData.sessionToken,
    expiresAt: sessionData.expiresAt,
  };
}

export async function createUserWithDefaultKey(input: {
  name: string;
  email: string;
  password: string;
  projectId?: string | null;
  projectRole?: 'owner' | 'member';
  monthlyRequestQuota?: number | null;
  monthlyBudgetUsd?: number | null;
}) {
  validateIdentityFields(input.name, input.email, input.password);
  const passwordHash = await Bun.password.hash(input.password);
  const user = createUser({
    id: makeId('usr'),
    email: input.email,
    name: input.name,
    passwordHash,
    role: 'user',
  });

  updateUserProductSettings(user.id, {
    monthlyRequestQuota: input.monthlyRequestQuota ?? null,
    monthlyBudgetUsd: input.monthlyBudgetUsd ?? null,
  });

  const settings = getAppSettings();
  if (input.projectId) {
    addUserToProject(input.projectId, user.id, input.projectRole ?? 'member');
  }
  const defaultApiKey = await createManagedApiKey(
    user.id,
    'Default Key',
    settings.defaultApiKeyRateLimit,
    input.projectId ?? null,
  );

  return {
    user: {
      ...user,
      monthlyRequestQuota: input.monthlyRequestQuota ?? null,
      monthlyBudgetUsd: input.monthlyBudgetUsd ?? null,
    },
    defaultApiKey: defaultApiKey.record,
    rawApiKey: defaultApiKey.rawKey,
  };
}

export async function createAdditionalApiKey(input: {
  userId: string;
  name: string;
  rateLimitPerMinute?: number;
  projectId?: string | null;
}) {
  const settings = getAppSettings();
  const apiKey = await createManagedApiKey(
    input.userId,
    input.name,
    input.rateLimitPerMinute ?? settings.defaultApiKeyRateLimit,
    input.projectId ?? null,
  );

  return {
    apiKey: apiKey.record,
    rawApiKey: apiKey.rawKey,
  };
}

export async function acceptInvitation(input: {
  token: string;
  email?: string | null;
  name: string;
  password: string;
  req: Request;
}) {
  const invitation = getInvitationTokenByHash(hashToken(input.token));
  if (!invitation) {
    throw new Error('La invitacion no existe o expiro');
  }

  const email = invitation.email?.trim() || input.email?.trim().toLowerCase() || null;
  if (!email) {
    throw new Error('El correo es obligatorio para activar la invitacion');
  }

  if (getUserByEmail(email)) {
    throw new Error('Ya existe un usuario con este correo');
  }

  const created = await createUserWithDefaultKey({
    name: input.name,
    email,
    password: input.password,
    projectId: invitation.projectId,
    projectRole: invitation.role,
  });
  const sessionData = await createManagedSession(created.user.id, input.req);
  updateUserLastLogin(created.user.id);
  markInvitationTokenAccepted(invitation.id);

  return {
    user: created.user,
    apiKey: created.defaultApiKey,
    rawApiKey: created.rawApiKey,
    sessionToken: sessionData.sessionToken,
    expiresAt: sessionData.expiresAt,
  };
}

export async function requestPasswordReset(input: {
  email: string;
  requestedByUserId?: string | null;
}) {
  const user = getUserByEmail(input.email);
  if (!user) {
    return null;
  }

  const rawToken = randomToken(32);
  createPasswordResetToken({
    id: makeId('rst'),
    userId: user.id,
    tokenHash: hashToken(rawToken),
    expiresAt: Date.now() + 60 * 60_000,
    requestedByUserId: input.requestedByUserId ?? null,
  });

  return {
    user,
    rawToken,
  };
}

export async function resetPasswordWithToken(input: {
  token: string;
  password: string;
}) {
  if (input.password.length < 8) {
    throw new Error('La contrasena debe tener al menos 8 caracteres');
  }

  const tokenRecord = getPasswordResetTokenByHash(hashToken(input.token));
  if (!tokenRecord) {
    throw new Error('El link de recuperacion no existe o expiro');
  }

  const passwordHash = await Bun.password.hash(input.password);
  updateUserPassword(tokenRecord.user_id, passwordHash);
  markPasswordResetTokenUsed(tokenRecord.id);
}

export function logoutRequest(req: Request): void {
  const sessionToken = getSessionTokenFromRequest(req);
  if (!sessionToken) {
    return;
  }
  deleteSessionByTokenHash(hashToken(sessionToken));
}

export function isAdmin(ctx: AuthContext | null): boolean {
  return ctx?.user.role === 'admin';
}

export async function authenticateRequest(req: Request): Promise<AuthContext | null> {
  const sessionToken = getSessionTokenFromRequest(req);
  if (sessionToken) {
    const sessionWithUser = getSessionByTokenHash(hashToken(sessionToken));
    if (sessionWithUser?.user.isActive) {
      touchSession(sessionWithUser.session.id);
      updateUserLastSeen(sessionWithUser.user.id);
      return {
        user: sessionWithUser.user,
        via: 'session',
        session: sessionWithUser.session,
      };
    }
  }

  const bearerToken = getBearerToken(req);
  if (!bearerToken) {
    return null;
  }

  if (MASTER_API_SECRET && bearerToken === MASTER_API_SECRET) {
    return {
      via: 'master',
      user: {
        id: 'system',
        email: 'system@local',
        name: 'System Token',
        role: 'admin',
        isActive: true,
        createdAt: 0,
        updatedAt: 0,
        lastLoginAt: null,
        lastSeenAt: null,
      },
    };
  }

  const authRecord = getApiKeyAuthByHash(hashToken(bearerToken));
  if (!authRecord || !authRecord.user.isActive || !authRecord.apiKey.isActive) {
    return null;
  }

  touchApiKey(authRecord.apiKey.id);
  updateUserLastSeen(authRecord.user.id);

  return {
    user: authRecord.user,
    via: 'api_key',
    apiKey: authRecord.apiKey,
  };
}

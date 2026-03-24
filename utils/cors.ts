import { getAppSettings } from '../core/db';

interface CorsDecision {
  allowed: boolean;
  requestOrigin: string | null;
  responseOrigin: string | null;
  allowCredentials: boolean;
  varyOrigin: boolean;
}

function getAllowedOrigins(): string[] {
  const settings = getAppSettings();
  return settings.allowedOrigins
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function resolveCorsDecision(req: Request | null): CorsDecision {
  const allowedOrigins = getAllowedOrigins();
  const requestOrigin = req?.headers.get('origin')?.trim() || null;

  if (allowedOrigins.includes('*')) {
    return {
      allowed: true,
      requestOrigin,
      responseOrigin: '*',
      allowCredentials: false,
      varyOrigin: false,
    };
  }

  if (!requestOrigin) {
    return {
      allowed: true,
      requestOrigin: null,
      responseOrigin: null,
      allowCredentials: false,
      varyOrigin: true,
    };
  }

  if (allowedOrigins.includes(requestOrigin)) {
    return {
      allowed: true,
      requestOrigin,
      responseOrigin: requestOrigin,
      allowCredentials: true,
      varyOrigin: true,
    };
  }

  return {
    allowed: false,
    requestOrigin,
    responseOrigin: null,
    allowCredentials: false,
    varyOrigin: true,
  };
}

export function getCorsRejectionResponse(req: Request): Response | null {
  const decision = resolveCorsDecision(req);
  if (decision.allowed) {
    return null;
  }

  return new Response(JSON.stringify({
    error: {
      message: 'Origin not allowed',
      type: 'cors_error',
    },
  }), {
    status: 403,
    headers: {
      'Content-Type': 'application/json',
      Vary: 'Origin',
    },
  });
}

export function withCors(
  reqOrHeaders?: Request | Record<string, string> | null,
  maybeHeaders?: Record<string, string>,
): Record<string, string> {
  const req = reqOrHeaders instanceof Request ? reqOrHeaders : null;
  const headers = (reqOrHeaders instanceof Request ? maybeHeaders : reqOrHeaders) ?? {};
  const decision = resolveCorsDecision(req);

  const base: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-Id',
    'Access-Control-Expose-Headers': 'X-Request-Id, X-Service, Retry-After',
  };

  if (decision.responseOrigin) {
    base['Access-Control-Allow-Origin'] = decision.responseOrigin;
  }

  if (decision.allowCredentials) {
    base['Access-Control-Allow-Credentials'] = 'true';
  }

  if (decision.varyOrigin) {
    base.Vary = 'Origin';
  }

  return { ...base, ...headers };
}

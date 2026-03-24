export interface RequestContextValue {
  requestId: string;
  ip: string;
  startedAt: number;
}

const requestContext = new WeakMap<Request, RequestContextValue>();

export function bindRequestContext(req: Request, value: RequestContextValue): void {
  requestContext.set(req, value);
}

export function getRequestContext(req: Request): RequestContextValue | undefined {
  return requestContext.get(req);
}

export function getRequestId(req: Request): string {
  return getRequestContext(req)?.requestId
    ?? req.headers.get('x-request-id')?.trim()
    ?? crypto.randomUUID();
}

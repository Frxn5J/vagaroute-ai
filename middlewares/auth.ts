const API_SECRET = process.env.API_SECRET;

export function isAuthorized(req: Request): boolean {
  if (!API_SECRET) return true; // auth disabled si no hay var de entorno
  const header = req.headers.get('Authorization') ?? '';
  return header === `Bearer ${API_SECRET}`;
}

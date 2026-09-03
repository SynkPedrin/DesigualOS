/**
 * Cabeçalho "Authorization: Bearer <token>" -> só o token. Usado tanto pra
 * autenticar usuário (JWT do Supabase) quanto node (NODE_SECRET) — mesma
 * extração, credenciais diferentes; existia duplicada em apps/api/src/auth
 * /middleware.ts e apps/api/src/nodes/auth.ts.
 */
export function extractBearerToken(header: string | undefined): string | undefined {
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
}

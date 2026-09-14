import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { extractBearerToken, hasPermission, loadUserAccess, resolveOrProvisionUser, verifySupabaseToken } from '@desigual-os/auth';
import { db, schema } from '@desigual-os/database';
import { createLogger } from '@desigual-os/logging';
import type { RoleName } from '@desigual-os/types';

const logger = createLogger({ service: 'orchestrator-api' });

// Presença leve: users.last_seen_at é tocado aqui (cobrindo qualquer rota
// autenticada, POST /messages incluso), mas no máximo 1x por minuto por
// usuário — o UPDATE condicional abaixo é o throttle, sem query extra por
// request. Fire-and-forget: nunca bloqueia a resposta.
const LAST_SEEN_THROTTLE_MS = 60_000;

/**
 * O UPDATE condicional abaixo já evita a ESCRITA repetida, mas a consulta em
 * si continuava saindo em toda request autenticada - uma ida e volta ao
 * Postgres remoto (~130ms medidos daqui) e uma conexão do pool (max 3)
 * ocupadas à toa, N vezes por segundo enquanto o Canva autossalva. Este mapa
 * corta a request antes de ela existir; o UPDATE condicional continua lá como
 * rede de segurança pro caso de mais de um processo tocar o mesmo usuário.
 */
const lastSeenTouchedAt = new Map<string, number>();

function touchLastSeen(userId: string): void {
  const now = Date.now();
  const touchedAt = lastSeenTouchedAt.get(userId);
  if (touchedAt !== undefined && now - touchedAt < LAST_SEEN_THROTTLE_MS) return;
  lastSeenTouchedAt.set(userId, now);
  const threshold = new Date(now - LAST_SEEN_THROTTLE_MS);
  db.update(schema.users)
    .set({ lastSeenAt: new Date() })
    .where(
      and(
        eq(schema.users.id, userId),
        or(isNull(schema.users.lastSeenAt), lt(schema.users.lastSeenAt, threshold)),
      ),
    )
    .then(() => undefined)
    .catch((error: unknown) => {
      lastSeenTouchedAt.delete(userId);
      logger.warn({ error, userId }, 'Failed to touch users.last_seen_at');
    });
}

/**
 * Cache do PERFIL do usuário (users + roles/permissions), não do token.
 *
 * Achado real (2026-09-11, "o Canva tá todo travado"): toda rota autenticada
 * fazia DUAS consultas remotas em série antes da rota começar
 * (resolveOrProvisionUser -> users, loadUserAccess -> roles/permissions). O
 * Postgres é o Supabase em us-east-1: ~130ms de ida e volta MEDIDOS daqui por
 * consulta, ou seja ~260ms de pedágio fixo em CADA request, antes de qualquer
 * trabalho útil - e com DATABASE_POOL_MAX=3 essas consultas ainda disputam
 * conexão com as da própria rota. Um editor que salva sozinho a cada 1,5s,
 * sobe imagem e recarrega listas satura isso sozinho: excluir um design
 * (4 idas ao banco) ficava atrás da fila de autosaves.
 *
 * O JWT continua sendo verificado a CADA request (jose, local, com JWKS já em
 * cache) - token expirado ou forjado nunca passa por aqui. O que o cache
 * evita é só a releitura do perfil, que muda raramente. TTL curto de
 * propósito: uma troca de papel/permissão ou uma desativação de conta
 * (`users.active`) demora no máximo esse tempo pra valer.
 */
const USER_CACHE_TTL_MS = 30_000;
const USER_CACHE_MAX_ENTRIES = 500;

interface CachedAccess {
  user: typeof schema.users.$inferSelect;
  roles: RoleName[];
  permissions: { resource: string; action: string }[];
  expiresAt: number;
}

const userCache = new Map<string, CachedAccess>();

function getCachedAccess(authUserId: string): CachedAccess | null {
  const entry = userCache.get(authUserId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    userCache.delete(authUserId);
    return null;
  }
  return entry;
}

function setCachedAccess(authUserId: string, entry: Omit<CachedAccess, 'expiresAt'>): void {
  // Descarta a entrada mais antiga quando cheio (Map preserva ordem de
  // inserção) - o teto existe só pra memória não crescer sem limite num
  // processo de vida longa, não como política de cache fina.
  if (userCache.size >= USER_CACHE_MAX_ENTRIES) {
    const oldest = userCache.keys().next();
    if (!oldest.done) userCache.delete(oldest.value);
  }
  userCache.set(authUserId, { ...entry, expiresAt: Date.now() + USER_CACHE_TTL_MS });
}

/**
 * Usada por rotas que mudam papel/permissão/estado de um usuário, pra mudança
 * valer na hora em vez de esperar o TTL. Aceita tanto o `auth_user_id` do
 * Supabase (a chave do cache) quanto o `users.id` interno, que é o que as
 * rotas de admin têm em mãos - a varredura é sobre no máximo
 * USER_CACHE_MAX_ENTRIES entradas e só acontece nessas ações raras.
 */
export function invalidateUserAccessCache(userId?: string): void {
  if (!userId) {
    userCache.clear();
    return;
  }
  userCache.delete(userId);
  for (const [key, entry] of userCache) {
    if (entry.user.id === userId) userCache.delete(key);
  }
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  language: string;
  theme: string;
  dashboardWidgets: string[];
  clickupEmail: string | null;
  roles: RoleName[];
  permissions: { resource: string; action: string }[];
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthenticatedUser;
  }
}

function getMasterEmails(): ReadonlySet<string> {
  return new Set(
    (process.env.MASTER_USER_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Cadeia de acesso da seção 6.8: Usuário -> Role -> Permission, a partir do
 * JWT do Supabase Auth (ADR 0001). Faz provisionamento just-in-time do
 * perfil em `users` na primeira vez que o token daquele usuário aparece.
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = extractBearerToken(request.headers.authorization);

  if (!token) {
    reply.code(401).send({ error: 'Missing bearer token' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) {
    reply.code(500).send({ error: 'SUPABASE_URL not configured on the Orchestrator' });
    return;
  }

  try {
    const claims = await verifySupabaseToken(token, supabaseUrl);

    const cached = getCachedAccess(claims.sub);
    const user = cached?.user ?? (await resolveOrProvisionUser(claims, getMasterEmails()));

    // users.active existia no schema desde o início mas nunca era checado
    // aqui: um master desativando um colaborador (users.active=false) não
    // tinha efeito nenhum até o token dele expirar sozinho no Supabase.
    if (!user.active) {
      userCache.delete(claims.sub);
      reply.code(403).send({ error: 'User account is deactivated' });
      return;
    }

    const access = cached ?? (await loadUserAccess(user.id));
    if (!cached) {
      setCachedAccess(claims.sub, { user, roles: access.roles, permissions: access.permissions });
    }

    request.authUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      language: user.language,
      theme: user.theme,
      dashboardWidgets: user.dashboardWidgets,
      clickupEmail: user.clickupEmail,
      roles: access.roles,
      permissions: access.permissions,
    };

    touchLastSeen(user.id);
  } catch (error) {
    request.log.warn({ error }, 'Auth token rejected');
    reply.code(401).send({ error: 'Invalid or expired token' });
  }
}

export function requirePermission(resource: string, action: string) {
  return async function checkPermission(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.authUser) {
      reply.code(401).send({ error: 'Not authenticated' });
      return;
    }
    if (!hasPermission(request.authUser.permissions, resource, action)) {
      reply.code(403).send({ error: `Missing permission ${resource}:${action}` });
      return;
    }
  };
}

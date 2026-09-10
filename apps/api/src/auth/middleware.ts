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

function touchLastSeen(userId: string): void {
  const threshold = new Date(Date.now() - LAST_SEEN_THROTTLE_MS);
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
      logger.warn({ error, userId }, 'Failed to touch users.last_seen_at');
    });
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
    const user = await resolveOrProvisionUser(claims, getMasterEmails());

    // users.active existia no schema desde o início mas nunca era checado
    // aqui: um master desativando um colaborador (users.active=false) não
    // tinha efeito nenhum até o token dele expirar sozinho no Supabase.
    if (!user.active) {
      reply.code(403).send({ error: 'User account is deactivated' });
      return;
    }

    const access = await loadUserAccess(user.id);

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

import type { FastifyInstance } from 'fastify';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { createLogger } from '@desigual-os/logging';
import { getTeamMembers, type ClickUpMember } from '@desigual-os/tool-gateway';
import { requireAuth } from '../auth/middleware';

const logger = createLogger({ service: 'orchestrator-api' });

// Cache em memória da lista de membros do ClickUp (compartilhada entre todos
// os usuários da API), pra N colaboradores abrindo a tela de mensagens não
// gerarem N chamadas ao GET /team/:teamId. Chaveado por team id.
const CLICKUP_MEMBERS_TTL_MS = 60_000;
const clickupMembersCache = new Map<string, { fetchedAt: number; members: ClickUpMember[] }>();

async function getCachedClickUpMembers(config: { apiKey: string; teamId: string }): Promise<ClickUpMember[]> {
  const cached = clickupMembersCache.get(config.teamId);
  if (cached && Date.now() - cached.fetchedAt < CLICKUP_MEMBERS_TTL_MS) {
    logger.info({ teamId: config.teamId }, 'ClickUp members cache hit');
    return cached.members;
  }
  logger.info({ teamId: config.teamId }, 'ClickUp members cache miss');
  const members = await getTeamMembers(config);
  clickupMembersCache.set(config.teamId, { fetchedAt: Date.now(), members });
  return members;
}

function getClickUpConfig(): { apiKey: string; teamId: string } | null {
  const apiKey = process.env.CLICKUP_API_KEY;
  const teamId = process.env.CLICKUP_TEAM_ID;
  if (!apiKey || !teamId) return null;
  return { apiKey, teamId };
}

/**
 * Diretório de colaboradores pro módulo de mensagens: mesma fonte do
 * /team/members (users + roles) enriquecida com os dados do ClickUp (foto,
 * iniciais, cor) casados por e-mail, e presença (users.last_seen_at). Se o
 * ClickUp estiver fora ou sem chave configurada, responde mesmo assim com
 * clickup: null e clickup_synced: false — o módulo não pode quebrar por causa
 * de integração externa.
 */
export async function registerCollaboratorRoutes(app: FastifyInstance): Promise<void> {
  app.get('/collaborators', { preHandler: requireAuth }, async () => {
    const rows = await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        clickupEmail: schema.users.clickupEmail,
        avatarUrl: schema.users.avatarUrl,
        lastSeenAt: schema.users.lastSeenAt,
        roleName: schema.roles.name,
      })
      .from(schema.users)
      .innerJoin(schema.userRoles, eq(schema.userRoles.userId, schema.users.id))
      .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
      .where(and(isNull(schema.users.deletedAt), eq(schema.users.active, true)))
      .orderBy(asc(schema.users.name));

    const byId = new Map<
      string,
      { id: string; name: string; email: string; clickupEmail: string | null; avatarUrl: string | null; lastSeenAt: Date | null; roles: string[] }
    >();
    for (const row of rows) {
      const existing = byId.get(row.id);
      if (existing) {
        existing.roles.push(row.roleName);
      } else {
        byId.set(row.id, {
          id: row.id,
          name: row.name,
          email: row.email,
          clickupEmail: row.clickupEmail,
          avatarUrl: row.avatarUrl,
          lastSeenAt: row.lastSeenAt,
          roles: [row.roleName],
        });
      }
    }

    let clickUpByEmail = new Map<string, ClickUpMember>();
    let clickupSynced = false;
    const config = getClickUpConfig();
    if (config) {
      try {
        const members = await getCachedClickUpMembers(config);
        clickUpByEmail = new Map(members.map((member) => [member.email.toLowerCase(), member]));
        clickupSynced = true;
      } catch (error) {
        logger.warn({ error }, 'ClickUp members lookup failed; serving collaborators without ClickUp data');
      }
    }

    const collaborators = [...byId.values()].map((user) => {
      // Casa pelo clickup_email (e-mail que a pessoa usa no ClickUp), caindo
      // pro e-mail de login quando aquele não está preenchido.
      const matchEmail = (user.clickupEmail ?? user.email).toLowerCase();
      const clickupMember = clickUpByEmail.get(matchEmail) ?? null;
      return {
        user_id: user.id,
        name: user.name,
        email: user.email,
        avatar_url: clickupMember?.profilePicture ?? user.avatarUrl ?? null,
        roles: user.roles,
        clickup: clickupMember
          ? {
              id: clickupMember.id,
              username: clickupMember.username,
              email: clickupMember.email,
              profile_picture: clickupMember.profilePicture,
              initials: clickupMember.initials,
              color: clickupMember.color,
            }
          : null,
        last_seen_at: user.lastSeenAt?.toISOString() ?? null,
      };
    });

    return { collaborators, clickup_synced: clickupSynced };
  });
}

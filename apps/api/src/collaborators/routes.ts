import type { FastifyInstance } from 'fastify';
import { and, asc, eq, gte, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { createLogger } from '@desigual-os/logging';
import { getTeamMembers, type ClickUpMember } from '@desigual-os/tool-gateway';
import { requireAuth } from '../auth/middleware';
import { recorteDePessoasVisiveis } from '../lib/escopo-de-organizacao';

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
  app.get('/collaborators', { preHandler: requireAuth }, async (request, reply) => {
    const usuario = request.authUser;
    if (!usuario) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }
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
      /**
       * SÓ A EQUIPE DA MINHA EMPRESA. A rota devolvia todos os usuários ativos,
       * sem recorte — nome, e-mail, papel e vínculo ClickUp de cada pessoa.
       * Recorte dentro da consulta que já existia, não numa pergunta antes.
       */
      .where(
        and(
          isNull(schema.users.deletedAt),
          eq(schema.users.active, true),
          recorteDePessoasVisiveis(usuario, schema.users.id),
        ),
      )
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

    /**
     * O QUE CADA PESSOA ANDA PEDINDO AO CLAUDE — 30 dias.
     *
     * Sem isto, a tela de Equipe é um cadastro: nome, papel, último acesso.
     * Quem supervisiona não abre um cadastro; abre para saber quem está usando
     * a inteligência, para quê, e quem não está usando — que costuma ser a
     * informação mais acionável das duas.
     *
     * Uma consulta agregada, não uma por pessoa: com o Postgres a ~130ms de ida
     * e volta, dez pessoas viravam dez viagens e a tela levaria mais de um
     * segundo para dizer algo simples.
     */
    const desde30d = new Date(Date.now() - 30 * 24 * 3_600_000);
    const atividade = await db
      .select({
        userId: schema.conversations.userId,
        conversas: sql<number>`count(distinct ${schema.conversations.id})::int`,
        mensagens: sql<number>`count(${schema.messages.id})::int`,
        ultima: sql<string | null>`max(${schema.messages.createdAt})::text`,
      })
      .from(schema.conversations)
      .leftJoin(schema.messages, eq(schema.messages.conversationId, schema.conversations.id))
      .where(gte(schema.conversations.createdAt, desde30d))
      .groupBy(schema.conversations.userId)
      .catch(() => []);
    const atividadePorPessoa = new Map(atividade.filter((a) => a.userId).map((a) => [a.userId!, a]));

    /** Quais agentes a pessoa usou. "Usa o Otto" diz mais que "fez 40 pedidos". */
    const porAgente = await db
      .select({
        userId: schema.executions.userId,
        agent: schema.executions.agent,
        total: sql<number>`count(*)::int`,
      })
      .from(schema.executions)
      .where(gte(schema.executions.createdAt, desde30d))
      .groupBy(schema.executions.userId, schema.executions.agent)
      .catch(() => []);
    const agentesPorPessoa = new Map<string, Array<{ agent: string; total: number }>>();
    for (const linha of porAgente) {
      if (!linha.userId || !linha.agent) continue;
      const atual = agentesPorPessoa.get(linha.userId) ?? [];
      atual.push({ agent: linha.agent, total: linha.total });
      agentesPorPessoa.set(linha.userId, atual);
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
        /**
         * Atividade no Claude. `0` aqui é um zero MEDIDO — a consulta rodou e a
         * pessoa não conversou nos últimos 30 dias — e é justamente o dado que
         * um supervisor precisa ver.
         */
        atividade: {
          conversas_30d: atividadePorPessoa.get(user.id)?.conversas ?? 0,
          mensagens_30d: atividadePorPessoa.get(user.id)?.mensagens ?? 0,
          ultima_conversa: atividadePorPessoa.get(user.id)?.ultima ?? null,
          agentes: (agentesPorPessoa.get(user.id) ?? []).sort((a, b) => b.total - a.total),
        },
      };
    });

    return { collaborators, clickup_synced: clickupSynced };
  });
}

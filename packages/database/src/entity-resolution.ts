import { and, eq, isNull } from 'drizzle-orm';
import { db } from './client';
import { entityLinks } from './schema/entity-links';
import { users } from './schema/identity';
import { organizationMembers } from './schema/organizations';

/**
 * entity-resolution.ts — quem é quem entre o Desigual OS e os sistemas de fora.
 *
 * Resolve a identidade EXTERNA (ex.: user id do ClickUp, e-mail de membro) para
 * a pessoa INTERNA (users.id + organization_members.id daquela organização) e
 * grava o vínculo em `entity_links` para que a próxima resolução seja O(1) e
 * não dependa mais de e-mail/nome.
 *
 * Regra de ouro herdada do event store: NUNCA inventar quem mexeu. Sem link e
 * sem e-mail casado, a resposta é null — o chamador registra o evento sem ator
 * (actor_resolution='nao_resolvido') em vez de chutar um nome.
 *
 * Morre aqui e não no tool-gateway porque os DOIS consumidores (webhook em
 * apps/api, backfill em apps/worker) já dependem de @desigual-os/database, e o
 * contrário (database -> tool-gateway) criaria ciclo.
 */

export type EntityType = 'person' | 'client' | 'task';
export type EntitySource = 'clickup' | 'claude-mcp' | 'desigual';

export interface VincularEntidadeInput {
  organizationId: string;
  entityType: EntityType;
  /** Id interno (users.id quando person). Sem FK polimórfica — ver header do schema. */
  desigualId: string;
  source: EntitySource;
  externalId: string;
  metadata?: Record<string, unknown>;
}

export type VincularEntidadeOutcome =
  | { status: 'created'; linkId: string }
  /** Já existia (unique org+source+type+external). Idempotência, não erro. */
  | { status: 'existing'; linkId: string };

/** Grava o vínculo de forma idempotente. Nunca lança por duplicidade. */
export async function vincularEntidade(input: VincularEntidadeInput): Promise<VincularEntidadeOutcome> {
  const inserted = await db
    .insert(entityLinks)
    .values({
      organizationId: input.organizationId,
      entityType: input.entityType,
      desigualId: input.desigualId,
      source: input.source,
      externalId: input.externalId,
      metadata: input.metadata ?? {},
    })
    .onConflictDoNothing({
      target: [entityLinks.organizationId, entityLinks.source, entityLinks.entityType, entityLinks.externalId],
    })
    .returning({ id: entityLinks.id });

  if (inserted.length > 0) return { status: 'created', linkId: inserted[0]!.id };

  const [existing] = await db
    .select({ id: entityLinks.id })
    .from(entityLinks)
    .where(
      and(
        eq(entityLinks.organizationId, input.organizationId),
        eq(entityLinks.source, input.source),
        eq(entityLinks.entityType, input.entityType),
        eq(entityLinks.externalId, input.externalId),
      ),
    );
  return { status: 'existing', linkId: existing?.id ?? 'desconhecido' };
}

export interface PessoaResolvida {
  userId: string;
  /** organization_members.id — QUEM da equipe naquela org (o employeeId dos eventos). */
  employeeId: string | null;
  name: string;
}

async function buscarPessoaPorUserId(organizationId: string, userId: string): Promise<PessoaResolvida | null> {
  const [row] = await db
    .select({ userId: users.id, name: users.name, employeeId: organizationMembers.id })
    .from(users)
    .leftJoin(
      organizationMembers,
      and(eq(organizationMembers.userId, users.id), eq(organizationMembers.organizationId, organizationId)),
    )
    .where(and(eq(users.id, userId), isNull(users.deletedAt)));
  return row ? { userId: row.userId, employeeId: row.employeeId, name: row.name } : null;
}

/**
 * ClickUp user id -> pessoa, via `entity_links`. O vínculo tem que ser da MESMA
 * organização: o workspace do ClickUp é compartilhado, mas a identidade interna
 * é por tenant.
 */
export async function resolverPessoaPorClickupUserId(
  organizationId: string,
  clickupUserId: string,
): Promise<PessoaResolvida | null> {
  const [link] = await db
    .select({ desigualId: entityLinks.desigualId })
    .from(entityLinks)
    .where(
      and(
        eq(entityLinks.organizationId, organizationId),
        eq(entityLinks.source, 'clickup'),
        eq(entityLinks.entityType, 'person'),
        eq(entityLinks.externalId, clickupUserId),
      ),
    );
  if (!link) return null;
  return buscarPessoaPorUserId(organizationId, link.desigualId);
}

/**
 * E-mail do ClickUp -> pessoa, via `users.clickup_email` (a ponte que já
 * existia). Quando encontra e o chamador trouxe o clickupUserId, GRAVA o link:
 * da próxima vez a resolução sai por `resolverPessoaPorClickupUserId` e o
 * e-mail deixa de ser o elo fraco.
 */
export async function resolverPessoaPorEmail(
  organizationId: string,
  email: string,
  clickupUserId?: string | null,
): Promise<PessoaResolvida | null> {
  const [row] = await db
    .select({ userId: users.id, name: users.name, employeeId: organizationMembers.id })
    .from(users)
    .innerJoin(
      organizationMembers,
      and(eq(organizationMembers.userId, users.id), eq(organizationMembers.organizationId, organizationId)),
    )
    .where(and(eq(users.clickupEmail, email), isNull(users.deletedAt)));
  if (!row) return null;

  const pessoa: PessoaResolvida = { userId: row.userId, employeeId: row.employeeId, name: row.name };
  if (clickupUserId) {
    await vincularEntidade({
      organizationId,
      entityType: 'person',
      desigualId: row.userId,
      source: 'clickup',
      externalId: clickupUserId,
      metadata: { resolved_by: 'email', email },
    });
  }
  return pessoa;
}

/** Todos os vínculos de uma entidade interna dentro da organização. */
export async function linksDaEntidade(organizationId: string, desigualId: string) {
  return db
    .select()
    .from(entityLinks)
    .where(and(eq(entityLinks.organizationId, organizationId), eq(entityLinks.desigualId, desigualId)));
}

import type { AuthenticatedUser } from '../auth/middleware';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';

/**
 * Colaboração entre clientes exige membership na organização do recurso.
 * O papel master não dispensa essa fronteira. Permissões de cada operação
 * continuam sendo verificadas pela rota; este helper verifica apenas escopo.
 */
export async function hasClientAccess(user: AuthenticatedUser, clientId: string): Promise<boolean> {
  const [row] = await db
    .select({ clientId: schema.clients.id })
    .from(schema.clients)
    .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.organizationId, schema.clients.organizationId))
    .innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
    .where(and(eq(schema.clients.id, clientId), eq(schema.organizationMembers.userId, user.id), eq(schema.users.active, true), isNull(schema.users.deletedAt), isNull(schema.clients.deletedAt)));
  return Boolean(row);
}

/** Organizações de que o usuário é membro ativo. Base de todo escopo de tenant. */
export async function organizationIdsForUser(userId: string): Promise<string[]> {
  const rows = await db
    .select({ organizationId: schema.organizationMembers.organizationId })
    .from(schema.organizationMembers)
    .where(eq(schema.organizationMembers.userId, userId));
  return rows.map((row) => row.organizationId);
}

/**
 * P0-02 (auditoria de release readiness, 22/09/2026): "chat compartilhado"
 * (decisão de 2026-09-03: colega vê a atividade do colega) presumia UMA
 * organização só — hoje o sistema tem múltiplas, e a query de
 * `GET /conversations`/`GET /executions` não filtrava por organização
 * nenhuma. Um colaborador autenticado de qualquer org lia conversa/execução
 * pública de QUALQUER outra org.
 *
 * Escopo pra "compartilhado DENTRO da própria organização": clientId dita a
 * organização quando presente (join com `clients`); sem clientId, o dono do
 * recurso precisa compartilhar pelo menos uma organização com quem pede.
 * Devolve os dois conjuntos já resolvidos pra a rota montar o filtro com uma
 * única query adicional (dataset pequeno: 1 organização em produção hoje).
 */
export async function tenantSharingScope(
  userId: string,
): Promise<{ organizationIds: string[]; allowedClientIds: string[]; teammateUserIds: string[] }> {
  const organizationIds = await organizationIdsForUser(userId);
  if (organizationIds.length === 0) return { organizationIds, allowedClientIds: [], teammateUserIds: [] };

  const [clientRows, teammateRows] = await Promise.all([
    db
      .select({ id: schema.clients.id })
      .from(schema.clients)
      .where(and(inArray(schema.clients.organizationId, organizationIds), isNull(schema.clients.deletedAt))),
    db
      .select({ userId: schema.organizationMembers.userId })
      .from(schema.organizationMembers)
      .where(inArray(schema.organizationMembers.organizationId, organizationIds)),
  ]);
  return {
    organizationIds,
    allowedClientIds: clientRows.map((row) => row.id),
    teammateUserIds: [...new Set(teammateRows.map((row) => row.userId))],
  };
}

/**
 * P0-02: mesma regra de `tenantSharingScope`, aplicada a UMA conversa já
 * carregada (GET /conversations/:id e /:id/messages) — evita duas queries
 * extras quando o pedido é privado/próprio, que é o caminho mais comum.
 */
export async function canReadConversationInOrg(
  user: AuthenticatedUser,
  conversation: { userId: string; visibility: string; clientId: string | null },
): Promise<boolean> {
  if (user.roles.includes('master')) return true;
  if (conversation.userId === user.id) return true;
  if (conversation.visibility !== 'public') return false;
  const scope = await tenantSharingScope(user.id);
  if (conversation.clientId) return scope.allowedClientIds.includes(conversation.clientId);
  return scope.teammateUserIds.includes(conversation.userId);
}

export async function hasOrganizationAccess(user: AuthenticatedUser, organizationId: string | null): Promise<boolean> {
  if (!organizationId) return false;
  const [row] = await db
    .select({ id: schema.organizationMembers.id })
    .from(schema.organizationMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
    .where(and(eq(schema.organizationMembers.organizationId, organizationId), eq(schema.organizationMembers.userId, user.id), eq(schema.users.active, true), isNull(schema.users.deletedAt)));
  return Boolean(row);
}

/**
 * Posse de uma PEÇA do Studio (job ou asset).
 *
 * Isto é deliberadamente mais estrito que `hasClientAccess` acima, e os dois
 * não se contradizem: ver o workspace de um cliente é colaboração (decisão
 * de 2026-09-03, mantida); **cancelar a geração de outra pessoa, apagar o
 * arquivo dela ou emitir veredito em nome dela não é**. Esses três gastam
 * GPU real, destroem arquivo no Storage e alteram o aprendizado do Otto.
 *
 * Achado real (17/09/2026): as rotas de escrita do Studio autorizavam com
 * `studio:write && hasClientAccess(...)`, e como `hasClientAccess` devolve
 * `true` para todo mundo, o segundo termo não filtrava nada - na prática
 * QUALQUER colaborador autenticado podia apagar ou cancelar o job de
 * QUALQUER outro. As rotas de LEITURA já eram corretas (`GET /studio/jobs`
 * filtra por `requested_by` e `GET /studio/jobs/:id` compara o dono), então
 * o vazamento era só de escrita.
 *
 * `ownerId` null = peça sem dono registrado: jobs anteriores à coluna
 * `requested_by` e assets importados do histórico do ComfyUI
 * (`scripts/import-comfyui-outputs.ts`), que nasceram fora de qualquer
 * sessão de usuário. Ninguém poderia limpá-los se exigíssemos posse, então
 * aí sim vale a permissão geral do módulo - é a única exceção, e é estreita.
 */
export function canActOnStudioEntity(
  user: AuthenticatedUser,
  ownerId: string | null,
  options: { hasStudioWrite: boolean },
): boolean {
  if (user.roles.includes('master')) return true;
  if (ownerId !== null) return ownerId === user.id;
  return options.hasStudioWrite;
}

/** Documento Canva: apenas o proprietário ou um master pode removê-lo. */
export function canDeleteCanvasDocument(user: AuthenticatedUser, ownerId: string | null): boolean {
  return user.roles.includes('master') || (ownerId !== null && ownerId === user.id);
}

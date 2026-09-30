import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { montarPrincipal, type McpPrincipal } from '@desigual-os/mcp-domain';

/**
 * principal.ts — do token para a PESSOA, com papel e organização.
 *
 * O ponto desta camada: o token diz o que foi CONCEDIDO; o banco diz o que a
 * pessoa PODE hoje. Os dois são lidos a cada chamada e a interseção é o que
 * vale. Um funcionário rebaixado perde acesso no turno seguinte, sem esperar o
 * token expirar — e sem ninguém precisar lembrar de revogar nada.
 */

export interface ResolverPrincipalInput {
  userId: string;
  organizationId: string;
  scopesDoToken: string[];
  sessionId: string;
}

/**
 * Devolve `null` quando a pessoa não é mais membro ativo daquela organização.
 * Não lança: quem chama transforma isso em 401, e o motivo não vai para o
 * cliente — dizer "você não é mais membro" confirma a existência da organização.
 */
export async function resolverPrincipal(input: ResolverPrincipalInput): Promise<McpPrincipal | null> {
  const [row] = await db
    .select({
      userId: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      employeeId: schema.organizationMembers.id,
      organizationId: schema.organizationMembers.organizationId,
      role: schema.organizationMembers.role,
    })
    .from(schema.organizationMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
    .where(
      and(
        eq(schema.organizationMembers.userId, input.userId),
        eq(schema.organizationMembers.organizationId, input.organizationId),
        // Usuário desativado ou removido não tem acesso, mesmo com token válido.
        eq(schema.users.active, true),
        isNull(schema.users.deletedAt),
      ),
    );
  if (!row) return null;
  return montarPrincipal(
    {
      userId: row.userId,
      organizationId: row.organizationId,
      employeeId: row.employeeId,
      email: row.email,
      name: row.name,
      role: row.role,
    },
    input.scopesDoToken,
    input.sessionId,
  );
}

/**
 * Abre (ou reaproveita) a sessão MCP. A sessão é a unidade de correlação que a
 * auditoria usa para responder "essa sequência de alterações veio toda da mesma
 * conversa?" — sem ela, cada escrita é um evento solto.
 */
export async function abrirSessao(input: {
  userId: string;
  organizationId: string;
  clientId: string | null;
  transportSessionId: string | null;
}): Promise<string> {
  if (input.transportSessionId) {
    const [existente] = await db
      .select({ id: schema.mcpSessions.id })
      .from(schema.mcpSessions)
      .where(
        and(
          eq(schema.mcpSessions.transportSessionId, input.transportSessionId),
          eq(schema.mcpSessions.userId, input.userId),
          isNull(schema.mcpSessions.endedAt),
        ),
      );
    if (existente) {
      await db
        .update(schema.mcpSessions)
        .set({ lastSeenAt: new Date() })
        .where(eq(schema.mcpSessions.id, existente.id));
      return existente.id;
    }
  }
  const [nova] = await db
    .insert(schema.mcpSessions)
    .values({
      userId: input.userId,
      organizationId: input.organizationId,
      clientId: input.clientId,
      transportSessionId: input.transportSessionId,
    })
    .returning({ id: schema.mcpSessions.id });

  /**
   * CONNECTION_CREATED é do CICLO DE VIDA, não do trabalho — por isso é
   * emitido aqui, no ato de abrir sessão, e não por uma tool que o Claude
   * decide chamar. Sem `onConflictDoNothing`: `nova.id` acabou de ser gerado,
   * a chave é única por construção.
   */
  const [pessoa] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, input.userId));
  await db.insert(schema.operationalEvents).values({
    source: 'mcp',
    type: 'CONNECTION_CREATED',
    externalId: `mcp:connection:${nova!.id}`,
    organizationId: input.organizationId,
    userId: input.userId,
    clientId: null,
    entityType: 'mcp_session',
    entityId: nova!.id,
    actor: pessoa?.name ?? null,
    summary: `${pessoa?.name ?? 'Alguém'} conectou o Claude ao Desigual OS`,
    importance: 'LOW',
    visibility: 'TEAM',
    occurredAt: new Date(),
    processedAt: new Date(),
  }).catch(() => {
    // Falha ao registrar o evento de conexão não pode derrubar a conexão em
    // si — a sessão já foi criada e a chamada MCP precisa seguir.
  });

  return nova!.id;
}

/**
 * A organização da pessoa quando ela só pertence a uma.
 *
 * Existe porque o fluxo OAuth precisa escolher a organização ANTES de haver
 * sessão. Com mais de uma membership isto devolve `null` de propósito: escolher
 * em silêncio significaria decidir em nome do funcionário de qual empresa ele
 * está falando, e a tela de consentimento é o lugar certo para perguntar.
 */
export async function organizacaoUnicaDoUsuario(userId: string): Promise<string | null> {
  const linhas = await db
    .select({ organizationId: schema.organizationMembers.organizationId })
    .from(schema.organizationMembers)
    .where(eq(schema.organizationMembers.userId, userId));
  return linhas.length === 1 ? linhas[0]!.organizationId : null;
}

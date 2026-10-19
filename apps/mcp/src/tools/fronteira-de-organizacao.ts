import { eq, isNull, or, type AnyColumn, type SQL } from 'drizzle-orm';

/**
 * fronteira-de-organizacao.ts — a condição que faltava nas 6 tabelas de
 * conteúdo sem organization_id (migração 0045, 30/09/2026).
 *
 * MEDIDO: de 77 tabelas, 9 já isolavam por organização direto; as de
 * CONTEÚDO (memories, proactive_signals, agent_episodes, conversations,
 * messages, executions) dependiam de lembrar o salto client_id ->
 * clients.organization_id, ou user_id -> organization_members. Convenção
 * que depende de quem escreve a consulta lembrar já vazou duas vezes no
 * mesmo dia: anotação privada de uma pessoa aparecendo pra outra, em duas
 * portas diferentes pra `memories` (ver visibilidade-de-memoria.ts). Com
 * mais de uma organização no banco, a MESMA forma de defeito vaza a
 * operação de uma empresa-cliente pra outra.
 *
 * A coluna agora existe. Esta função é o que faz ela valer em toda
 * consulta, uma fonte canônica em vez de `eq(organizationId, ...)`
 * repetido e — mais cedo ou mais tarde — esquecido em alguma tool nova.
 *
 * `IS NULL` no OR é TRANSICIONAL, não permissivo por engano: o backfill da
 * 0045 não resolveu 100% das linhas (memória de sistema sem cliente nem
 * pessoa, sinal sem cliente) e os caminhos de escrita de apps/api ainda não
 * foram atualizados pra popular a coluna. Excluir NULL agora faria conteúdo
 * legítimo sumir de resultado de busca — trocar vazamento por amnésia, o
 * mesmo erro que a decisão do IS DISTINCT FROM evitou em
 * visibilidade-de-memoria.ts. Quando os caminhos de escrita estiverem
 * todos corrigidos e o backfill fechado, trocar por `eq` puro é o próximo
 * passo — não antes, e não por suposição.
 */
export function fronteiraDeOrganizacao(coluna: AnyColumn, organizationId: string): SQL {
  return or(eq(coluna, organizationId), isNull(coluna))!;
}

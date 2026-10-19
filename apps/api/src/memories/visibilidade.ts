import { eq, or, sql, type SQL } from 'drizzle-orm';
import { schema } from '@desigual-os/database';

/**
 * A condição de visibilidade da memória, extraída pra ser TESTÁVEL.
 *
 * Nasceu de um vazamento real, publicado por mim em 29/09/2026 e achado duas
 * horas depois: a rota `/memories` devolvia memórias marcadas `USER_PRIVATE` de
 * outras pessoas. A conta de QA lia anotações da conta de atendimento cujo
 * próprio texto dizia "que ninguém mais pode ver".
 *
 * A regra existia e estava bem escrita — no MCP, em
 * `packages/mcp-domain/src/memory-scope.ts`, com o comentário certo: "nem
 * SUPER_ADMIN atravessa, porque um administrador que lê tudo transforma o
 * escopo privado em teatro". O que faltou foi a rota nova saber que ela existe.
 * É o mesmo formato de defeito que este projeto viu o dia inteiro: a segunda
 * porta pro mesmo dado, sem a regra que a primeira tinha.
 *
 * DUAS DECISÕES QUE O TESTE TRAVA:
 *
 * 1. É filtro de WHERE, não de array depois da consulta. Filtrar depois vaza
 *    pelo total — um contador que conta o que a lista esconde denuncia a
 *    existência do que deveria estar escondido.
 *
 * 2. `IS DISTINCT FROM` e não `<>`. A esmagadora maioria das memórias não tem
 *    `mcp_scope` nenhum; com `<>`, NULL faria a comparação virar NULL e a linha
 *    sumiria — escondendo tudo que não veio pelo MCP, que é quase tudo.
 */
export function somenteMemoriaVisivel(userId: string): SQL | undefined {
  return or(
    sql`${schema.memories.metadata}->>'mcp_scope' IS DISTINCT FROM 'USER_PRIVATE'`,
    eq(schema.memories.userId, userId),
  );
}

import { eq, or, sql, type SQL } from 'drizzle-orm';
import { schema } from '@desigual-os/database';

/**
 * A condição de visibilidade da memória, no SQL das tools do MCP.
 *
 * VAZAMENTO REAL, provado contra o banco de produção em 30/09/2026: a tool
 * `search_memory` filtrava por `status='active'`, pelo texto da busca e, quando
 * informado, pelo cliente. Mais nada. Nenhum filtro de DONO.
 *
 * Consequência medida, rodando a cláusula WHERE exata da tool: buscar
 * "privada" devolvia 5 anotações da conta de atendimento cujo próprio conteúdo
 * diz "Anotação privada da Tammy que ninguém mais pode ver" — para qualquer
 * pessoa da organização que conectasse um Claude e pesquisasse.
 *
 * A regra sempre existiu, e a duas pastas daqui: `podeVer` em
 * `packages/mcp-domain/src/memory-scope.ts`, com o comentário certo — "nenhum
 * papel, nem SUPER_ADMIN, atravessa; um administrador que pode ler tudo
 * transforma o escopo privado em teatro". Ela é aplicada em v1.ts, via
 * `filtrarVisiveis`. O que faltou foi as OUTRAS quatro leituras de `memories`
 * saberem que ela existe.
 *
 * É a terceira vez que este projeto vê a mesma forma de defeito em três dias: a
 * segunda porta para o mesmo dado, sem a regra que a primeira tinha. Já
 * aconteceu com `/memories` na API (corrigido em 29/09) e com a tela de
 * Decisões lendo a tabela errada.
 *
 * DUAS DECISÕES, as mesmas da correção da API, pelos mesmos motivos:
 *
 * 1. É WHERE, não filtro de array depois da consulta. Pós-filtro ainda vaza
 *    pelo `limit` e por qualquer contagem — uma lista que esconde 5 de 10 mas
 *    diz "10 resultados" denuncia a existência do que deveria estar escondido.
 *
 * 2. `IS DISTINCT FROM` e não `<>`. Das 489 memórias do banco, 475 não têm
 *    `mcp_scope` nenhum; com `<>`, o NULL faria a comparação virar NULL e a
 *    linha sumir — escondendo quase todo o acervo e trocando um vazamento por
 *    uma amnésia.
 */
export function somenteMemoriaVisivelNoMcp(userId: string): SQL | undefined {
  return or(
    sql`${schema.memories.metadata}->>'mcp_scope' IS DISTINCT FROM 'USER_PRIVATE'`,
    eq(schema.memories.userId, userId),
  );
}

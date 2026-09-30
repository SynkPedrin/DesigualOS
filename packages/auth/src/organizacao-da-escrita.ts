import { db, schema } from '@desigual-os/database';
import { eq } from 'drizzle-orm';

/**
 * organizacao-da-escrita.ts — de qual EMPRESA é a linha que está sendo gravada.
 *
 * A migração 0045 pôs `organization_id` nas seis tabelas de conteúdo e fez o
 * backfill do que já existia. Isso resolve o passado. Esta função existe para o
 * presente: **toda linha nova precisa nascer com dono**.
 *
 * MEDIDO EM 30/09/2026, poucas horas depois do backfill, e é o número que
 * justifica o arquivo: `messages` passou de 2 para 22 linhas sem organização.
 * Vinte linhas órfãs em algumas horas de uso normal. Sem isto, cada dia de
 * operação recria o problema que a migração acabou de arrumar, e o backfill
 * vira uma tarefa eterna em vez de uma correção.
 *
 * POR QUE UMA FUNÇÃO, e não `organizationId` escrito em cada `insert`: existem
 * treze pontos de escrita nessas tabelas entre `apps/api`, `apps/worker` e
 * `apps/mcp`. A seção 82 do briefing é explícita — "tenant enforcement central;
 * não espalhar permission checks manualmente em 40 endpoints". Treze cópias da
 * mesma dedução é treze chances de uma divergir, e divergência aqui não quebra
 * nada: só grava na empresa errada, em silêncio.
 *
 * A ORDEM DE RESOLUÇÃO, e o motivo de cada degrau:
 *
 *   1. CLIENTE. Se a linha é sobre um cliente, ela pertence à empresa dona
 *      daquele cliente. É o vínculo mais forte: uma memória da Cosentino é da
 *      Cosentino, mesmo que quem escreveu seja de outra empresa (um consultor
 *      da Desigual, por exemplo).
 *   2. PESSOA. Sem cliente, a linha pertence à empresa de quem escreveu.
 *   3. NULO. Sem os dois, fica sem dono — explicitamente.
 *
 * O terceiro degrau é uma decisão, não uma falha de implementação. Existem 47
 * memórias legitimamente sem vínculo (checklist diário, menção do ClickUp
 * respondida) e elas NÃO devem ser carimbadas com a organização única de hoje
 * por dedução: no dia em que existirem duas, esse carimbo seria um palpite
 * gravado como fato, e ninguém teria como distinguir o que foi resolvido do que
 * foi chutado. Nulo é uma resposta honesta; carimbo errado, não.
 */

export interface OrigemDaEscrita {
  /** Quem está escrevendo. */
  userId?: string | null | undefined;
  /** Sobre qual cliente, quando a linha for sobre um. */
  clientId?: string | null | undefined;
}

/**
 * A ordem de precedência, isolada para ter teste sem banco. Recebe o que já foi
 * resolvido e decide — é aqui que mora a regra, não na consulta.
 */
export function decidirOrganizacao(
  orgDoCliente: string | null,
  orgDaPessoa: string | null,
): string | null {
  return orgDoCliente ?? orgDaPessoa ?? null;
}

/**
 * Resolve a empresa dona da linha. `null` quando não há vínculo — e isso é uma
 * resposta válida, não um erro a ser silenciado com um valor padrão.
 */
export async function organizacaoDaEscrita(origem: OrigemDaEscrita): Promise<string | null> {
  const [orgDoCliente, orgDaPessoa] = await Promise.all([
    origem.clientId
      ? db
          .select({ organizationId: schema.clients.organizationId })
          .from(schema.clients)
          .where(eq(schema.clients.id, origem.clientId))
          .then((linhas) => linhas[0]?.organizationId ?? null)
          .catch(() => null)
      : Promise.resolve(null),

    origem.userId
      ? db
          .select({ organizationId: schema.organizationMembers.organizationId })
          .from(schema.organizationMembers)
          .where(eq(schema.organizationMembers.userId, origem.userId))
          .then((linhas) => linhas[0]?.organizationId ?? null)
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  return decidirOrganizacao(orgDoCliente, orgDaPessoa);
}

import type { PipelineStage } from '@desigual-os/types';

/**
 * estagios.ts — lógica pura de status/coluna de um quadro `tipo='tarefas'`.
 *
 * Separado de routes.ts porque o webhook do ClickUp (apps/api/src/clickup/routes.ts)
 * também precisa decidir "em que coluna esta task entra" ao criar/mover um
 * cartão sozinho — e rota não importa de rota neste repositório. Isto é o
 * meio-termo: nem duplicar a regra, nem acoplar dois módulos de rota.
 */

/**
 * STATUS É POR LISTA, NUNCA UNIVERSAL (13/10/2026, confirmado pela operação:
 * cada cliente tem o seu, não um padrão comum em toda a agência). Um quadro
 * `tipo='tarefas'` não pode aceitar uma coluna com `clickupStatus` que não
 * existe DE VERDADE na lista do cliente dele — aceitar de olhos fechados é o
 * jeito de o quadro prometer "mover isso muda o status lá" e o ClickUp
 * recusar (502) quando alguém finalmente arrasta o cartão. Devolve os
 * `clickupStatus` que NÃO batem com a lista real — vazio significa "pode
 * criar/salvar".
 */
export function statusInvalidosParaALista(stages: ReadonlyArray<{ clickupStatus?: string | undefined }>, statusReais: readonly string[]): string[] {
  const validos = new Set(statusReais.map((s) => s.trim().toLowerCase()));
  const vistos = new Set<string>();
  for (const stage of stages) {
    if (!stage.clickupStatus) continue;
    if (!validos.has(stage.clickupStatus.trim().toLowerCase())) vistos.add(stage.clickupStatus);
  }
  return [...vistos];
}

/**
 * EM QUE COLUNA UMA TASK ENTRA, pelo status real dela — comparação sem
 * diferenciar caixa, porque o ClickUp às vezes devolve o status com
 * capitalização diferente da que a pessoa configurou na coluna (mesma lição
 * do read-back de `bento-update-executor.ts`: comparar com tolerância onde o
 * provedor não garante formato exato). `null` quando a task não tem status
 * conhecido OU quando nenhuma coluna deste quadro usa esse status — nesse
 * caso quem chama decide o que fazer (não criar, ou cair na primeira coluna),
 * nunca esta função inventa.
 */
export function estagioPeloStatus(stages: readonly PipelineStage[], status: string | null): PipelineStage | null {
  if (!status) return null;
  const alvo = status.trim().toLowerCase();
  return stages.find((s) => s.clickupStatus?.trim().toLowerCase() === alvo) ?? null;
}

export interface EstagioDoClickUp {
  status: string;
  /** Tipo do ClickUp: `open`, `custom`, `done` ou `closed`. */
  type: string | null;
}

const PESO_DO_TIPO: Record<string, number> = { open: 0, custom: 1, done: 2, closed: 3 };

/** Status que o quadro deixa desmarcado por padrão: o que já foi encerrado não é trabalho em andamento. */
export function ehFechado(estagio: EstagioDoClickUp): boolean {
  return estagio.type === 'closed';
}

/**
 * JUNTA OS FLUXOS DE VÁRIAS LISTAS num conjunto só de colunas (15/10/2026).
 *
 * O quadro "atribuídas a mim" junta tarefas de listas diferentes. Tirar as
 * colunas só dos status que as tarefas TÊM hoje dava um quadro de duas
 * colunas (a Jamile tinha tudo em "aberto" ou "pronto") e escondia o fluxo
 * real — "aguardando aprovação", "alteração", "reprovado" — para onde ela
 * precisa mover os cartões. Então as colunas são o fluxo das listas, e os
 * status das tarefas entram só como complemento.
 *
 * Ordem: aberto, os do meio, feito, fechado; dentro de cada grupo, a ordem da
 * primeira lista em que o status aparece (quem chama manda a lista mais
 * frequente primeiro). Sem repetir, sem diferenciar maiúscula.
 */
export function juntarFluxos(fluxos: ReadonlyArray<ReadonlyArray<EstagioDoClickUp>>): EstagioDoClickUp[] {
  const vistos = new Map<string, EstagioDoClickUp & { peso: number; ordem: number }>();
  for (const fluxo of fluxos) {
    for (const estagio of fluxo) {
      const status = estagio.status.trim();
      if (!status) continue;
      const chave = status.toLowerCase();
      if (vistos.has(chave)) continue;
      vistos.set(chave, { status, type: estagio.type, peso: PESO_DO_TIPO[estagio.type ?? ''] ?? 1, ordem: vistos.size });
    }
  }
  return [...vistos.values()].sort((a, b) => a.peso - b.peso || a.ordem - b.ordem).map(({ status, type }) => ({ status, type }));
}

/**
 * ESTÁGIOS TIRADOS DAS PRÓPRIAS TAREFAS (14/10/2026, pedido da operação: "se
 * não tiver o status, puxe o estágio e configure a pipeline sozinha"). Usado
 * quando a lista não devolve o próprio fluxo.
 */
export function estagiosDasTarefas(tasks: ReadonlyArray<{ status: string | null; statusType?: string | null }>): EstagioDoClickUp[] {
  return juntarFluxos([tasks.filter((t) => t.status).map((t) => ({ status: t.status!, type: t.statusType ?? null }))]);
}

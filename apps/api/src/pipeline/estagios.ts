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

/**
 * ESTÁGIOS TIRADOS DAS PRÓPRIAS TAREFAS (14/10/2026, pedido da operação: "se
 * não tiver o status, puxe o estágio e configure a pipeline sozinha").
 *
 * Quando a lista não devolve status (ClickUp herda o workflow da pasta ou do
 * espaço e às vezes responde vazio) ou quando o quadro é "atribuídas a mim"
 * (tarefas de várias listas, sem uma lista dona), os status reais são os que
 * as tarefas carregam. Ordem: aberto primeiro, os do meio na ordem em que
 * apareceram, fechado por último — a mesma leitura da esquerda pra direita
 * que um quadro do ClickUp tem.
 */
export function estagiosDasTarefas(tasks: ReadonlyArray<{ status: string | null; statusType?: string | null }>): string[] {
  const peso = (tipo: string | null | undefined) => (tipo === 'open' ? 0 : tipo === 'closed' || tipo === 'done' ? 2 : 1);
  const vistos = new Map<string, { status: string; peso: number; ordem: number }>();
  for (const task of tasks) {
    const status = task.status?.trim();
    if (!status) continue;
    const chave = status.toLowerCase();
    if (!vistos.has(chave)) vistos.set(chave, { status, peso: peso(task.statusType), ordem: vistos.size });
  }
  return [...vistos.values()].sort((a, b) => a.peso - b.peso || a.ordem - b.ordem).map((v) => v.status);
}

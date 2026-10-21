import { tarefaConcluida } from '@desigual-os/types';

/** A regra da tarefa concluída mora em @desigual-os/types (servidor e tela contam igual). */
export { tarefaConcluida, tarefaEmAndamento } from '@desigual-os/types';

/**
 * ETAPA CONCLUÍDA de um quadro do Pipeline. Quadro de colunas livres (o
 * "Tarefas", criado a partir dos status do ClickUp) tem a etapa "pronto" sem
 * `categoria`; olhar só a categoria deixava o cartão ali em vermelho
 * ("atrasado") assim que o sync trouxesse o prazo. A etapa é concluída se a
 * categoria diz, ou se o status do ClickUp que ela representa (ou, sem ele, o
 * nome) é de concluída.
 */
export function estagioConcluido(stage: {
  categoria?: string | null;
  clickupStatus?: string | null;
  label?: string | null;
}): boolean {
  if (stage.categoria === 'concluido') return true;
  if (stage.categoria) return false;
  return tarefaConcluida({ status: stage.clickupStatus ?? stage.label ?? '' });
}

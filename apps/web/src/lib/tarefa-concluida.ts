/**
 * TAREFA CONCLUÍDA — uma regra só para todas as telas.
 *
 * No ClickUp da agência (conferido em 20/10/2026, listas Cosentino e Elite):
 *   aberto (open) · aguardando aprovação · alteração · reprovado (custom)
 *   pronto (done) · encerrado (closed)
 *
 * As telas checavam só `closed`, e tudo que estava "pronto" (done) contava
 * como aberto e, com prazo vencido, como ATRASADO. Concluída é done OU closed.
 * O nome entra só quando o tipo não vem (evento de webhook traz só o nome).
 */
const NOME_DE_CONCLUIDA = /^(pronto|encerrad[oa]|conclu[ií]d[oa]|finalizad[oa]|entregue|done|closed|complete)$/i;

export function tarefaConcluida(t: { status_type?: string | null; status?: string | null }): boolean {
  if (t.status_type === 'done' || t.status_type === 'closed') return true;
  if (t.status_type) return false;
  return NOME_DE_CONCLUIDA.test((t.status ?? '').trim());
}

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


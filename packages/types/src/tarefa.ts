/**
 * TAREFA CONCLUÍDA — uma regra só, para a tela E para o servidor (o painel da
 * gestão conta atrasos no servidor; se cada lado tivesse a sua regra, os
 * números da gestão e os da tela de Tarefas divergiriam).
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
 * Tarefa EM ANDAMENTO (alguém está mexendo nela agora), pelo nome do status.
 * No ClickUp da agência os estados intermediários são personalizados
 * ("alteração", "aguardando aprovação"); "aberto" é o que ainda não começou.
 */
const NOME_EM_ANDAMENTO = /(andamento|fazendo|produ[cç][aã]o|progress|execu[cç][aã]o|altera[cç][aã]o|revis[aã]o|aguardando|aprova[cç][aã]o|doing)/i;

export function tarefaEmAndamento(t: { status_type?: string | null; status?: string | null }): boolean {
  if (tarefaConcluida(t)) return false;
  return NOME_EM_ANDAMENTO.test((t.status ?? '').trim());
}

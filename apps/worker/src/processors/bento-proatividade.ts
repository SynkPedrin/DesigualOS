/**
 * bento-proatividade.ts — o que o Bento VIU e não foi perguntado.
 *
 * Pedido da operação em 28/09/2026: "um pouco mais de proatividade". A
 * tentação óbvia seria deixar o agente completar o que falta sozinho —
 * escolher responsável, arrumar prazo, decidir prioridade. Isso não é
 * proatividade, é escrita não pedida, e é exatamente o que todo o resto deste
 * sistema foi construído pra impedir.
 *
 * Proatividade aqui é OUTRA coisa: o agente já tem a task relida na mão depois
 * de escrever, e hoje joga fora tudo que não foi perguntado. Se a task nasceu
 * sem responsável, com prazo no sábado ou já vencida, quem pediu vai descobrir
 * na segunda-feira. Dizer na hora custa zero — nenhuma chamada nova, nenhum
 * campo tocado — e é a diferença entre um executor e um colega.
 *
 * Três regras que sustentam isso:
 *
 *   1. Só dado JÁ na mão. Nada aqui dispara leitura nova: a latência do turno
 *      não paga por observação.
 *   2. Nunca afirma ação. Toda linha descreve o estado ou oferece; nenhuma diz
 *      que fez. Oferta sem execução é o contrato.
 *   3. No máximo duas linhas. Aviso demais vira ruído, e ruído é ignorado —
 *      inclusive o aviso que importava.
 */

import type { TaskDetail } from '@desigual-os/tool-gateway';

const DIA_MS = 86_400_000;

function ehFimDeSemana(epochMs: number): 'sábado' | 'domingo' | null {
  const dia = new Date(epochMs).getDay();
  return dia === 6 ? 'sábado' : dia === 0 ? 'domingo' : null;
}

function dataBR(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/** Meia-noite de hoje: prazo "hoje" não está vencido, prazo "ontem" está. */
function hojeZero(agora: Date): number {
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime();
}

export interface ContextoProativo {
  /**
   * Task recém-criada ou recém-alterada, JÁ RELIDA. Parcial de propósito no
   * tipo: a observação é um bônus e NUNCA pode derrubar uma escrita que deu
   * certo — campo ausente significa "não tenho o que dizer sobre ele", não
   * exceção no meio de uma criação bem-sucedida.
   */
  task: Partial<TaskDetail> | null;
  /**
   * true quando a resposta JÁ perguntou sobre o responsável — porque o nome que
   * a pessoa deu não resolveu, e a pergunta de lá é melhor ("não encontrei o
   * Guilherme, achei o Gui, é ele?"). Sem isto a resposta dizia as duas coisas
   * seguidas, e repetir a mesma pergunta com menos informação faz o Bento
   * parecer que não sabe o que acabou de falar.
   */
  jaPerguntouResponsavel?: boolean;
  /** Campos que o briefing não conseguiu preencher — já são ditos à parte. */
  lacunasJaDitas?: string[];
  agora?: Date;
}

/**
 * Observações sobre a task que ninguém pediu e todo mundo quer saber.
 * Devolve no máximo duas, em ordem de consequência.
 */
export function observacoesProativas(ctx: ContextoProativo): string[] {
  const t = ctx.task;
  if (!t) return [];
  const agora = ctx.agora ?? new Date();
  const obs: string[] = [];

  // 1. PRAZO VENCIDO é o de maior consequência: a task nasce/fica atrasada e
  //    ninguém percebe até a cobrança do cliente.
  const prazo = typeof t.dueDate === 'number' ? t.dueDate : null;
  const responsaveis = Array.isArray(t.assignees) ? t.assignees : null;

  if (prazo !== null && prazo < hojeZero(agora)) {
    obs.push(`⚠️ O prazo dessa task já passou (${dataBR(prazo)}) — ela entra como atrasada.`);
  } else if (prazo !== null) {
    const fds = ehFimDeSemana(prazo);
    if (fds) obs.push(`⚠️ O prazo caiu num ${fds} (${dataBR(prazo)}). Quer que eu jogue pro dia útil seguinte?`);
  }

  // 2. SEM RESPONSÁVEL: a task existe e não é de ninguém. É o modo mais comum
  //    de uma demanda sumir — está no ClickUp, então "está resolvida".
  //    `jaPerguntouResponsavel` existe porque a criação já faz essa pergunta,
  //    com mais informação ("achei o Gui, é ele?"), e dizer a mesma coisa duas
  //    vezes na mesma resposta faz o Bento parecer que não sabe o que já falou.
  if (responsaveis !== null && responsaveis.length === 0 && !ctx.jaPerguntouResponsavel) {
    obs.push('👤 Ficou sem responsável. Me diz de quem é que eu atribuo.');
  }

  // 3. SEM PRAZO, e só quando não há nada mais grave a dizer.
  if (obs.length === 0 && prazo === null && 'dueDate' in t) {
    obs.push('📅 Está sem prazo. Se tiver data, me fala que eu coloco.');
  }

  return obs.slice(0, 2);
}

/**
 * Observação sobre o PEDIDO, não sobre a task — serve ao update, onde reler a
 * task custaria uma chamada a mais no turno. O que dá pra ver sem rede:
 * alguém marcou prazo pra trás, ou tirou o último responsável.
 */
export function observacoesDoPedido(params: {
  dueDateMs?: number | null;
  removeuResponsavel?: boolean;
  agora?: Date;
}): string[] {
  const agora = params.agora ?? new Date();
  const obs: string[] = [];
  if (params.dueDateMs != null) {
    if (params.dueDateMs < hojeZero(agora)) {
      obs.push(`⚠️ Esse prazo (${dataBR(params.dueDateMs)}) é anterior a hoje — a task fica atrasada.`);
    } else {
      const fds = ehFimDeSemana(params.dueDateMs);
      if (fds) obs.push(`⚠️ ${dataBR(params.dueDateMs)} é ${fds}. Quer o dia útil seguinte?`);
    }
  }
  if (params.removeuResponsavel) {
    obs.push('👤 A task ficou sem responsável. Quer que eu passe pra alguém?');
  }
  return obs.slice(0, 2);
}

/** Diferença de um dia útil pra frente, pro caso de a pessoa aceitar a oferta. */
export function proximoDiaUtil(epochMs: number): number {
  let d = epochMs;
  while (ehFimDeSemana(d)) d += DIA_MS;
  return d;
}

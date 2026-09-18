import type { AgentName } from '@desigual-os/types';

/**
 * recent-dialogue.ts — O TURNO ANTERIOR, e só ele.
 *
 * O bug que isto mata, medido no aceite pelo frontend (18/09/2026): o Otto
 * escreveu três títulos e, no turno seguinte, respondeu "Sem contexto anterior
 * no turno, não sei a qual 'segundo' você se refere". O diálogo estava no
 * banco; nunca chegava ao node.
 *
 * Três pontos de perda, todos confirmados por trace:
 *   1. `ExecuteRequest` não tem campo de diálogo;
 *   2. `contextoGeralVaiNaMensagem` é false para Otto e Bento — e era ele que
 *      carregava histórico;
 *   3. o ContextPack do worker não tinha fonte de diálogo.
 *
 * O ponto 2 foi uma correção DELIBERADA de 17/09 contra envenenamento de
 * contexto: o bloco geral despejava dossiê, lista de tarefas e id de lista
 * dentro de um pedido criativo, e a resposta operacional de um turno virava o
 * enquadramento do turno seguinte. Essa proteção não pode voltar atrás.
 *
 * Por isso aqui o diálogo é um CANAL PRÓPRIO, estreito e limpo:
 *   - só a mesma conversa, em ordem cronológica;
 *   - poucos turnos, com teto de caracteres;
 *   - encanamento operacional removido quando o agente é criativo;
 *   - NUNCA evidência: é o que já foi dito, não uma fonte que sustenta fato.
 *
 * A separação que o produto exige é essa: mensagem do usuário, diálogo
 * recente, contexto de cliente e dado operacional são quatro coisas
 * diferentes, e misturá-las foi o que quebrou os dois lados.
 */

export interface TurnoDeDialogo {
  role: 'user' | 'assistant';
  agent: string | null;
  content: string;
}

export interface OrcamentoDeDialogo {
  /** Quantos turnos, no máximo. Referente vive nos últimos, não no histórico. */
  maxTurnos: number;
  /** Teto do bloco inteiro. */
  maxChars: number;
  /** Teto por turno, pra uma resposta longa não engolir as outras. */
  maxCharsPorTurno: number;
}

/**
 * Seis turnos e 1800 caracteres.
 *
 * O número saiu do que o referente exige, não de um palpite: "o segundo",
 * "essa versão", "as duas primeiras" apontam para o turno anterior ou o
 * anterior a ele. Seis cobre três trocas completas — pergunta, resposta,
 * ajuste — que é o tamanho de uma conversa de trabalho antes de mudar de
 * assunto. O teto de 1800 mantém o bloco menor que o piso do dossiê (2500),
 * então ele nunca vira o maior pedaço do prompt: continuidade é para resolver
 * referência, não para reescrever o enquadramento do turno.
 */
export const ORCAMENTO_DIALOGO: OrcamentoDeDialogo = {
  maxTurnos: 6,
  maxChars: 1_800,
  maxCharsPorTurno: 600,
};

/** Marcadores de bloco operacional injetado — nunca são fala de ninguém. */
const BLOCO_OPERACIONAL = /(DADOS AO VIVO DO CLICKUP|BRIEFING MONTADO COM DADO AO VIVO|ESTES N[ÚU]MEROS S[ÃA]O|CONTEXTO DO CLIENTE|---\nContexto:)/i;

/** Encanamento que não é conversa: id interno, rastro de ferramenta, payload. */
const ENCANAMENTO: Array<[RegExp, string]> = [
  [/\bexecution[_ ]?id[:=]?\s*\S+/gi, ''],
  [/\bEXE-\d{4}-[A-Z0-9]+/g, ''],
  [/\blist[_ ]?id[:=]?\s*\d+/gi, ''],
  [/\btask[_ ]?id[:=]?\s*[a-z0-9]+/gi, ''],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, ''],
];

/** Referência a task do ClickUp: material legítimo pro Bento, ruído pro Otto. */
const LINK_DE_TASK = /https?:\/\/app\.clickup\.com\/t\/[a-z0-9]+/gi;

/**
 * Quem NÃO pode receber encanamento operacional no diálogo.
 *
 * O Otto é criativo: nome de task no prompt vira candidato a título — foi
 * exatamente assim que "me dá 3 títulos" devolveu nome de tarefa. Para o
 * Bento, a mesma informação é o trabalho dele, e "a task que você acabou de
 * criar" só resolve se o link estiver lá.
 */
function ehAgenteCriativo(agente: AgentName | string): boolean {
  return agente === 'otto';
}

function limpar(texto: string, agente: AgentName | string): string {
  let t = texto;
  for (const [re, sub] of ENCANAMENTO) t = t.replace(re, sub);
  if (ehAgenteCriativo(agente)) t = t.replace(LINK_DE_TASK, '');
  return t.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function cortar(texto: string, teto: number): string {
  if (texto.length <= teto) return texto;
  return `${texto.slice(0, teto - 1).trimEnd()}…`;
}

/**
 * Monta o bloco de diálogo recente. Devolve '' quando não há nada útil — e
 * bloco vazio não entra no pacote, que é o que garante que uma conversa nova
 * não carregue nada.
 */
export function montarDialogoRecente(
  turnos: TurnoDeDialogo[],
  agente: AgentName | string,
  orcamento: OrcamentoDeDialogo = ORCAMENTO_DIALOGO,
): string {
  const uteis = turnos
    .map((t) => ({ ...t, content: (t.content ?? '').trim() }))
    .filter((t) => t.content.length > 0)
    // Bloco operacional injetado não é fala: para o criativo ele É o veneno
    // que a correção de 17/09 tirou do prompt.
    .filter((t) => !(ehAgenteCriativo(agente) && BLOCO_OPERACIONAL.test(t.content)))
    .map((t) => ({ ...t, content: limpar(t.content, agente) }))
    .filter((t) => t.content.length > 0);

  // Os ÚLTIMOS turnos, devolvidos em ordem cronológica: o referente está no
  // fim da conversa, mas o modelo precisa ler na ordem em que foi dito.
  const recortados = uteis.slice(-orcamento.maxTurnos);
  if (recortados.length === 0) return '';

  const linhas: string[] = [];
  let usado = 0;
  // De trás pra frente na hora de gastar o orçamento: se faltar espaço, quem
  // cai é o turno mais antigo, nunca o imediatamente anterior.
  for (let i = recortados.length - 1; i >= 0; i -= 1) {
    const t = recortados[i]!;
    const quem = t.role === 'user' ? 'Usuário' : `${(t.agent ?? 'assistente').replace(/^\w/, (c) => c.toUpperCase())}`;
    const corpo = cortar(t.content, orcamento.maxCharsPorTurno);
    const linha = `${quem}: ${corpo}`;
    if (usado + linha.length > orcamento.maxChars && linhas.length > 0) break;
    linhas.unshift(linha);
    usado += linha.length;
  }

  return [
    'CONVERSA RECENTE (para resolver referências como "o segundo", "essa versão", "as duas primeiras"; não é fonte de fato):',
    ...linhas,
  ].join('\n');
}

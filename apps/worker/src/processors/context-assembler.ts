/**
 * context-assembler.ts — o que entra no prompt, em que ordem, e até onde.
 *
 * Antes daqui o turno montava um array de blocos e concatenava tudo. Funcionava
 * enquanto os blocos eram dois; com cliente, campanha, pessoas, episódios,
 * preferências e aviso de frescor, "concatenar tudo" vira despejo: o modelo
 * recebe muito e presta atenção no lugar errado — foi assim que um aprendizado
 * velho de avaliação ancorou um pedido no cliente errado.
 *
 * O ContextPack resolve isso com duas regras explícitas:
 *
 * 1. ORDEM POR AUTORIDADE. Entidade resolvida e aviso de frescor vêm antes de
 *    qualquer coisa recuperada por semelhança. Específico ganha de geral,
 *    recente ganha de antigo.
 *
 * 2. ORÇAMENTO COM PISO. Cada bloco tem um mínimo garantido; um bloco gordo
 *    não pode engolir o espaço de outro. Sem piso, o dossiê de um cliente
 *    grande zerava a campanha e as pessoas.
 */

/**
 * O bloco de contexto agora carrega PROVENIÊNCIA e diz se sustenta afirmação.
 *
 * A regra que este tipo codifica não é "tudo que entra no prompt vira
 * evidência" — isso seria errado, e transformaria instrução e pergunta do
 * usuário em lastro para o modelo se apoiar. A regra é mais estreita:
 *
 *   conteúdo FACTUAL, vindo de fonte autorizada, com proveniência,
 *   precisa ter evidência correspondente.
 *
 * Instrução, hipótese de planner, rascunho e texto gerado por agente entram no
 * prompt e NÃO são evidência. Task do ClickUp, registro de campanha, memória
 * validada e episódio datado são.
 */
export type FonteDeContexto =
  | 'frescor'
  /**
   * O que acabou de ser dito nesta conversa. Vem logo depois do frescor porque
   * é o que resolve o REFERENTE do turno ("o segundo", "essa versão") — sem
   * ele o agente pede de volta um contexto que já existe. Nunca é evidência.
   */
  | 'dialogo'
  | 'cliente'
  | 'campanha'
  | 'pessoas'
  | 'episodios'
  | 'preferencias'
  /** O que a equipe ENSINOU no chat. Ver ORDEM: entra por último de propósito. */
  | 'aprendizado';

export interface ProvenienciaDoBloco {
  /** 'clickup' | 'campaign.registry' | 'people.registry' | 'memory' | 'episode' | 'a2a' */
  sourceType: string;
  sourceId?: string | null;
  clientId?: string | null;
  sourceUpdatedAt?: Date | null;
  confidence?: number;
}

export interface BlocoDeContexto {
  fonte: FonteDeContexto;
  texto: string;
  /**
   * Este bloco pode sustentar uma afirmação do modelo?
   *
   * `false` para instrução, aviso e enquadramento — eles guiam a resposta mas
   * não são lastro. `true` exige `proveniencia`: sem fonte, não há o que citar.
   */
  evidenciavel?: boolean;
  proveniencia?: ProvenienciaDoBloco;
}

/** Registro de evidência nascido do MESMO bloco que foi ao prompt. */
export interface RegistroDeEvidencia {
  fonte: FonteDeContexto;
  sourceType: string;
  sourceId: string | null;
  clientId: string | null;
  confidence: number;
  /** O texto COMO FOI ENTREGUE ao modelo, já cortado pelo orçamento. */
  texto: string;
}

/**
 * Ordem = autoridade. Frescor primeiro porque muda como TUDO abaixo deve ser
 * lido; depois a identidade resolvida (cliente, campanha, pessoas), que é fato
 * consultado; por último o que é preferência e histórico.
 */
const ORDEM: FonteDeContexto[] = [
  'frescor',
  'dialogo',
  'cliente',
  'campanha',
  'pessoas',
  'episodios',
  'preferencias',
  /**
   * `aprendizado` por ÚLTIMO, e isso não é rebaixamento: é o contrário. As
   * fichas curadas congelam entre importações, e o que a equipe ensina no chat
   * é mais novo que elas. Vindo depois, corrige o que vier antes — é a regra de
   * produto que o CLAUDE.md já declara. O piso generoso abaixo garante que a
   * correção não seja justamente a parte cortada pelo orçamento.
   */
  'aprendizado',
];

/** Piso por bloco: garante que nenhum seja zerado por um vizinho grande. */
const PISO: Record<FonteDeContexto, number> = {
  frescor: 400,
  // Menor que o piso do dossiê de propósito: o diálogo resolve referência, não
  // reescreve o enquadramento do turno.
  dialogo: 1_200,
  cliente: 2_500,
  campanha: 1_500,
  pessoas: 600,
  episodios: 600,
  preferencias: 400,
  aprendizado: 900,
};

/** Teto total do pacote. Medido contra o node com dossiê rico + campanha ativa. */
export const ORCAMENTO_PADRAO = 14_000;

export interface ContextPack {
  texto: string;
  /**
   * Evidência gerada JUNTO com o prompt, a partir dos mesmos blocos e já com o
   * corte do orçamento aplicado. Nascer junto é o ponto: quando o prompt era
   * montado de um lado e a evidência do outro, o modelo recebia o fato e o
   * grounding não — e o agente era reprovado por usar o contexto que o próprio
   * sistema entregou (replan_exhausted, medido em 16/09/2026).
   */
  evidencias: RegistroDeEvidencia[];
  /** Quais fontes entraram, na ordem — vai pra observabilidade, não pro prompt. */
  fontes: FonteDeContexto[];
  /** Quanto cada fonte ocupou. Sem isto não dá pra saber quem está espremendo quem. */
  tamanhoPorFonte: Partial<Record<FonteDeContexto, number>>;
  totalChars: number;
  truncou: boolean;
}

function indice(f: FonteDeContexto): number {
  const i = ORDEM.indexOf(f);
  return i === -1 ? ORDEM.length : i;
}

/**
 * Monta o pacote. Reparte o orçamento reservando o piso das fontes ainda não
 * escritas, então a ordem de autoridade não faz a última chegar vazia.
 */
export function assembleContext(
  blocos: BlocoDeContexto[],
  orcamento = ORCAMENTO_PADRAO,
): ContextPack {
  const uteis = blocos.filter((b) => b.texto.trim().length > 0);
  if (uteis.length === 0) {
    return { texto: '', evidencias: [], fontes: [], tamanhoPorFonte: {}, totalChars: 0, truncou: false };
  }

  const ordenados = [...uteis].sort((a, b) => indice(a.fonte) - indice(b.fonte));
  const partes: string[] = [];
  const evidencias: RegistroDeEvidencia[] = [];
  const tamanhoPorFonte: Partial<Record<FonteDeContexto, number>> = {};
  const fontes: FonteDeContexto[] = [];
  let restante = orcamento;
  let truncou = false;

  ordenados.forEach((b, i) => {
    const pisoRestante = ordenados.slice(i + 1).reduce((s, x) => s + PISO[x.fonte], 0);
    const teto = Math.max(0, restante - pisoRestante);
    const texto = b.texto.trim();
    const cortado = texto.slice(0, teto);
    if (cortado.length === 0) return;
    if (cortado.length < texto.length) truncou = true;
    partes.push(cortado);
    tamanhoPorFonte[b.fonte] = cortado.length;
    fontes.push(b.fonte);
    restante -= cortado.length;

    // A evidência sai do MESMO texto cortado que foi ao prompt. Se o orçamento
    // cortou, o grounding vê exatamente o que o modelo viu — nem mais (o que
    // deixaria passar afirmação sem lastro entregue) nem menos (o que reprovaria
    // afirmação legítima).
    if (b.evidenciavel && b.proveniencia) {
      evidencias.push({
        fonte: b.fonte,
        sourceType: b.proveniencia.sourceType,
        sourceId: b.proveniencia.sourceId ?? null,
        clientId: b.proveniencia.clientId ?? null,
        confidence: b.proveniencia.confidence ?? 0.9,
        texto: cortado,
      });
    }
  });

  const texto = partes.join('\n\n');
  return { texto, evidencias, fontes, tamanhoPorFonte, totalChars: texto.length, truncou };
}

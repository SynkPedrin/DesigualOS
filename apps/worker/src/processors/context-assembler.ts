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

export type FonteDeContexto =
  | 'frescor'
  | 'cliente'
  | 'campanha'
  | 'pessoas'
  | 'episodios'
  | 'preferencias';

export interface BlocoDeContexto {
  fonte: FonteDeContexto;
  texto: string;
}

/**
 * Ordem = autoridade. Frescor primeiro porque muda como TUDO abaixo deve ser
 * lido; depois a identidade resolvida (cliente, campanha, pessoas), que é fato
 * consultado; por último o que é preferência e histórico.
 */
const ORDEM: FonteDeContexto[] = ['frescor', 'cliente', 'campanha', 'pessoas', 'episodios', 'preferencias'];

/** Piso por bloco: garante que nenhum seja zerado por um vizinho grande. */
const PISO: Record<FonteDeContexto, number> = {
  frescor: 400,
  cliente: 2_500,
  campanha: 1_500,
  pessoas: 600,
  episodios: 600,
  preferencias: 400,
};

/** Teto total do pacote. Medido contra o node com dossiê rico + campanha ativa. */
export const ORCAMENTO_PADRAO = 14_000;

export interface ContextPack {
  texto: string;
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
    return { texto: '', fontes: [], tamanhoPorFonte: {}, totalChars: 0, truncou: false };
  }

  const ordenados = [...uteis].sort((a, b) => indice(a.fonte) - indice(b.fonte));
  const partes: string[] = [];
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
  });

  const texto = partes.join('\n\n');
  return { texto, fontes, tamanhoPorFonte, totalChars: texto.length, truncou };
}

/**
 * natureza-do-cliente.ts — nem toda linha de `clients` é um cliente.
 *
 * A tabela `clients` virou, com o tempo, o registro de tudo que tem uma lista
 * no ClickUp. Em 29/09/2026 ela tinha 58 linhas ativas e três naturezas
 * misturadas, com consequência medida em resposta real ao usuário:
 *
 *   "teste" apareceu com 27 atrasadas e 27 sem responsável DENTRO do panorama
 *   da agência, ao lado de Cosentino e D. Carvalho. E "Agência Desigual"
 *   apareceu como cliente com 34 atrasadas.
 *
 * Quem lê aquilo para decidir o dia da equipe não tem como saber que 27 das
 * atrasadas são fixture de QA e que um dos "clientes" é a própria casa.
 *
 * ── AS TRÊS NATUREZAS, E POR QUE O TRATAMENTO É DIFERENTE ────────────────
 *
 *  FIXTURE — dado de teste. Sai de tudo que é operacional. Não é trabalho de
 *            ninguém e contá-lo distorce todo número que a equipe usa.
 *
 *  INTERNO — trabalho REAL da casa que não é de cliente: a própria agência,
 *            os produtos internos (Citável) e os projetos pessoais do dono.
 *            **NÃO é escondido.** Esconder trocaria um erro por outro pior:
 *            são 170 tarefas de trabalho que alguém precisa fazer. É
 *            SEPARADO, para o agente parar de chamar de cliente e para o
 *            "por cliente" não somar a casa com a carteira.
 *
 *  CLIENTE — o resto. Quem paga.
 *
 * ── POR QUE LISTA EXPLÍCITA E NÃO PADRÃO ESPERTO ─────────────────────────
 *
 * A tentação é casar /teste|qa|interno/ e pronto. Recusado: um padrão que
 * reclassifique um cliente PAGANTE em silêncio é muito pior que um fixture
 * vazando — o fixture alguém percebe olhando, o cliente sumido ninguém
 * percebe até ele reclamar. A lista é explícita, o teste trava as 51 linhas
 * que hoje são carteira, e o padrão entra só como rede de segurança estreita
 * para nomes que NINGUÉM daria a um cliente de verdade.
 */

export type NaturezaDaLinha = 'CLIENTE' | 'INTERNO' | 'FIXTURE';

function dobrar(nome: string): string {
  return (nome ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Fixture de QA, conferido linha a linha no banco em 29/09/2026. */
const FIXTURES = new Set([
  'teste',
  'cliente teste 7',
  'clinica teste fase 7',
  'lista qa',
  'cliente absolutamente inexistente zxq',
]);

/**
 * Trabalho da casa. Cada um com o motivo, porque daqui a seis meses
 * "por que a Agência Desigual não é cliente?" vai ser uma pergunta justa.
 */
const INTERNOS = new Set([
  // A própria agência: 170 tarefas de operação interna, site, processo.
  'agencia desigual',
  // Produto interno (o Citável), não conta contratada.
  'citavel enterprise',
  'case 0 endrigo almada citavel',
  // Pessoas viraram linha de cliente: projetos pessoais do dono e da família.
  'endrigo almada',
  'andre almada',
]);

/**
 * Rede de segurança ESTREITA: nome que ninguém daria a um cliente pagante.
 * Exige a palavra inteira, e é conferido por teste contra a carteira real —
 * se um cliente de verdade passar a casar aqui, o teste quebra antes do
 * cliente sumir de um relatório.
 */
const PADRAO_DE_FIXTURE = /(^| )(teste|test|qa|dummy|fixture|sandbox)( |$)/;

export function naturezaDoCliente(nome: string): NaturezaDaLinha {
  const chave = dobrar(nome);
  if (chave.length === 0) return 'CLIENTE';
  if (FIXTURES.has(chave) || PADRAO_DE_FIXTURE.test(chave)) return 'FIXTURE';
  if (INTERNOS.has(chave)) return 'INTERNO';
  return 'CLIENTE';
}

export function ehFixture(nome: string): boolean {
  return naturezaDoCliente(nome) === 'FIXTURE';
}

export function ehInterno(nome: string): boolean {
  return naturezaDoCliente(nome) === 'INTERNO';
}

export interface CarteiraSeparada<T> {
  /** Quem paga. É isto que significa "a carteira". */
  carteira: T[];
  /** Trabalho real da casa. Entra na operação, separado da carteira. */
  internos: T[];
  /** Dado de teste. Não entra em lugar nenhum operacional. */
  fixtures: T[];
}

/**
 * Separa as três naturezas preservando a ordem de entrada.
 *
 * Devolve os três conjuntos em vez de já filtrar porque quem chama precisa
 * PODER DECLARAR o que tirou: um número que encolhe sem explicação é a mesma
 * doença que esta separação existe para curar.
 */
export function separarCarteira<T extends { name: string }>(linhas: readonly T[]): CarteiraSeparada<T> {
  const r: CarteiraSeparada<T> = { carteira: [], internos: [], fixtures: [] };
  for (const linha of linhas) {
    const natureza = naturezaDoCliente(linha.name);
    if (natureza === 'FIXTURE') r.fixtures.push(linha);
    else if (natureza === 'INTERNO') r.internos.push(linha);
    else r.carteira.push(linha);
  }
  return r;
}

/**
 * O que entra numa pergunta OPERACIONAL: carteira + interno, fixture nunca.
 * O trabalho da casa conta como trabalho; o dado de teste não conta como nada.
 */
export function escopoOperacional<T extends { name: string }>(linhas: readonly T[]): T[] {
  return linhas.filter((l) => naturezaDoCliente(l.name) !== 'FIXTURE');
}

/**
 * output-contract.ts — o que foi PEDIDO, não só quão fundo responder.
 *
 * O turno do Otto tinha `depth` (fast/standard/deep) e nada que representasse o
 * ARTEFATO. Medido em 16/09/2026: "Me dá 3 títulos para um carrossel dos 70
 * anos da Elite" devolveu três legendas completas, cada uma com corpo, CTA e
 * hashtags. O conteúdo era bom e o pedido não foi atendido — e pra quem ia usar
 * aquilo num carrossel, três legendas valem menos que zero, porque agora
 * alguém precisa extrair o título de dentro de cada uma.
 *
 * A causa não é o modelo ser ruim: é que a única regra forte de formato no
 * prompt era a da legenda ("sai pronta pra colar"), então tudo tendia a virar
 * legenda. Faltava dizer o óbvio: título é uma linha.
 *
 * Isto NÃO é um regex que reescreve a resposta depois. É um contrato declarado
 * antes: o modelo continua livre pra pensar, e o que fica preso é só a forma do
 * entregável.
 */

export type ArtefatoPedido =
  | 'titulo'
  | 'headline'
  | 'legenda'
  | 'roteiro'
  | 'prompt'
  | 'email'
  | 'nome'
  | 'indefinido';

export interface ContratoDeSaida {
  artefato: ArtefatoPedido;
  /** Quantas peças. Null quando o pedido não diz. */
  quantidade: number | null;
}

const NUMERO_POR_EXTENSO: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5,
  seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
};

/**
 * Ordem importa: o mais específico primeiro. "roteiro de Reels" é roteiro,
 * ainda que a palavra Reels apareça perto de "post" no mesmo briefing.
 */
const FORMAS: Array<{ artefato: ArtefatoPedido; re: RegExp }> = [
  { artefato: 'roteiro', re: /\b(roteiros?|scripts?|storyboards?)\b/ },
  { artefato: 'prompt', re: /\bprompts?\b/ },
  { artefato: 'email', re: /\b(e-?mails?|newsletters?|disparos?)\b/ },
  { artefato: 'nome', re: /\b(nomes?|naming|batiza[rn]?|como chamar)\b/ },
  { artefato: 'headline', re: /\b(headlines?|chamadas?)\b/ },
  { artefato: 'titulo', re: /\b(titulos?|t[ií]tulos?)\b/ },
  { artefato: 'legenda', re: /\b(legendas?|captions?|posts?|stories|story)\b/ },
];

function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Quantidade pedida, por algarismo ou por extenso. */
function quantidadeDe(texto: string): number | null {
  const algarismo = /\b(\d{1,2})\b/.exec(texto);
  if (algarismo) {
    const n = Number(algarismo[1]);
    if (n >= 1 && n <= 20) return n;
  }
  for (const [palavra, n] of Object.entries(NUMERO_POR_EXTENSO)) {
    if (new RegExp(`\\b${palavra}\\b`).test(texto)) return n;
  }
  return null;
}

export function contratoDeSaida(mensagem: string): ContratoDeSaida {
  const t = normalizar(mensagem ?? '');
  const forma = FORMAS.find((f) => f.re.test(t));
  if (!forma) return { artefato: 'indefinido', quantidade: null };
  return { artefato: forma.artefato, quantidade: quantidadeDe(t) };
}

/**
 * Como cada artefato se parece quando está PRONTO. Descrição curta e física
 * ("uma linha", "não tem corpo"), porque é isso que separa um título de uma
 * legenda na prática — adjetivo de qualidade não separa nada.
 */
const FORMA_FINAL: Record<Exclude<ArtefatoPedido, 'indefinido'>, string> = {
  titulo: 'UMA LINHA cada, curta. Título não tem corpo de texto, não tem CTA e não tem hashtag.',
  headline: 'UMA LINHA cada, curta. Headline não tem corpo de texto, não tem CTA e não tem hashtag.',
  legenda: 'texto completo do post, em blocos separados por linha em branco, CTA em bloco próprio e hashtags na última linha.',
  roteiro: 'marcação de tempo e fala/ação, na ordem em que vai ser gravado. Quem grava precisa conseguir executar lendo.',
  prompt: 'o prompt em si, pronto pra colar no gerador, sem explicação no meio.',
  email: 'assunto em uma linha, corpo, e CTA. Pronto pra enviar.',
  nome: 'o nome, e embaixo UMA linha dizendo por que ele funciona.',
};

/**
 * Linha de contrato pro system prompt. Vazia quando o pedido não nomeia um
 * artefato: constranger formato que ninguém pediu seria trocar um erro por
 * outro.
 */
export function diretivaDoContrato(contrato: ContratoDeSaida): string {
  if (contrato.artefato === 'indefinido') return '';
  const forma = FORMA_FINAL[contrato.artefato];
  const quantos = contrato.quantidade;

  const linhas = [
    'CONTRATO DE SAÍDA DESTE TURNO (vale sobre qualquer regra de formato acima):',
    quantos
      ? `Foi pedido: ${quantos} ${contrato.artefato}(s). Entregue exatamente ${quantos}, numerados.`
      : `Foi pedido: ${contrato.artefato}. Entregue ${contrato.artefato}, e só isso.`,
    `Forma final: ${forma}`,
  ];

  if (contrato.artefato === 'titulo' || contrato.artefato === 'headline') {
    linhas.push(
      'NÃO devolva legenda, post completo, carrossel nem roteiro. Entregar mais do que foi pedido não é generosidade: quem recebeu vai ter que garimpar a linha que queria dentro do texto.',
    );
  }
  linhas.push('Comentário sobre as escolhas, se houver, vai num bloco ÚNICO depois da entrega — nunca no meio dela.');
  return linhas.join('\n');
}

/**
 * REVISÃO ELÍPTICA: o pedido que só existe por causa da peça anterior.
 *
 * "Tá com cara de IA", "faz de outro jeito", "uma versão pro cliente", "não
 * gostei" — nenhum nomeia artefato, e por isso `contratoDeSaida` devolve
 * indefinido e o turno fica sem contrato. Medido no navegador em 17/09/2026:
 * sem contrato, o modelo ia atrás do que o contexto tinha de mais concreto — a
 * lista de tarefas do ClickUp — e respondia com relatório operacional a um
 * pedido de reescrita.
 *
 * Contexto não é intenção. Quem pede "faz de outro jeito" está falando da peça,
 * não da conta.
 */
const REVISAO_ELIPTICA = [
  /\bcara de (?:ia|rob[ôo]|chatgpt)\b/i,
  /\b(?:t[áa]|ficou|parece) gen[ée]rico\b/i,
  /\bn[ãa]o gostei\b/i,
  /\bfaz(?:er)? de outro jeito\b/i,
  /\bde outro jeito\b/i,
  /\boutra vers[ãa]o\b/i,
  /\buma vers[ãa]o pro? cliente\b/i,
  /\bvers[ãa]o final\b/i,
  /\brefaz\b|\brefa[çc]a\b|\breescreve\b/i,
  /\bmelhora\b.{0,20}\bisso\b/i,
];

export function ehRevisaoEliptica(mensagem: string): boolean {
  const t = (mensagem ?? '').trim();
  // Pedido longo traz briefing próprio; não é continuação da peça anterior.
  if (t.length === 0 || t.length > 120) return false;
  return REVISAO_ELIPTICA.some((re) => re.test(t));
}

/**
 * Bloco que diz ao turno: isto continua a peça anterior. Entra no topo do
 * contexto porque é o que decide o que entregar — e sem ele a resposta vira
 * status de conta.
 */
export function blocoDeContinuacaoCriativa(artefatoAnterior: ArtefatoPedido): string {
  if (artefatoAnterior === 'indefinido') return '';
  return [
    `CONTINUAÇÃO CRIATIVA: o turno anterior entregou ${artefatoAnterior}. Este pedido é sobre ELA.`,
    `Entregue ${artefatoAnterior} de novo, reescrita — não um resumo, não um status da conta, não uma lista de tarefas.`,
    'Se a crítica foi "genérico" ou "cara de IA", mude o ÂNGULO, não as palavras: outra tensão, outro ponto de entrada, outra imagem. Trocar sinônimo não é refazer.',
    'O texto reescrito vem primeiro. Comentário sobre a mudança, se houver, vai depois dele.',
  ].join('\n');
}

/**
 * ESTE TURNO DEPENDE DO ESTADO ATUAL DA OPERAÇÃO?
 *
 * O aviso de frescor ("a sincronização com o ClickUp está atrasada") é o
 * primeiro bloco do contexto e vem em caixa alta. Isso está certo quando a
 * pergunta é sobre prazo, pendência ou responsável — ali um dado velho leva a
 * pessoa a agir errado.
 *
 * Num pedido criativo é ruído, e ruído no topo vira resposta. Medido no
 * navegador em 17/09/2026: "me dá 3 títulos", "tá com cara de IA" e "faz de
 * outro jeito" voltaram todos abrindo com "o dado está atrasado, eventos foram
 * perdidos" — e sem a peça. A integração degradada não impede escrever uma
 * legenda; ela impede afirmar o que está aberto hoje.
 *
 * Na dúvida, TRUE: manter o aviso é o lado seguro. O que não pode é ele
 * aparecer quando ninguém perguntou do estado da operação.
 */
const DEPENDE_DO_AGORA = [
  /\boperacionalmente\b/i,
  /\bstatus\b/i,
  /\bprazos?\b/i,
  /\bvence\b|\bvencem\b|\bvencendo\b/i,
  /\bpendente|pend[êe]ncia/i,
  /\batrasad/i,
  /\brespons[áa]ve(l|is)\b/i,
  /\bo que mudou\b/i,
  /\bcomo (?:est[áa]|ta|anda)\b/i,
  /\btarefas?\b|\btasks?\b/i,
  /\bentregas?\b/i,
  /\bagora\b|\bhoje\b|\bontem\b/i,
  /\bclickup\b/i,
];

export function exigeFrescorOperacional(mensagem: string): boolean {
  return DEPENDE_DO_AGORA.some((re) => re.test(mensagem ?? ''));
}

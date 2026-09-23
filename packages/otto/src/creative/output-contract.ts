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
  /**
   * Outros artefatos pedidos NO MESMO turno, além do principal. Só existe
   * quando o pedido nomeia um segundo artefato explicitamente conectado ao
   * primeiro ("... e uma legenda ...") — ver `artefatosAdicionais`.
   */
  adicionais?: Array<Exclude<ArtefatoPedido, 'indefinido'>>;
}

const NUMERO_POR_EXTENSO: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5,
  seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
};

/**
 * Ordem importa: o mais específico primeiro. "roteiro de Reels" é roteiro,
 * ainda que a palavra Reels apareça perto de "post" no mesmo briefing.
 */
const FORMAS: Array<{ artefato: Exclude<ArtefatoPedido, 'indefinido'>; re: RegExp }> = [
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

/**
 * SEGUNDO ENTREGÁVEL, quando o pedido nomeia um explicitamente — não pela
 * simples presença de uma segunda palavra da lista FORMAS (isso reabriria o
 * bug que "roteiro vence post na mesma frase" corrigiu: "roteiro pro post de
 * Reels" tem 'post', mas é sinônimo solto do MESMO roteiro, não um segundo
 * pedido).
 *
 * O sinal de segundo pedido é a conjunção: "... e uma legenda ...", "...
 * além de um título ...". Sem conector, é ruído do mesmo entregável.
 *
 * Bug real medido (regressão Jardim Europa V, 22/09/2026): "quero um
 * roteiro ... e uma legenda complementar bem escrita" tinha os dois
 * entregáveis pedidos de forma explícita e conectada, e a versão anterior
 * desta função devolvia só 'roteiro', com uma diretiva que dizia "entregue
 * roteiro, e só isso" — contradizendo a REGRA 2 do CHAT_SYSTEM_PROMPT
 * (entregar todos os entregáveis pedidos) e sobrepondo ela, já que o
 * contrato "vale sobre qualquer regra de formato acima".
 */
function artefatosAdicionais(
  textoNormalizado: string,
  principal: ArtefatoPedido,
): Array<Exclude<ArtefatoPedido, 'indefinido'>> {
  const encontrados: Array<Exclude<ArtefatoPedido, 'indefinido'>> = [];
  for (const forma of FORMAS) {
    if (forma.artefato === principal) continue;
    const corpo = forma.re.source.replace(/^\\b/, '').replace(/\\b$/, '');
    const conectado = new RegExp(`\\b(?:e|al[ée]m de)\\s+(?:um|uma|o|a)?\\s*${corpo}`);
    if (conectado.test(textoNormalizado)) encontrados.push(forma.artefato);
  }
  return encontrados;
}

export function contratoDeSaida(mensagem: string): ContratoDeSaida {
  const t = normalizar(mensagem ?? '');
  const forma = FORMAS.find((f) => f.re.test(t));
  if (!forma) return { artefato: 'indefinido', quantidade: null };
  const adicionais = artefatosAdicionais(t, forma.artefato);
  return {
    artefato: forma.artefato,
    quantidade: quantidadeDe(t),
    ...(adicionais.length > 0 ? { adicionais } : {}),
  };
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
  const artefatoPrincipal = contrato.artefato;
  const forma = FORMA_FINAL[artefatoPrincipal];
  const quantos = contrato.quantidade;
  const adicionais = contrato.adicionais ?? [];

  const linhas = ['CONTRATO DE SAÍDA DESTE TURNO (vale sobre qualquer regra de formato acima):'];

  if (adicionais.length > 0) {
    // Mais de um entregável nomeado no mesmo pedido: a REGRA 2 do prompt de
    // chat já manda entregar todos, e o contrato não pode contradizer isso
    // travando num artefato só. Cada um ganha a própria forma final.
    const todos: Array<Exclude<ArtefatoPedido, 'indefinido'>> = [artefatoPrincipal, ...adicionais];
    linhas.push(
      `Foi pedido MAIS DE UM entregável: ${todos.join(', ')}. Entregue TODOS, cada um com seu próprio título — entregar só um deles é não entregar o pedido.`,
      ...todos.map((a) => `Forma final de ${a}: ${FORMA_FINAL[a]}`),
    );
  } else {
    linhas.push(
      quantos
        ? `Foi pedido: ${quantos} ${contrato.artefato}(s). Entregue exatamente ${quantos}, numerados.`
        : `Foi pedido: ${contrato.artefato}. Entregue ${contrato.artefato}, e só isso.`,
      `Forma final: ${forma}`,
    );
    if (contrato.artefato === 'titulo' || contrato.artefato === 'headline') {
      linhas.push(
        'NÃO devolva legenda, post completo, carrossel nem roteiro. Entregar mais do que foi pedido não é generosidade: quem recebeu vai ter que garimpar a linha que queria dentro do texto.',
      );
    }
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
export function blocoDeContinuacaoCriativa(artefatoAnterior: ArtefatoPedido, pecaAnterior?: string): string {
  if (artefatoAnterior === 'indefinido') return '';
  const linhas = [
    `CONTINUAÇÃO CRIATIVA: o turno anterior entregou ${artefatoAnterior}. Este pedido é sobre ELA.`,
  ];
  /**
   * A PEÇA ANTERIOR, literal. Sem ela "tá com cara de IA" não tem o que
   * reescrever — o modelo só sabe que houve uma legenda, não qual. Até
   * 17/09/2026 esse texto chegava só pelo bloco de contexto que a API
   * concatenava na mensagem, junto com dossiê e ClickUp; trazê-lo por aqui é o
   * que permite fechar aquele caminho sem perder a continuidade.
   *
   * Cortada: o que importa pra reescrever é o ângulo e a abertura, não o texto
   * inteiro ocupando o lugar do resto do contexto.
   */
  if (pecaAnterior && pecaAnterior.trim().length > 0) {
    linhas.push('', 'O QUE VOCÊ ENTREGOU NO TURNO ANTERIOR (é isto que está sendo criticado):', pecaAnterior.trim().slice(0, 1200), '');
  }
  linhas.push(
    `Entregue ${artefatoAnterior} de novo, reescrita — não um resumo, não um status da conta, não uma lista de tarefas.`,
    'Se a crítica foi "genérico" ou "cara de IA", mude o ÂNGULO, não as palavras: outra tensão, outro ponto de entrada, outra imagem. Trocar sinônimo não é refazer.',
    'O texto reescrito vem primeiro. Comentário sobre a mudança, se houver, vai depois dele.',
  );
  return linhas.join('\n');
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
  /\bclickup\b/i,
];

/**
 * "Agora faz uma legenda" não pede estado da operação: ali "agora" é marcador
 * de discurso, não referência temporal. Medido — com `agora` na lista acima, o
 * turno virava MISTO e o contexto operacional voltava inteiro pro pedido
 * criativo. Palavra de tempo só conta quando vem acompanhada de algo
 * operacional de verdade.
 */
const TEMPO_SOZINHO = /\b(hoje|ontem|agora|amanh[ãa])\b/i;
const COISA_OPERACIONAL = /\b(tarefas?|tasks?|entregas?|prazos?|pend[êe]ncias?|aprova[çc][ãa]o|status|atrasad)/i;

export function exigeFrescorOperacional(mensagem: string): boolean {
  const t = mensagem ?? '';
  if (DEPENDE_DO_AGORA.some((re) => re.test(t))) return true;
  return TEMPO_SOZINHO.test(t) && COISA_OPERACIONAL.test(t);
}

/**
 * QUANTIDADE DE SLIDES DE CARROSSEL (Otto Senior V1, "Universal Quality
 * Floor" — Section 9). Achado ao vivo real: pedido explícito de "8 slides"
 * devolveu 10, porque `planCarousel` era chamado com a contagem HARDCODED
 * em execute.ts, nunca lendo o que o usuário pediu. Deliberadamente
 * separado de `contratoDeSaida`/`quantidadeDe`: aquele mecanismo só extrai
 * quantidade quando já identificou QUAL artefato está sendo quantificado
 * (titulo/headline/legenda/roteiro), e "carrossel"/"slides" nunca foi um
 * `ArtefatoPedido` reconhecido ali — ensinar isso ao contrato geral
 * arriscaria mudar comportamento já testado (35 casos) pra um problema
 * que é só do carrossel. Aceita "N slides", "N cards", "carrossel de N".
 */
const SLIDE_COUNT_PATTERN = /\b(\d{1,2})\s*(?:slides?|cards?)\b|\bcarross[eé]l\s+de\s+(\d{1,2})\b/i;

export function parseRequestedSlideCount(mensagem: string): number | null {
  const match = SLIDE_COUNT_PATTERN.exec(mensagem ?? '');
  if (!match) return null;
  const n = Number(match[1] ?? match[2]);
  return n >= 1 && n <= 20 ? n : null;
}

/**
 * Classificador de PROFUNDIDADE do turno do Otto: decide, de forma
 * determinística e sem custo, quanto trabalho o pedido merece antes de
 * gastar retrieval e tokens de geração.
 *
 * Por que léxico e não um LLM: a decisão precisa ser mais barata que a coisa
 * que ela evita. No Mac mini do Otto (qwen3.5:4b em CPU) a geração roda a
 * ~10 tokens/s, então QUALQUER chamada de modelo pra "só decidir a
 * profundidade" custaria dezenas de segundos - mais que o turno FAST inteiro
 * que ela deveria acelerar. Aqui a classificação custa microssegundos
 * (medido: <0,05 ms), é auditável (devolve os sinais que casaram) e é
 * testável sem rede.
 *
 * Os três níveis vêm do pedido do dono:
 *   FAST     copy curta, headline, uma ideia, CTA, correção pequena
 *   STANDARD briefing, campanha, conceito criativo
 *   DEEP     reposicionamento, branding, estratégia completa
 *
 * O que a profundidade controla (ver depthPolicy): quantos docs do Brain
 * entram no prompt, o tamanho do snippet de cada um e se o subvault pesado
 * STUDIO-BRAIN participa da busca. Ou seja, profundidade aqui significa
 * QUANTO CONTEXTO, não quanto tempo o modelo fica pensando sozinho - o
 * raciocínio interno é suprimido nos três níveis, por medição (ver
 * DepthPolicy.suppressThinking).
 */

export type RetrievalDepth = 'fast' | 'standard' | 'deep';

export interface DepthDecision {
  depth: RetrievalDepth;
  /** Cues que casaram, na ordem em que foram avaliados. Vai pro log/metadata. */
  signals: string[];
  /** Regra que decidiu, pra auditoria honesta ("por que este turno foi DEEP?"). */
  reason: 'deep_cue' | 'fast_cue' | 'standard_cue' | 'short_message' | 'default';
}

export interface DepthPolicy {
  /** Quantos docs do Brain entram no prompt. */
  maxDocs: number;
  /** Tamanho do trecho de cada doc. Menos texto = menos prompt eval. */
  snippetLength: number;
  /**
   * Se o subvault STUDIO-BRAIN (155 dos 161 docs, engine de geração) entra na
   * busca. Fora do FAST porque, pra "me dá uma headline", doc de ComfyUI e
   * peça de OUTRO cliente competem com o doc de marketing que importa - foi
   * exatamente o que poluiu a resposta na medição de baseline.
   */
  includeStudioBrain: boolean;
  /**
   * Manda `think: false` pro Ollama. Este é o botão de maior impacto medido
   * no Otto: no mesmo prompt, mesmo modelo (qwen3.5:4b), o pedido de headline
   * saiu de 226,3s (1.724 tokens, 6.409 chars só de raciocínio interno) pra
   * 1,7s (27 tokens) com o raciocínio desligado - 136x. É o "pensa demais;
   * demora demais" do dono, literal.
   *
   * Vale pros TRÊS níveis, inclusive DEEP - e isso foi uma correção de rota
   * medida, não a intenção original. A primeira versão deixava o DEEP
   * raciocinar, com o argumento de que reposicionamento paga minutos de
   * raciocínio. Dois números mataram o argumento:
   *   1. O OTTO_LLM_TIMEOUT_MS de produção é 120s (default do schema em
   *      packages/otto/src/llm/config.ts, e o .env do node não sobrescreve).
   *   2. O turno DEEP com raciocínio ligado levou 337,6s no baseline e passou
   *      de 600s com a política DEEP mais rica (8 docs, snippet 600) antes de
   *      eu interromper a medição.
   * Ou seja: "DEEP com raciocínio" não é um tier lento, é um tier que ESTOURA
   * o timeout e devolve erro. Profundidade de verdade vem de mais contexto e
   * de estrutura de resposta exigida (ver creative/stance.ts), que é barato,
   * não de monólogo interno que o timeout mata no meio.
   *
   * O botão continua existindo no provider porque um caminho ASSÍNCRONO
   * futuro (job de background, onde 6 minutos são aceitáveis porque ninguém
   * está olhando o cursor piscar) é o lugar legítimo pra ligá-lo. Aí é só
   * mudar este campo pra false no nível DEEP.
   */
  suppressThinking: boolean;
}

export interface TurnDepthPlan extends DepthDecision {
  policy: DepthPolicy;
}

/**
 * O Orchestrator anexa contexto (histórico, aprendizados) depois deste
 * marcador. Classificar sobre o bloco inteiro faz um aprendizado antigo
 * ("Otto criou plano criativo...") decidir a profundidade de uma pergunta
 * nova - o mesmo bug que já tinha sido corrigido na detecção de intenção de
 * produção (ver nodes/otto-node/src/execute.ts).
 */
export const CONTEXT_BLOCK_MARKER = '\n\n---\nContexto:\n';

/** Recorta só o turno do usuário, sem o bloco de contexto do Orchestrator. */
export function stripOrchestratorContext(message: string): string {
  return message.split(CONTEXT_BLOCK_MARKER)[0] ?? message;
}

/**
 * O contrário: SÓ o contexto que o orquestrador anexou (cliente do turno,
 * campanha do turno, pessoas, preferências).
 *
 * Existe porque esse contexto vinha apenas na mensagem do usuário, enquanto o
 * conhecimento recuperado do vault ia para o SYSTEM PROMPT — e prompt de
 * sistema ganha de texto de usuário. Resultado medido em 16/09/2026: com
 * "campanha de aniversário do Jardim Europa 5" o orquestrador resolveu
 * corretamente Cosentino/Europa V, mandou tudo junto, e mesmo assim o node
 * escreveu para Top Tennis Club, que era o que a busca do vault dele havia
 * trazido. Entidade resolvida pelo orquestrador é FATO; trecho recuperado por
 * similaridade é palpite. O fato precisa estar onde manda mais.
 */
export function extractOrchestratorContext(message: string): string | null {
  const partes = message.split(CONTEXT_BLOCK_MARKER);
  if (partes.length < 2) return null;
  const contexto = partes.slice(1).join(CONTEXT_BLOCK_MARKER).trim();
  return contexto.length > 0 ? contexto : null;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Vocabulário de trabalho de MARCA INTEIRA. Deliberadamente estreito: cada
 * termo aqui compra o turno mais caro que o Otto tem (mais docs, snippet
 * maior, raciocínio ligado), então só entra o que não dá pra responder sem
 * a camada estratégica. "campanha institucional" ficou FORA de propósito -
 * co-ocorre demais com pedido pequeno ("uma headline pra campanha
 * institucional") e arrastaria o turno inteiro pro caro sem necessidade.
 */
const DEEP_CUES = [
  'reposicionamento',
  'reposicionar',
  'posicionamento',
  'rebranding',
  'branding',
  'arquitetura de marca',
  'plataforma de marca',
  'identidade visual',
  'identidade de marca',
  'manifesto de marca',
  'brand book',
  'naming',
  'proposito de marca',
  'go to market',
  'gtm',
  'estrategia completa',
  'estrategia anual',
  'planejamento anual',
  'plano anual',
  'funil completo',
  'auditoria de marca',
  'diagnostico de marca',
  'stp',
] as const;

/**
 * Entregável pequeno (artefato de copy curta) ou operação pequena (edição do
 * que já existe). Vem ANTES de STANDARD porque o que define o tamanho do
 * turno é o tamanho da ENTREGA, não o assunto citado: "troca o CTA desse
 * anúncio" fala de anúncio mas é uma linha de trabalho, não uma campanha.
 */
const FAST_CUES = [
  // artefatos curtos
  'headline',
  'manchete',
  'titulo',
  'chamada',
  'cta',
  'call to action',
  'legenda',
  'caption',
  'slogan',
  'assinatura',
  'hashtag',
  'bio',
  'subject line',
  'assunto do email',
  // operações pequenas
  'ajusta',
  'ajuste',
  'ajustar',
  'troca',
  'trocar',
  'corrige',
  'corrigir',
  'revisa',
  'revisar',
  'encurta',
  'encurtar',
  'reescreve',
  'reescrever',
  'reescrita',
  'mais curto',
  'mais curta',
  'uma ideia',
  'so uma',
  'variacao',
  'variacoes',
] as const;

/** Trabalho criativo de uma peça/campanha: o meio do caminho. */
const STANDARD_CUES = [
  'campanha',
  'briefing',
  'brief',
  'conceito',
  'carrossel',
  'carousel',
  'reels',
  'roteiro',
  'storyboard',
  'lancamento',
  'promocao',
  'calendario',
  'plano de conteudo',
  'linha criativa',
  'key visual',
  'direcao criativa',
  'oferta',
  'anuncio',
  'criativo',
  'criativos',
] as const;

/**
 * Sem NENHUM cue, mensagem curta é pedido pequeno ("e o que você acha
 * disso?", "obrigado", "manda outra"). 180 chars é o corte: acima disso o
 * texto já carrega briefing de verdade e merece a camada estratégica.
 */
const SHORT_MESSAGE_CHARS = 180;

/** Cues de uma palavra viram regex com fronteira; frase vira substring. */
function buildMatchers(cues: readonly string[]): { cue: string; test: (text: string) => boolean }[] {
  return cues.map((cue) => {
    if (cue.includes(' ')) {
      return { cue, test: (text: string) => text.includes(cue) };
    }
    // Fronteira de palavra evita que "bio" case em "biofit" e "cta" em
    // "espectador"; \b funciona porque o texto já foi normalizado pra ascii.
    const pattern = new RegExp(`\\b${cue}\\b`);
    return { cue, test: (text: string) => pattern.test(text) };
  });
}

const DEEP_MATCHERS = buildMatchers(DEEP_CUES);
const FAST_MATCHERS = buildMatchers(FAST_CUES);
const STANDARD_MATCHERS = buildMatchers(STANDARD_CUES);

function matched(matchers: { cue: string; test: (text: string) => boolean }[], text: string): string[] {
  return matchers.filter((matcher) => matcher.test(text)).map((matcher) => matcher.cue);
}

/**
 * Precedência: DEEP > FAST > STANDARD > tamanho.
 *
 * DEEP primeiro porque trabalho de marca inteira é raro e caro de errar: se
 * o vocabulário aparece, gastar retrieval é a aposta certa. FAST antes de
 * STANDARD porque entrega pequena é entrega pequena mesmo quando o pedido
 * menciona a campanha em volta dela.
 */
export function classifyRetrievalDepth(message: string): DepthDecision {
  const text = normalize(stripOrchestratorContext(message));

  const deep = matched(DEEP_MATCHERS, text);
  if (deep.length > 0) return { depth: 'deep', signals: deep, reason: 'deep_cue' };

  const fast = matched(FAST_MATCHERS, text);
  if (fast.length > 0) return { depth: 'fast', signals: fast, reason: 'fast_cue' };

  const standard = matched(STANDARD_MATCHERS, text);
  if (standard.length > 0) return { depth: 'standard', signals: standard, reason: 'standard_cue' };

  if (text.trim().length <= SHORT_MESSAGE_CHARS) {
    return { depth: 'fast', signals: [], reason: 'short_message' };
  }
  return { depth: 'standard', signals: [], reason: 'default' };
}

/**
 * Parâmetros por nível. Números escolhidos a partir do custo medido do
 * modelo local: prompt eval ~4,7 ms/token, geração ~94 ms/token. Ou seja,
 * cada doc do Brain no prompt (~500 chars => ~140 tokens) custa ~0,7s de
 * espera. 5 docs num pedido de headline eram ~3,3s de prompt gastos em
 * conhecimento que a resposta não usava - e, pior, competindo com o doc
 * certo.
 */
export function depthPolicy(depth: RetrievalDepth): DepthPolicy {
  switch (depth) {
    case 'fast':
      return { maxDocs: 2, snippetLength: 220, includeStudioBrain: false, suppressThinking: true };
    case 'standard':
      return { maxDocs: 4, snippetLength: 400, includeStudioBrain: true, suppressThinking: true };
    case 'deep':
      // Mais contexto, e ainda assim sem raciocínio interno: ver a nota em
      // DepthPolicy.suppressThinking pro porquê (o timeout de 120s de
      // produção não cabe um turno de raciocínio).
      return { maxDocs: 8, snippetLength: 600, includeStudioBrain: true, suppressThinking: true };
  }
}

/** Classificação + parâmetros num só objeto, que é o que o node consome. */
export function planTurnDepth(message: string): TurnDepthPlan {
  const decision = classifyRetrievalDepth(message);
  return { ...decision, policy: depthPolicy(decision.depth) };
}

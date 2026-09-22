import { createLogger } from '@desigual-os/logging';
import type { FastifyBaseLogger } from 'fastify';
import type { ExecuteRequest, ExecuteResponse } from '@desigual-os/node-protocol';
import { AGENT_PERSONALITIES } from '@desigual-os/types';
import {
  buildDirectionDirective,
  buildProductionSpec,
  checkBrainHealth,
  createCreativePlan,
  createOttoLLMProvider,
  depthPolicy,
  deriveCreativeDNA,
  loadBrainIndex,
  planCarousel,
  planTurnDepth,
  planVideo,
  retrieveRelevantKnowledge,
  runCreativePipeline,
  extractOrchestratorContext,
  stripOrchestratorContext,
  classificarTurno,
  resolverReferente,
  contratoDeSaida,
  diretivaDoContrato,
  createWebSearchProviderFromEnv,
  type BrainHealth,
  type BrandKit,
  type CarouselPlan,
  type CreativeDNA,
  type CreativeFeedback,
  type DepthPolicy,
  type OttoLLMProvider,
  type CreativeReference,
  type CreativeStateInput,
  type ResearchProvider,
  type RetrievedKnowledge,
  type RetrieveOptions,
  type StudioJobType,
  type TurnDepthPlan,
  type VideoPlan,
} from '@desigual-os/otto';
import type { OttoNodeConfig } from './config.js';
import { runtimeState } from './state.js';

/**
 * Dependências do pipeline do turno, injetáveis (mesmo padrão do
 * packages/otto: PlannerDeps/QualityDeps). Em produção vem de
 * createDefaultDeps; em teste, provider fake + retrieval apontado pra um
 * vault temporário, sem rede e sem Ollama.
 */
export interface OttoNodeDeps {
  llm: OttoLLMProvider;
  /**
   * Retrieval parametrizado pela profundidade do turno (ver
   * packages/otto/src/brain/depth.ts). As options não são opcionais aqui de
   * propósito: quem implementa esta porta precisa honrar a decisão de
   * profundidade, senão o classificador não muda nada de fato.
   */
  retrieveKnowledge: (query: string, options: RetrieveOptions) => RetrievedKnowledge[];
  brainHealth: () => BrainHealth;
  /**
   * Derivação do DNA criativo do cliente. Default: deriveCreativeDNA com a
   * lista de feedbacks que o chamador tiver - hoje SEMPRE vazia, porque o
   * node não acessa o banco (o feedback loop grava `otto.feedback` em
   * memories no server-side, apps/api/src/studio/routes.ts). A porta existe
   * pro futuro: quando o request carregar feedbacks recentes ou o node
   * sincronizar memories, quem muda é a chamada, não o pipeline.
   */
  deriveDNA?: (brandKit: BrandKit, feedbacks: CreativeFeedback[]) => CreativeDNA;
  /**
   * Busca externa do loop criativo (§55-59). NULL quando não há
   * OTTO_SEARCH_PROVIDER/OTTO_SEARCH_API_KEY na env: aí o pipeline roda sem
   * pesquisa e DECLARA isso na metadata (research.performed=false). O Otto
   * nunca afirma ter pesquisado sem ter feito chamada real.
   */
  researchProvider?: ResearchProvider | null;
}

export function createDefaultDeps(config: OttoNodeConfig): OttoNodeDeps {
  const logger = createLogger({ service: 'otto-node' });
  const llm = createOttoLLMProvider({
    baseUrl: config.otto.ollamaUrl,
    model: config.otto.model,
    timeoutMs: config.otto.llmTimeoutMs,
    logger,
  });
  return {
    llm,
    retrieveKnowledge: (query, options) =>
      retrieveRelevantKnowledge(loadBrainIndex(config.otto.brainPath), query, options),
    brainHealth: () => checkBrainHealth(config.otto.brainPath),
    researchProvider: createWebSearchProviderFromEnv(process.env, { logger }),
  };
}

/**
 * O client_id não viaja no executeRequestSchema (o protocolo é genérico pra
 * todos os agentes), então a convenção é o Context Engine mandar uma ref
 * `client:<uuid>` quando o pedido é de um cliente. Sem ela, a spec sai com o
 * NOME do cliente (válido pro schema, que pede string) e o worker do
 * Orchestrator sobrescreve com o client_id real da execution antes de
 * enfileirar no Studio - a fonte autoritativa é o banco, não o prompt.
 */
const CLIENT_REF_PREFIX = 'client:';

/**
 * Nome do cliente dentro do bloco de contexto do orquestrador.
 *
 * O worker escreve o dossiê com o nome do cliente resolvido na primeira linha
 * do bloco ("CLIENTE DO TURNO: Elite" / "DOSSIÊ DO CLIENTE: Elite"). É esse
 * nome — não o id, que não viaja no protocolo — que fecha a cerca de material
 * de cliente no vault.
 */
export function extrairClienteDoContexto(contexto: string): string | null {
  const m = /(?:CLIENTE DO TURNO|DOSSI[ÊE] DO CLIENTE|CLIENTE)\s*:\s*([^\n(|]{2,60})/i.exec(contexto);
  const bruto = m?.[1]?.trim();
  return bruto && bruto.length >= 2 ? bruto : null;
}

function extractClientId(contextRefs: string[]): string | null {
  const ref = contextRefs.find((value) => value.startsWith(CLIENT_REF_PREFIX));
  const id = ref?.slice(CLIENT_REF_PREFIX.length).trim();
  return id ? id : null;
}

/**
 * Detecção de intenção de PRODUÇÃO: só gera CreativePlan + ProductionSpec
 * quando o pedido é claramente "produza uma peça". Pergunta estratégica
 * ("qual o melhor horário pra postar?") vira resposta de chat com
 * conhecimento do Brain, sem custo de plano estruturado.
 */
/**
 * O corte do bloco de contexto do Orchestrator (aprendizados/hist\u00f3rico
 * anexados depois do marcador) agora vive em packages/otto
 * (stripOrchestratorContext): a MESMA regra vale pra detec\u00e7\u00e3o de inten\u00e7\u00e3o de
 * produ\u00e7\u00e3o e pra classifica\u00e7\u00e3o de profundidade, e duas c\u00f3pias do marcador em
 * arquivos diferentes s\u00e3o duas chances de uma delas ficar pra tr\u00e1s. O
 * motivo de existir segue o mesmo: sem cortar isso fora, um aprendizado
 * recente tipo "Otto criou plano criativo... (objetivo: gerar uma imagem)"
 * contaminava a classifica\u00e7\u00e3o de uma pergunta nova sem nenhuma rela\u00e7\u00e3o
 * (medido ao vivo em 2026-09-08: pergunta puramente estrat\u00e9gica sobre funil
 * virou intent "image" por causa de um teste anterior preso no contexto).
 */
function detectProductionIntent(message: string): StudioJobType | null {
  const userTurn = stripOrchestratorContext(message);
  const normalized = userTurn
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const hasProductionVerb = /\b(gere|gerar|gera|crie|criar|cria|produza|produzir|monte|montar|faca|fazer|planeje|planejar)\b/.test(normalized);
  if (!hasProductionVerb) return null;

  if (/\bcarrossel\b|\bcarousel\b/.test(normalized)) return 'carousel';
  if (/\breels\b/.test(normalized)) return 'reels';
  if (/\bvideo\b/.test(normalized)) return 'video';
  if (/\bupscale\b/.test(normalized)) return 'upscale';
  if (/\b(imagem|arte|post|peca|criativo|banner|anuncio|card|thumbnail)\b/.test(normalized)) return 'image';
  return null;
}

function formatKnowledgeBlock(knowledge: RetrievedKnowledge[]): string {
  if (knowledge.length === 0) {
    return '(nenhum documento do Brain casou com este pedido; responda com os princípios gerais da agência.)';
  }
  // Texto plano, sem "###": este bloco entra literal no system prompt e o
  // modelo tende a imitar a formatação que vê nele (medido ao vivo em
  // 2026-09-08: cabeçalho markdown aqui virava cabeçalho markdown na
  // resposta, que nenhum canal do Otto - WhatsApp, ClickUp, chat - renderiza).
  return knowledge
    .map((entry) => `Documento: ${entry.doc.titulo} (${entry.doc.path})\n${entry.snippet}`)
    .join('\n\n');
}

/**
 * Anexos do turno pro chat: o node não tem visão computacional (Ollama local
 * de texto), só nome/tipo do arquivo - nunca o conteúdo real. Sem avisar isso
 * explicitamente, o modelo preenchia a lacuna inventando descrição visual
 * plausível (cor, textura, cena) pra um anexo que nunca viu de fato, medido
 * ao vivo em 2026-09-08 com uma peça de cliente real. Isso NÃO altera o
 * caminho de produção (createCreativePlan / referenceAssets): lá o papel de
 * cada referência é decidido a partir do texto do briefing, não de visão, e a
 * imagem real é aplicada depois pelo Studio/ComfyUI, não pelo LLM.
 */
function formatAttachmentsBlock(attachments: ExecuteRequest['attachments']): string {
  if (!attachments || attachments.length === 0) return '';
  const list = attachments.map((asset) => `- ${asset.filename} (${asset.contentType})`).join('\n');
  return `\n\nArquivos anexados neste turno (você NÃO tem acesso visual ao conteúdo, só sabe nome e tipo):\n${list}\nNunca descreva cor, textura, cena ou qualquer detalhe visual que você não recebeu de verdade; se o pedido depender disso, diga com honestidade que ainda não consegue analisar o conteúdo da imagem diretamente.`;
}

/**
 * Deriva o DNA criativo do cliente a partir do brand kit e do histórico real
 * de feedback que o worker mandou no request (client_brand_kit e
 * client_feedback_history, packages/node-protocol) - o worker é quem lê
 * `memories` (kind otto.feedback, gravado no feedback loop server-side em
 * apps/api/src/studio/routes.ts), o node nunca acessa o banco direto. Sem
 * brand kit no request, sem DNA - o turno segue exatamente como antes.
 */
function deriveClientDNA(request: ExecuteRequest, deps: OttoNodeDeps): CreativeDNA | null {
  const kit = request.client_brand_kit;
  if (!kit) return null;
  const derive = deps.deriveDNA ?? deriveCreativeDNA;
  const feedbacks: CreativeFeedback[] = (request.client_feedback_history ?? []).map((entry) => ({
    verdict: entry.verdict,
    reason: entry.reason,
    context: entry.context,
  }));
  return derive(
    {
      clientId: extractClientId(request.context_refs) ?? 'unresolved',
      palette: kit.colors,
      typography: kit.fonts,
      ...(kit.tone_of_voice ? { toneOfVoice: kit.tone_of_voice } : {}),
    },
    feedbacks,
  );
}

/**
 * Resumo textual do DNA pro prompt. Não despeja o objeto inteiro: o que o
 * LLM precisa é de decisão acionável (paleta, tipografia, direção estética
 * consolidada) e do nível de confiança, pra saber quanto peso dar ao DNA vs.
 * ao briefing novo. O aestheticDirection já carrega tom/restrições/padrões
 * consolidados, então não repetimos esses campos aqui.
 */
function formatDnaBlock(dna: CreativeDNA): string {
  const lines = [
    dna.palette.length > 0 ? `Paleta: ${dna.palette.join(', ')}` : null,
    dna.typography.length > 0 ? `Tipografia: ${dna.typography.join(', ')}` : null,
    dna.aestheticDirection ? `Direção estética: ${dna.aestheticDirection}` : null,
    `Confiança do DNA: ${Math.round(dna.confidence * 100)}% (${dna.feedbackCount} feedbacks consolidados)`,
  ].filter(Boolean);
  return lines.join('\n');
}

// A persona completa (voz, léxico, funil, padrão anti-slop) vive em
// packages/types/src/personalities.ts e é a MESMA usada pra apresentar o
// Otto nos outros canais (menção no ClickUp, etc) - antes deste fix, o chat
// via /execute usava só uma linha genérica aqui embaixo, então a persona
// rica nunca chegava no modelo local pra conversa normal (só a resposta de
// menção no ClickUp, que passa pela wrapper de outro jeito, se beneficiava
// dela). Concatenada como system prompt de verdade, não injetada dentro da
// mensagem do usuário (isso é o padrão certo pro Otto, que já tem seu
// próprio /execute com system+user - diferente de Bento/Jarbas/Suzy, cujo
// serviço só aceita um texto solto).
const OTTO_PERSONA = AGENT_PERSONALITIES.otto ?? '';
const CHAT_SYSTEM_PROMPT = `${OTTO_PERSONA}\n\nResponda em português do Brasil, com acentos, sem travessão, sem markdown (nunca #, ##, **: texto plano com quebras de linha). Use o conhecimento do Brain da agência abaixo como embasamento; se ele não cobrir o assunto, diga isso em vez de inventar. Documento do Brain que fala de um cliente ESPECÍFICO diferente do que a pergunta pede não é fonte pra esse cliente: nunca empreste nome de projeto, peça ou resultado real de um cliente pra responder sobre outro, mesmo trocando o nome.

REGRAS DE ENTREGA (10/09/2026, depois de teste com o time):
1. O mantra "isso emociona ou é decoração?" é critério INTERNO de decisão. NUNCA escreva ele na resposta, e nunca crie um rótulo tipo "Emoção: isso emociona" em cada item. Medido: cinco slides saíram com a mesma frase colada no fim de cada um, o que é ruído, não direção.
2. Se o pedido tem MAIS DE UM entregável (ex: "uma copy para carrossel E um roteiro para reels"), entregue TODOS, cada um com seu título. Entregar metade do pedido é não entregar.
3. Assunto EXTERNO (um país, uma tecnologia, um tema de mercado) não é cliente da agência. Não trate como cliente, não invente que a agência tem operação naquele assunto, e não misture processo interno da Desigual na resposta.
4. NUNCA INVENTAR INFORMAÇÃO. Você pode criar livremente ÂNGULO, conceito, hook, estrutura e texto criativo — isso é seu trabalho. O que você NÃO pode é afirmar FATO que você não tem fonte: número, estatística, data, nome de empresa, case, ranking, citação, "X% do mercado", "a China lidera em Y". Se o conceito precisa de um dado pra funcionar, escreva o lugar dele marcado como [DADO A CONFIRMAR: o quê] e diga em uma linha, no fim, o que precisa ser checado antes de publicar. Peça criativa com lacuna marcada é entregável; peça criativa com número inventado é risco pro cliente.
5. Se o nome no pedido parecer erro de digitação de algo conhecido (ex: "Chiuna" por "China"), assuma o mais provável e diga em uma linha que assumiu.`;

/**
 * ÚLTIMA PALAVRA DO PROMPT, e a posição é o ponto.
 *
 * O bloco de conhecimento do Brain entra por último, e vários BRAIN.md trazem
 * um aviso de ficha reduzida: "este cliente tem pouco contexto consolidado.
 * ANTES DE PRODUZIR, declare as lacunas na entrega". A frase foi escrita pra
 * lembrar de sinalizar o que falta; lida em último lugar, sobre um dossiê onde
 * quase tudo é [FALTA], ela vira pré-condição — e o Otto passa a declarar
 * lacunas NO LUGAR de entregar.
 *
 * Medido no navegador em 17/09/2026: "faz uma legenda" respondido com
 * "não posso criar porque faltam os dados factuais essenciais", num turno em
 * que a regra 4 deste mesmo prompt já autorizava entregar com
 * [DADO A CONFIRMAR].
 *
 * A instrução certa já existe acima; o que faltava era ela ser a última coisa
 * lida. Corrigir a redação dos BRAIN.md continua valendo — é dado da agência e
 * não deveria dizer "antes de produzir" quando quer dizer "antes de publicar" —
 * mas a entrega não pode depender disso.
 */
const FECHAMENTO_ENTREGA = `FECHAMENTO (vale sobre qualquer aviso de ficha reduzida ou lacuna acima): lacuna NÃO adia entrega. Se o dossiê estiver incompleto, assuma a hipótese mais provável, diga em UMA linha o que assumiu, e ENTREGUE a peça pedida. Marque o que precisa ser confirmado como [A CONFIRMAR: o quê] DENTRO da peça, e liste o que falta DEPOIS dela. Só existe um caso em que você pergunta em vez de entregar: quando sem o dado a peça sairia FALSA (preço, data, alegação factual) ou quando não dá pra saber de qual produto ou campanha se trata.`;

/**
 * Latência por fase, pedida explicitamente pelo dono. Vai na metadata da
 * resposta E no log, inclusive no caminho de falha - turno que estourou é
 * exatamente quando se quer saber onde o tempo foi.
 *
 * `classify_ms` cobre as duas classificações determinísticas (profundidade +
 * intenção de produção); `retrieval_ms` cobre índice do Brain + scoring;
 * `llm_ms` é a soma de TODAS as chamadas de modelo do turno (o caminho de
 * carrossel/vídeo faz duas). `total_ms` é o turno inteiro medido na borda, o
 * que deixa a diferença (total menos as fases) visível como overhead.
 */
interface PhaseTimings {
  classify_ms: number;
  retrieval_ms: number;
  llm_ms: number;
  total_ms: number;
}

/** Cronômetro de fase: arredonda pra ms inteiro, que é a resolução útil aqui. */
function since(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

/**
 * O caminho de PRODUÇÃO nunca roda com retrieval de nível FAST.
 *
 * Motivo: um pedido pode carregar cue de entrega pequena e ainda assim virar
 * peça ("troca o CTA e gera a arte nova" tem 'troca' e 'cta', mas o verbo
 * 'gera' + 'arte' manda pro planner). O plano criativo alimenta a fila do
 * Studio e vira imagem de verdade; economizar 2 docs de embasamento ali
 * pouparia frações de segundo num caminho que custa minutos, e pagaria isso
 * com direção de arte mais rasa. O piso é STANDARD.
 */
function floorAtStandard(plan: TurnDepthPlan): DepthPolicy {
  return plan.depth === 'fast' ? depthPolicy('standard') : plan.policy;
}

/**
 * CreativeState do turno (§52): a leitura unificada do que o Otto JÁ sabe
 * sobre o cliente antes de criar. Não inventa nada — cada campo vem de uma
 * fonte real do request ou do Brain, e o que não existe fica null pra virar
 * lacuna explícita em assessCreativeReadiness.
 */
function buildCreativeStateInput(
  request: ExecuteRequest,
  knowledge: RetrievedKnowledge[],
  dna: CreativeDNA | null,
  clientId: string,
): CreativeStateInput {
  const kit = request.client_brand_kit;
  // Histórico criativo real: o feedback já registrado do cliente vira
  // referência aprovada/rejeitada do estado (o que repetir / o que evitar).
  const approved: CreativeReference[] = [];
  const rejected: CreativeReference[] = [];
  (request.client_feedback_history ?? []).forEach((entry, index) => {
    const ref: CreativeReference = {
      id: `feedback-${index + 1}`,
      summary: [entry.reason, entry.context].filter(Boolean).join(' — ') || entry.verdict,
      verdict: entry.verdict === 'approved' ? 'approved' : 'rejected',
    };
    if (entry.verdict === 'approved') approved.push(ref);
    else rejected.push(ref);
  });

  return {
    clientId,
    objective: stripOrchestratorContext(request.message),
    ...(dna ? { dna } : {}),
    ...(kit
      ? {
          brand: {
            clientId,
            palette: kit.colors,
            typography: kit.fonts,
            ...(kit.tone_of_voice ? { toneOfVoice: kit.tone_of_voice } : {}),
          },
        }
      : {}),
    approvedCreatives: approved,
    rejectedCreatives: rejected,
    // MEMÓRIA do turno: os documentos do Brain que o retrieval trouxe. É o
    // que faz assessCreativeReadiness saber que já existe referência e não
    // disparar pesquisa externa à toa (§67).
    memories: knowledge.map((entry) => `${entry.doc.titulo}: ${entry.snippet}`),
  };
}

/** Bloco de pesquisa pro prompt do planner. Vazio quando não houve pesquisa. */
function formatResearchBlock(research: { performed: boolean; summary: string; findings: { claim: string; url: string }[] }): string {
  if (!research.performed || research.findings.length === 0) return '';
  const fontes = research.findings.map((f) => `- ${f.claim} (${f.url})`).join('\n');
  return `\n\nPesquisa externa REAL feita para este turno (use como base factual; cite só o que está aqui):\n${research.summary}\nFontes:\n${fontes}`;
}

/**
 * Roteiro cena a cena pro chat, quando o vídeo é FALADO (tem spoken_line em
 * pelo menos uma cena). Sem isto, "roteiro de Reels" devolvia só conceito e
 * copy resumidos — a direção de câmera e a fala completa ficavam presas em
 * metadata.video_plan, que o Orchestrator lê pra fila do Studio, mas quem
 * pediu o roteiro num chat nunca vê. Regressão real: Jardim Europa V
 * (Cosentino), 22/09/2026 — resposta chegou sem roteiro executável.
 */
function formatVideoScript(video: VideoPlan): string {
  const temFala = video.scenes.some((scene) => scene.spoken_line);
  if (!temFala) return '';
  const cenas = video.scenes
    .map((scene, index) => {
      const linhas = [`Cena ${index + 1}${scene.duration_seconds ? ` (${scene.duration_seconds}s)` : ''}:`];
      linhas.push(`Visual: ${scene.subject_movement}, ${scene.environment}.`);
      if (scene.spoken_line) linhas.push(`Fala: "${scene.spoken_line}"`);
      if (scene.on_screen_text) linhas.push(`Texto na tela: ${scene.on_screen_text}`);
      return linhas.join('\n');
    })
    .join('\n\n');
  const overlays = video.text_overlays.length > 0 ? `\n\nTextos na tela (gerais): ${video.text_overlays.join(' / ')}` : '';
  return `\n\nRoteiro:\n\n${cenas}${overlays}\n\nCTA: ${video.cta}`;
}

/** Resumo legível do plano pro chat: a metadata carrega o JSON completo. */
function formatPlanAnswer(
  planConcept: string,
  planCopy: string,
  jobType: StudioJobType,
  videoPlan?: VideoPlan,
  carouselPlan?: CarouselPlan,
): string {
  const script = videoPlan ? formatVideoScript(videoPlan) : '';
  const carrossel = carouselPlan
    ? `\n\n${carouselPlan.slides
        .map((slide) => `Slide ${slide.index}: ${slide.copy}`)
        .join('\n')}`
    : '';
  return [`Conceito: ${planConcept}`, `Legenda: ${planCopy}`]
    .join('\n\n')
    .concat(
      script,
      carrossel,
      `\n\nSpec de produção (${jobType}) gerada e anexada a esta resposta; o Orchestrator transforma em job do Studio.`,
    );
}

export async function executeTask(
  request: ExecuteRequest,
  config: OttoNodeConfig,
  deps: OttoNodeDeps,
  logger: FastifyBaseLogger,
): Promise<ExecuteResponse> {
  runtimeState.agentStatus = 'busy';
  const startedAt = performance.now();
  const sources: string[] = [];
  // Fases declaradas FORA do try pra que o caminho de falha também consiga
  // reportar onde o tempo foi. Turno que estourou timeout do Ollama é
  // justamente o caso em que "quanto foi retrieval, quanto foi modelo" é a
  // pergunta que importa.
  let classifyMs = 0;
  let retrievalMs = 0;
  let llmMs = 0;
  let depthLabel: string | null = null;

  /**
   * Acumula o tempo de cada chamada de modelo em `finally`, não depois do
   * await: assim um Ollama que estoura o timeout de 120s ainda reporta os
   * 120s em `llm_ms` em vez de zero, que é o número que interessa quando o
   * turno falha.
   */
  const measureLlm = async <T>(run: () => Promise<T>): Promise<T> => {
    const callStartedAt = performance.now();
    try {
      return await run();
    } finally {
      llmMs += since(callStartedAt);
    }
  };

  try {
    // (a) Classificação determinística, ANTES de qualquer IO ou token: a
    // profundidade do turno (FAST/STANDARD/DEEP) e a intenção de produção.
    // Ordem invertida em relação à versão anterior de propósito - o retrieval
    // agora é PARAMETRIZADO por esta decisão, então ele não pode mais vir
    // primeiro. Custo medido das duas juntas: fração de milissegundo.
    const classifyStartedAt = performance.now();
    const depth = planTurnDepth(request.message);
    const intent = detectProductionIntent(request.message);
    const policy = intent ? floorAtStandard(depth) : depth.policy;
    classifyMs = since(classifyStartedAt);
    depthLabel = depth.depth;
    logger.info(
      {
        intent,
        depth: depth.depth,
        depth_reason: depth.reason,
        depth_signals: depth.signals,
        policy,
        classify_ms: classifyMs,
        execution_id: request.execution_id,
      },
      '[OTTO:classify] profundidade e intenção classificadas',
    );

    // (b) Retrieval no Brain, com os parâmetros que a profundidade escolheu.
    // A query junta a mensagem com as context_refs: refs do Context Engine
    // (ex: nome de doc ou tema) funcionam como termos de busca extras. Brain
    // fora do ar NÃO derruba o turno - o Otto fica "criativo mas cego"
    // (visível no /health) e responde sem a camada de conhecimento, com o
    // fato logado.
    /**
     * PORTA DO VAULT (18/09/2026).
     *
     * Duas correções na mesma linha, porque as duas produziam o mesmo sintoma:
     * "me explica o segundo" respondido com o tom de voz da APAE.
     *
     * 1. A QUERY era `request.message` INTEIRA — com o pacote de contexto que
     *    o worker cola depois do marcador. Três palavras de pedido contra
     *    centenas de palavras de dossiê: quem decidia o resultado da busca
     *    lexical era o ruído. A detecção de intenção e a profundidade já
     *    cortavam esse bloco; o retrieval era o único que ainda não.
     *
     * 2. O VAULT RODAVA SEMPRE. Para um follow-up cujo referente está na
     *    conversa, conhecimento externo não preenche lacuna nenhuma — ele
     *    compete com a resposta certa. RAG existe pra completar o que falta,
     *    não pra decidir o que "o segundo" significa.
     */
    /**
     * O cliente do turno vem do ESCOPO RESOLVIDO pelo orquestrador — fato
     * consultado no banco, não palpite lexical. É ele que fecha a cerca do
     * vault; sem ele, só conhecimento geral entra.
     */
    const contextoDoOrquestrador = extractOrchestratorContext(request.message) ?? '';
    const clientSlug = extrairClienteDoContexto(contextoDoOrquestrador);
    const dialogoRecente = contextoDoOrquestrador;
    const turno = classificarTurno(request.message, /CONVERSA RECENTE/i.test(dialogoRecente));
    const diretivaDeReferente = resolverReferente(dialogoRecente, turno);

    const retrievalStartedAt = performance.now();
    let knowledge: RetrievedKnowledge[] = [];
    try {
      if (turno.precisaVault) {
        // Só o TURNO do usuário + refs. O bloco do orquestrador fica de fora.
        const query = [stripOrchestratorContext(request.message), ...request.context_refs].join('\n');
        knowledge = deps.retrieveKnowledge(query, {
          maxDocs: policy.maxDocs,
          snippetLength: policy.snippetLength,
          includeStudioBrain: policy.includeStudioBrain,
          clientSlug,
        });
        sources.push(...knowledge.map((entry) => entry.doc.path));
      }
    } catch (error) {
      logger.warn({ error }, '[OTTO:retrieval] Brain ilegível; seguindo sem conhecimento');
    }
    logger.info(
      {
        classe_do_turno: turno.classe,
        vault_consultado: turno.precisaVault,
        motivo: turno.motivo,
        ordinal: turno.ordinal,
        referente_resolvido: diretivaDeReferente !== null,
        client_slug: clientSlug ?? null,
        docs: knowledge.length,
        execution_id: request.execution_id,
      },
      '[OTTO:retrieval] porta do vault',
    );
    retrievalMs = since(retrievalStartedAt);
    logger.info(
      { docs: knowledge.length, paths: sources, depth: depth.depth, retrieval_ms: retrievalMs },
      '[OTTO:retrieval] conhecimento recuperado do Brain',
    );

    // DNA criativo do cliente (quando o worker mandou brand kit no request):
    // entra no chat e no planner como contexto de decisão, e volta na
    // metadata pra auditoria/aprendizado downstream.
    const dna = deriveClientDNA(request, deps);
    if (dna) {
      logger.info(
        { confidence: dna.confidence, feedbacks: dna.feedbackCount },
        '[OTTO:dna] DNA criativo derivado do brand kit',
      );
    }
    const dnaSection = dna ? `\n\nDNA criativo do cliente:\n${formatDnaBlock(dna)}` : '';

    // PRECEDÊNCIA DO CONTEXTO RESOLVIDO. O que o orquestrador manda (cliente do
    // turno, campanha do turno, pessoas) é FATO consultado no banco e no
    // ClickUp; o que sai do vault aqui é o trecho mais parecido com a frase.
    // Enquanto o primeiro vinha só na mensagem do usuário e o segundo no system
    // prompt, o palpite ganhava do fato: medido em 16/09/2026, com a campanha
    // Europa V (Cosentino) resolvida e entregue, o node escreveu para Top
    // Tennis Club porque foi isso que a busca trouxe. Agora o fato entra aqui,
    // acima, e a regra de desempate é explícita.
    const contextoResolvido = extractOrchestratorContext(request.message);
    const escopoSection = contextoResolvido
      ? `\n\nESCOPO RESOLVIDO DESTE TURNO (consultado nas fontes da operação, tem PRECEDÊNCIA sobre o Conhecimento do Brain abaixo; se o Brain apontar outro cliente ou outra campanha, o Brain está errado para este turno):\n${contextoResolvido}`
      : '';
    /**
     * A diretiva de referente é CURTA e só existe quando o código já resolveu
     * qual item é. Não é instrução genérica de "use o histórico" — é o texto
     * do item, para o modelo não ter o que adivinhar nem onde procurar.
     */
    const referenteSection = diretivaDeReferente
      ? `\n\nREFERÊNCIA DESTE TURNO (resolvida na conversa recente, tem PRECEDÊNCIA sobre qualquer fonte recuperada):\n${diretivaDeReferente}`
      : '';

    // (c)+(d) Caminho de chat: prompt com contexto + conhecimento -> Ollama.
    if (!intent) {
      const attachmentsSection = formatAttachmentsBlock(request.attachments);
      // A diretiva de postura é o que faz o Otto ENTREGAR em vez de devolver
      // o pedido como pergunta, com a forma da entrega escolhida pela
      // profundidade (ver packages/otto/src/creative/stance.ts). Ela entra
      // DEPOIS do bloco de anexos e da fronteira de honestidade, e reforça as
      // duas em vez de afrouxá-las.
      const directive = buildDirectionDirective({
        depth: depth.depth,
        hasClientMaterial: dna !== null,
      });
      /**
       * O CONTRATO vem do turno do usuário, sem o bloco do orquestrador: o
       * contexto fala de tarefas, campanhas e posts, e deixá-lo entrar na
       * detecção faria "me dá 3 títulos" virar pedido de legenda por causa de
       * uma palavra que o usuário nem escreveu.
       *
       * Entra DEPOIS da diretiva de direção porque é mais específico que ela:
       * a direção diz como pensar, o contrato diz o que entregar.
       */
      const contratoEstrutura = contratoDeSaida(stripOrchestratorContext(request.message));
      const contrato = diretivaDoContrato(contratoEstrutura);
      /**
       * TETO DE GERAÇÃO por entregável. O padrão de chat (1000 tokens,
       * ollama-provider.ts) foi calibrado pra uma resposta só; um roteiro
       * de Reels sozinho (hook + shot a shot + direção + CTA) já aperta
       * esse teto, e um pedido com mais de um entregável (ex: roteiro +
       * legenda, o caso real da regressão Jardim Europa V) dobra o texto
       * esperado. Sem folga aqui, ou a peça sai cortada, ou o modelo
       * economiza detalhe pra caber — os dois são o mesmo sintoma de
       * "roteiro fraco" visto na operação.
       */
      const numPredict =
        contratoEstrutura.adicionais && contratoEstrutura.adicionais.length > 0
          ? 2_400
          : contratoEstrutura.artefato === 'roteiro'
            ? 1_800
            : undefined;
      const answer = await measureLlm(() =>
        deps.llm.chat(
          [
            {
              role: 'system',
              content: `${CHAT_SYSTEM_PROMPT}${escopoSection}${referenteSection}${dnaSection}${attachmentsSection}\n\n${directive}${contrato ? `\n\n${contrato}` : ''}\n\nConhecimento do Brain:\n\n${formatKnowledgeBlock(knowledge)}\n\n${FECHAMENTO_ENTREGA}`,
            },
            { role: 'user', content: request.message },
          ],
          { temperature: 0.7, suppressThinking: policy.suppressThinking, ...(numPredict ? { numPredict } : {}) },
        ),
      );
      const timings: PhaseTimings = {
        classify_ms: classifyMs,
        retrieval_ms: retrievalMs,
        llm_ms: llmMs,
        total_ms: since(startedAt),
      };
      logger.info({ ...timings, depth: depth.depth }, '[OTTO:llm] resposta de chat concluída');
      return {
        execution_id: request.execution_id,
        agent: config.AGENT_NAME,
        status: 'completed',
        answer,
        sources,
        tool_calls: [],
        // O provider (packages/otto) devolve só o texto: o Ollama reporta
        // tokens em campos que o chat() não expõe ainda. 0 = "não medido",
        // não "grátis" (mesma ressalva do desigual-node pro Token Engine).
        usage: { input_tokens: 0, output_tokens: 0 },
        metadata: {
          intent: 'chat',
          brain_docs_used: sources,
          retrieval: { depth: depth.depth, reason: depth.reason, signals: depth.signals, ...policy },
          timings,
          ...(dna ? { creative_dna: dna } : {}),
        },
      };
    }

    // (e) Caminho de produção criativa: o LOOP criativo completo (§60, §66) —
    // CreativeState -> lacunas -> pesquisa (só se a lacuna exigir dado atual)
    // -> geração -> porta anti-genérico -> auto-revisão. Antes daqui o node
    // chamava createCreativePlan direto e entregava a primeira versão, fosse
    // ela genérica ou não; agora a geração é um PASSO dentro do pipeline, que
    // é quem decide se aceita, revisa ou reprova.
    const refClientId = extractClientId(request.context_refs);
    const stateInput = buildCreativeStateInput(request, knowledge, dna, refClientId ?? 'unresolved');

    // Sem provider configurado a pesquisa não acontece; runResearch devolve
    // performed=false e o trace registra o motivo. Nunca fingimos pesquisa.
    const researchProvider: ResearchProvider = deps.researchProvider ?? {
      search: () => Promise.reject(new Error('pesquisa externa não configurada (OTTO_SEARCH_PROVIDER/OTTO_SEARCH_API_KEY ausentes)')),
    };

    /**
     * CONTRATO DE SAÍDA no caminho de produção também.
     *
     * `contratoDeSaida`/`diretivaDoContrato` só eram usados no chat (linha
     * ~563). createCreativePlan tem seu PRÓPRIO prompt (CREATIVE_DIRECTOR_PREAMBLE,
     * pensado pra geração de imagem) e nunca recebia essa diretiva — então o
     * campo `copy` saía sem a forma de legenda de verdade (hashtags, bloco de
     * CTA) mesmo quando o pedido nomeava "legenda" explicitamente. Medido ao
     * vivo em 22/09/2026 (Otto Elite Phase 2, baseline reels Jardim Europa V):
     * a legenda gerada não tinha hashtag nenhuma e ignorou "pode usar emojis
     * na legenda", porque nada no prompt do planner sabia que isso foi pedido.
     */
    const contratoProducao = diretivaDoContrato(contratoDeSaida(stripOrchestratorContext(request.message)));
    const pedeEmoji = /\bemojis?\b/i.test(stripOrchestratorContext(request.message));

    // A geração é o passo INJETADO do pipeline: o planner real do Otto, com o
    // bloco de pesquisa e a nota de revisão quando o gate reprovou a anterior.
    const pipeline = await runCreativePipeline(
      {
        researchProvider,
        generator: {
          generate: async ({ research, revisionNote }) => {
            const generated = await measureLlm(() =>
              createCreativePlan(
                { llm: deps.llm },
                {
                  briefing: revisionNote ? `${request.message}\n\nREVISÃO OBRIGATÓRIA: ${revisionNote}` : request.message,
                  knowledge,
                  referenceAssets: request.attachments,
                  clientContext: [
                    dna ? `DNA criativo do cliente:\n${formatDnaBlock(dna)}` : '',
                    formatResearchBlock(research),
                    contratoProducao ? `O campo "copy" precisa seguir este contrato:\n${contratoProducao}` : '',
                    pedeEmoji ? 'O pedido autoriza emojis: use com naturalidade no campo "copy", sem exagerar.' : '',
                  ]
                    .filter(Boolean)
                    .join('\n'),
                },
              ),
            );
            return { copy: generated.copy, concept: generated.concept, plan: generated };
          },
        },
      },
      stateInput,
      // Sem brandTerms de propósito: o único identificador de cliente que o
      // node tem aqui é o UUID do context_ref, e UUID não aparece em copy
      // nenhuma — passá-lo como "termo de marca" só produziria uma âncora que
      // jamais casa. Sem ele, assessCreativeCopy decide por clichê + âncora
      // concreta (número), que é o sinal que de fato existe neste ponto.
      {},
    );

    if (!pipeline.output) {
      throw new Error('pipeline criativo não produziu peça');
    }
    const plan = pipeline.output.plan as Awaited<ReturnType<typeof createCreativePlan>>;

    logger.info(
      {
        concept: plan.concept,
        job_type: intent,
        llm_ms: llmMs,
        gaps: pipeline.readiness.gaps,
        research_performed: pipeline.research.performed,
        research_sources: pipeline.research.findings.length,
        quality_passed: pipeline.qualityPassed,
        revisions: pipeline.revisions,
      },
      '[OTTO:creative] loop criativo concluído',
    );
    if (pipeline.readiness.requiresResearch && !pipeline.research.performed) {
      logger.warn(
        { execution_id: request.execution_id },
        '[OTTO:research] o objetivo pedia dado atual e a pesquisa NÃO aconteceu; a peça sai sem base de mercado',
      );
    }

    const metadata: Record<string, unknown> = {
      intent,
      brain_docs_used: sources,
      retrieval: { depth: depth.depth, reason: depth.reason, signals: depth.signals, ...policy },
      creative_plan: plan,
      // Trace do loop criativo: é o que prova, na auditoria, que houve estado,
      // lacuna, pesquisa (ou a falta declarada dela), porta de qualidade e
      // revisão — em vez de uma geração única disfarçada de pipeline.
      creative_pipeline: {
        gaps: pipeline.readiness.gaps,
        notes: pipeline.readiness.notes,
        requires_research: pipeline.readiness.requiresResearch,
        research: {
          performed: pipeline.research.performed,
          summary: pipeline.research.summary,
          sources: pipeline.research.findings,
          single_source: pipeline.research.singleSource,
          evidence: pipeline.research.evidence,
        },
        quality_passed: pipeline.qualityPassed,
        quality_assessment: pipeline.qualityAssessment,
        revisions: pipeline.revisions,
        trace: pipeline.trace,
      },
      ...(dna ? { creative_dna: dna } : {}),
    };

    // Sequencial por DEPENDÊNCIA REAL, não por descuido: planCarousel e
    // planVideo recebem o CreativePlan pronto como entrada (o JSON do plano é
    // o user prompt deles), então não há Promise.all possível aqui sem
    // planejar o carrossel a partir de um plano que ainda não existe. Os dois
    // ifs também são mutuamente exclusivos por jobType.
    let carouselPlan;
    let videoPlan;
    if (intent === 'carousel') {
      carouselPlan = await measureLlm(() => planCarousel({ llm: deps.llm }, plan));
      metadata.carousel_plan = carouselPlan;
      logger.info({ slides: carouselPlan.slide_count, llm_ms: llmMs }, '[OTTO:plan] carrossel planejado');
    }
    if (intent === 'video' || intent === 'reels') {
      videoPlan = await measureLlm(() => planVideo({ llm: deps.llm }, plan));
      metadata.video_plan = videoPlan;
      logger.info({ scenes: videoPlan.scenes.length, llm_ms: llmMs }, '[OTTO:plan] vídeo planejado');
    }

    const clientId = refClientId ?? plan.client;
    const spec = buildProductionSpec(plan, {
      clientId,
      jobType: intent,
      ...(carouselPlan ? { carouselPlan } : {}),
      ...(videoPlan ? { videoPlan, aspectRatio: videoPlan.aspect_ratio } : {}),
      referenceAssets: request.attachments,
      metadata: { execution_id: request.execution_id },
    });
    metadata.production_spec = spec;
    const timings: PhaseTimings = {
      classify_ms: classifyMs,
      retrieval_ms: retrievalMs,
      llm_ms: llmMs,
      total_ms: since(startedAt),
    };
    metadata.timings = timings;
    logger.info(
      { job_type: spec.job_type, ...timings, depth: depth.depth },
      '[OTTO:spec] spec de produção pronta pro handoff',
    );

    // Gate de fidelidade real (ver checkRealWorldFidelity): se o briefing
    // pede um produto/marca/pessoa/local REAL sem referência fiel anexada,
    // a pessoa vê isso ANTES de esperar o job do Studio terminar, não depois.
    const fidelityWarning =
      typeof spec.metadata.fidelity_warning === 'string' ? spec.metadata.fidelity_warning : null;
    if (fidelityWarning) {
      logger.warn({ execution_id: request.execution_id }, '[OTTO:fidelity] briefing sem referência fiel pra entidade real');
    }

    return {
      execution_id: request.execution_id,
      agent: config.AGENT_NAME,
      status: 'completed',
      answer: [fidelityWarning, formatPlanAnswer(plan.concept, plan.copy, intent, videoPlan, carouselPlan)]
        .filter(Boolean)
        .join('\n\n'),
      sources,
      tool_calls: [],
      usage: { input_tokens: 0, output_tokens: 0 },
      metadata,
    };
  } catch (error) {
    // Falha honesta: Ollama fora, JSON inválido depois do retry, brain
    // quebrado no meio do pipeline - tudo sobe como erro estruturado. NUNCA
    // simular resposta criativa: um plano inventado sem LLM pareceria
    // trabalho real e iria parar na fila do Studio.
    const timings: PhaseTimings = {
      classify_ms: classifyMs,
      retrieval_ms: retrievalMs,
      llm_ms: llmMs,
      total_ms: since(startedAt),
    };
    logger.error(
      { error, execution_id: request.execution_id, ...timings, depth: depthLabel },
      '[OTTO:error] execução falhou',
    );
    return {
      execution_id: request.execution_id,
      agent: config.AGENT_NAME,
      status: 'failed',
      answer: null,
      sources,
      tool_calls: [],
      usage: { input_tokens: 0, output_tokens: 0 },
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    runtimeState.agentStatus = 'idle';
  }
}

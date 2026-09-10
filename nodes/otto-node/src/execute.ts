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
  stripOrchestratorContext,
  type BrainHealth,
  type BrandKit,
  type CreativeDNA,
  type CreativeFeedback,
  type DepthPolicy,
  type OttoLLMProvider,
  type RetrievedKnowledge,
  type RetrieveOptions,
  type StudioJobType,
  type TurnDepthPlan,
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
 * Deriva o DNA criativo do cliente a partir do brand kit que o worker mandou
 * no request (client_brand_kit, packages/node-protocol). Feedbacks vazios
 * POR ORA: o node não acessa o banco e o feedback loop grava `otto.feedback`
 * em memories no server-side. Sem brand kit no request, sem DNA - o turno
 * segue exatamente como antes (comportamento inalterado).
 */
function deriveClientDNA(request: ExecuteRequest, deps: OttoNodeDeps): CreativeDNA | null {
  const kit = request.client_brand_kit;
  if (!kit) return null;
  const derive = deps.deriveDNA ?? deriveCreativeDNA;
  return derive(
    {
      clientId: extractClientId(request.context_refs) ?? 'unresolved',
      palette: kit.colors,
      typography: kit.fonts,
      ...(kit.tone_of_voice ? { toneOfVoice: kit.tone_of_voice } : {}),
    },
    [],
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

/** Resumo legível do plano pro chat: a metadata carrega o JSON completo. */
function formatPlanAnswer(planConcept: string, planCopy: string, jobType: StudioJobType): string {
  return [
    `Conceito: ${planConcept}`,
    '',
    `Copy: ${planCopy}`,
    '',
    `Spec de produção (${jobType}) gerada e anexada a esta resposta; o Orchestrator transforma em job do Studio.`,
  ].join('\n');
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
    const retrievalStartedAt = performance.now();
    let knowledge: RetrievedKnowledge[] = [];
    try {
      const query = [request.message, ...request.context_refs].join('\n');
      knowledge = deps.retrieveKnowledge(query, {
        maxDocs: policy.maxDocs,
        snippetLength: policy.snippetLength,
        includeStudioBrain: policy.includeStudioBrain,
      });
      sources.push(...knowledge.map((entry) => entry.doc.path));
    } catch (error) {
      logger.warn({ error }, '[OTTO:retrieval] Brain ilegível; seguindo sem conhecimento');
    }
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
      const answer = await measureLlm(() =>
        deps.llm.chat(
          [
            {
              role: 'system',
              content: `${CHAT_SYSTEM_PROMPT}${dnaSection}${attachmentsSection}\n\n${directive}\n\nConhecimento do Brain:\n\n${formatKnowledgeBlock(knowledge)}`,
            },
            { role: 'user', content: request.message },
          ],
          { temperature: 0.7, suppressThinking: policy.suppressThinking },
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

    // (e) Caminho de produção criativa: briefing -> CreativePlan -> Spec.
    const plan = await measureLlm(() =>
      createCreativePlan(
        { llm: deps.llm },
        {
          briefing: request.message,
          knowledge,
          referenceAssets: request.attachments,
          ...(dna ? { clientContext: `DNA criativo do cliente:\n${formatDnaBlock(dna)}` } : {}),
        },
      ),
    );
    logger.info({ concept: plan.concept, job_type: intent, llm_ms: llmMs }, '[OTTO:plan] plano criativo gerado');

    const metadata: Record<string, unknown> = {
      intent,
      brain_docs_used: sources,
      retrieval: { depth: depth.depth, reason: depth.reason, signals: depth.signals, ...policy },
      creative_plan: plan,
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

    const clientId = extractClientId(request.context_refs) ?? plan.client;
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
      answer: [fidelityWarning, formatPlanAnswer(plan.concept, plan.copy, intent)].filter(Boolean).join('\n\n'),
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

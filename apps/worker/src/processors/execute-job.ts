import { and, eq } from 'drizzle-orm';
import type { Job } from 'bullmq';
import { db, schema } from '@desigual-os/database';
import {
  executeResponseSchema,
  type ClientBrandKit,
  type ClientFeedbackEntry,
  type ExecuteResponse,
} from '@desigual-os/node-protocol';
import { creativePlanSchema, productionSpecSchema, type ProductionSpec } from '@desigual-os/otto';
import {
  AGENT_TIMEOUT_MS,
  AGENT_MAX_ATTEMPTS,
  PRIORITY_VALUE,
  findHealthyNodeForAgent,
  finalizeExecutionCost,
  generateStudioJobId,
  getAgentQueue,
  getStudioJobQueue,
  publishWsEvent,
  recordCostEvent,
  recordLearning,
  recallMemories,
  type AgentJobData,
} from '@desigual-os/orchestrator';
import type { AgentName } from '@desigual-os/types';
import { AGENT_NAMES, stripEmDashes } from '@desigual-os/types';
import {
  askBentoQA,
  BentoQAError,
  askAgent,
  AgentAskError,
  requestToolCall,
} from '@desigual-os/tool-gateway';
import { stripBlockMarkers, stripMarkdownArtifacts, withPersonality, extractApprovalProposal } from '@desigual-os/types';
import type { Logger } from '@desigual-os/logging';
import { dispatchWithAgentLoop } from './agentic-dispatch';
import { tryBentoActionGuard } from './bento-action-guard';
import { detectSmallTalk } from './small-talk';
import { registrarConhecimentoDoTurno } from './knowledge-statement';

// Feature flag do Agentic V2 (seção 112 da spec): o loop com estado,
// avaliação e replan só assume o dispatch quando ligado; desligado, o
// caminho é exatamente o de antes. Rollback = unset na env + restart.
//
// 13/09/2026: a flag vira POR AGENTE. A auditoria forense (divergência 1 do
// relatório da Onda 0) flagrou o loop ligado no worker de produção envolvendo
// TODOS os agentes, Jarbas incluso. Jarbas é golden agent/read-only: ele
// NUNCA entra no loop, nem com AGENT_LOOP_V2=true, nem nomeado na lista.
// Valores: "true" = todos exceto jarbas; "bento,suzy" = só os listados.
export function parseAgentLoopFlag(raw: string | undefined): Set<AgentName> {
  if (!raw || raw === 'false' || raw === '') return new Set();
  const enabled: AgentName[] = raw === 'true' ? [...AGENT_NAMES] : (raw.split(',').map((a) => a.trim()) as AgentName[]);
  return new Set(enabled.filter((agent) => AGENT_NAMES.includes(agent) && agent !== 'jarbas'));
}

// Parse preguiçoso: AGENT_NAMES não pode ser lido no escopo de módulo (TDZ
// em import circular com @desigual-os/types — quebrou o vitest na primeira
// versão). A primeira consulta acontece no primeiro dispatch.
let agentLoopV2Agents: Set<AgentName> | null = null;

function agentLoopV2Enabled(agent: AgentName): boolean {
  if (!agentLoopV2Agents) agentLoopV2Agents = parseAgentLoopFlag(process.env.AGENT_LOOP_V2);
  return agentLoopV2Agents.has(agent);
}

// Convenção de porta padrão dos Node Agents genéricos (desigual-node). Em
// produção cada agente é uma máquina física separada, então todos podem
// usar a mesma porta sem conflito. Em dev, com vários nodes fake na mesma
// máquina, private_host pode incluir a porta explicitamente (host:porta).
const DEFAULT_NODE_PORT = 4001;

const STUDIO_ASPECT_RESOLUTIONS: Record<string, string> = {
  '1:1': '1088x1088',
  '4:5': '1088x1360',
  '9:16': '1088x1920',
  '16:9': '1536x864',
};

/** Converte o aspect ratio semântico do OTTO na resolução real do Studio. */
export function studioResolutionForAspectRatio(aspectRatio: string): string {
  if (/^\d{2,5}x\d{2,5}$/i.test(aspectRatio)) return aspectRatio.toLowerCase();
  return STUDIO_ASPECT_RESOLUTIONS[aspectRatio] ?? STUDIO_ASPECT_RESOLUTIONS['4:5']!;
}

export function buildNodeUrl(privateHost: string): string {
  return privateHost.includes(':')
    ? `http://${privateHost}`
    : `http://${privateHost}:${DEFAULT_NODE_PORT}`;
}

/** ~4 caracteres por token, aproximação padrão pra inglês/português - não é
 * uma contagem real (isso exigiria o mesmo tokenizer do modelo), só o
 * suficiente pra não deixar a linha de custo em zero. */
const CHARS_PER_TOKEN_ESTIMATE = 4;

/**
 * Bento (bento-qa), Jarbas e Suzy (susy-service `/internal/ask`) - os TRÊS
 * agentes reais de produção - não devolvem uso de tokens: os payloads deles
 * (ver bento-qa-client.ts e agent-ask-client.ts em packages/tool-gateway)
 * nem têm esse campo, então callBento/callJarbasOuSuzy sempre retornam
 * `usage: {0, 0}`. Sem isso, tanto recordCostEvent quanto recordTokenUsage
 * pulavam a gravação inteira (ambos checam "os dois são zero?" e saem cedo),
 * então o custo desses três nunca aparecia em relatório nenhum - "custo
 * total" na prática só somava Otto e Studio, os únicos com usage de verdade.
 * Estimativa por caracteres cobre a lacuna até o bento-qa/susy-service
 * (serviços externos, fora deste repo) passarem a reportar usage de verdade.
 */
function estimateTokenUsage(
  inputText: string,
  outputText: string | null,
): { input_tokens: number; output_tokens: number } {
  return {
    input_tokens: Math.ceil(inputText.length / CHARS_PER_TOKEN_ESTIMATE),
    output_tokens: Math.ceil((outputText ?? '').length / CHARS_PER_TOKEN_ESTIMATE),
  };
}

/**
 * Bento tem um caminho REAL e já em produção pra pergunta-resposta
 * (bento-qa, porta 8791), então o Chat central fala com ele diretamente em
 * vez de exigir o protocolo genérico `/execute` de um Node Agent que nunca
 * foi implantado na máquina dele. Jarbas e Suzy ganharam o equivalente em
 * 03/09/2026: o `POST /internal/ask` do agentes-desigual (susy-service,
 * porta 3102 nos Mac Minis deles), que despacha pro answerQuestion() de
 * cada agente reusando o cérebro real do WhatsApp. O caminho genérico
 * `/execute` continua só pro Studio e pra futuros Node Agents.
 */
/**
 * TETO do que a gente manda no campo de contexto.
 *
 * Medido em 17/09/2026: o servidor do Bento cortava acima de 16 KB DERRUBANDO a
 * conexão, e o cliente via só "fetch failed" — indistinguível de queda de rede.
 * Três perguntas da bateria falhavam sempre, e eu cheguei a diagnosticar como
 * instabilidade de tailnet. O limite de lá subiu e agora responde 413, mas o
 * conserto de lá não nos dispensa do daqui: depender do teto alheio é esperar
 * que o próximo serviço também tenha um, e que ele seja generoso.
 *
 * Corta declarando o corte. Contexto truncado em silêncio faz o agente
 * responder com metade do dossiê achando que tem o dossiê inteiro.
 */
const TETO_DE_CONTEXTO = 60_000;

export function limitarContexto(partes: Array<string | undefined>): string | undefined {
  const texto = partes.filter((t) => Boolean(t && t.trim())).join('\n\n');
  if (texto.length === 0) return undefined;
  if (texto.length <= TETO_DE_CONTEXTO) return texto;
  return `${texto.slice(0, TETO_DE_CONTEXTO)}\n\n[CONTEXTO TRUNCADO em ${TETO_DE_CONTEXTO} caracteres — havia ${texto.length}. O que veio depois deste ponto NÃO chegou até você; não conclua ausência a partir disso.]`;
}

export async function callBento(message: string, logger: Logger, operationalContext?: string): Promise<ExecuteResponse> {
  const url = process.env.BENTO_QA_URL ?? 'http://100.93.182.83:8791';
  const token = process.env.BENTO_QA_TOKEN;
  if (!token) {
    return {
      execution_id: '',
      agent: 'bento',
      status: 'failed',
      answer: null,
      sources: [],
      tool_calls: [],
      usage: { input_tokens: 0, output_tokens: 0 },
      error: 'BENTO_QA_TOKEN not configured on the Orchestrator worker',
    };
  }

  try {
    // BL-23 (auditoria forense 12/09/2026): sem timeoutMs explícito o cliente
    // usava o default de 100s, não os 120s declarados pro Bento em
    // AGENT_TIMEOUT_MS — execução lenta legítima morria 20s antes do teto
    // pensado. Agora o timeout é o mesmo valor declarado na tabela.
    const { text, citations } = await askBentoQA(
      { url, token, channel: 'whatsapp', timeoutMs: AGENT_TIMEOUT_MS.bento },
      message,
      operationalContext,
    );
    return {
      execution_id: '',
      agent: 'bento',
      status: 'completed',
      answer: text,
      sources: citations.map((c) => c.path),
      tool_calls: [],
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  } catch (error) {
    const message2 =
      error instanceof BentoQAError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    logger.error({ error: message2 }, 'bento-qa dispatch failed');
    return {
      execution_id: '',
      agent: 'bento',
      status: 'failed',
      answer: null,
      sources: [],
      tool_calls: [],
      usage: { input_tokens: 0, output_tokens: 0 },
      error: message2,
    };
  }
}

const AGENTES_ASK_DEFAULT_URL: Record<'jarbas' | 'suzy', string> = {
  jarbas: 'http://100.118.12.97:3102',
  suzy: 'http://100.86.237.73:3102',
};

function failedAgentResponse(agent: AgentName, error: string): ExecuteResponse {
  return {
    execution_id: '',
    agent,
    status: 'failed',
    answer: null,
    sources: [],
    tool_calls: [],
    usage: { input_tokens: 0, output_tokens: 0 },
    error,
  };
}

/**
 * O susy-service às vezes devolve `ok: true` com um texto que é, na
 * verdade, um erro interno DELE vazando como se fosse resposta (medido em
 * produção, 2026-09-05: Suzy respondeu literalmente "No response from
 * OpenClaw." pro usuário). askAgent() não tem como distinguir isso sozinho
 * - pra ele é só texto não-vazio, contrato cumprido. Detectar essas
 * assinaturas aqui e reclassificar como falha evita mostrar jargão técnico
 * cru pra quem só queria conversar (pedido do usuário: personalidade
 * humanizada, nunca isso vazando).
 */
const INTERNAL_LEAK_SIGNATURES = [/no response from openclaw/i];

function looksLikeInternalLeak(answer: string): boolean {
  return INTERNAL_LEAK_SIGNATURES.some((pattern) => pattern.test(answer));
}

/**
 * Diretiva interna de handoff do susy-service vazando pro chat (medido em
 * teste real, 2026-09-11): a Suzy respondeu ao usuário com
 * `pergunta pro bento: <pergunta>` em backticks - sintaxe do mecanismo
 * INTERNO dela de pedir ajuda ao Bento, que o backend do agentes-desigual
 * deveria interceptar antes de exibir. A correção de raiz fica na máquina
 * remota (prompt/serviço fora deste repo); aqui na borda a diretiva é
 * removida da resposta. Âncora nos backticks de propósito: sem eles,
 * "pergunta pro bento" pode ser texto natural legítimo e remover seria uma
 * mutilação falsa.
 */
/**
 * Diretiva interna de handoff do susy-service vazando pro chat (medido em
 * teste real, 2026-09-11): a Suzy respondeu ao usuário com
 * `pergunta pro bento: <pergunta>` em backticks - sintaxe do mecanismo
 * INTERNO dela de pedir ajuda ao Bento, que o backend do agentes-desigual
 * deveria interceptar antes de exibir. A correção de raiz fica na máquina
 * remota (prompt/serviço fora deste repo); aqui na borda a diretiva é
 * removida da resposta. Âncora nos backticks de propósito: sem eles,
 * "pergunta pro bento" pode ser texto natural legítimo e remover seria uma
 * mutilação falsa.
 *
 * 13/09/2026: o baseline de comportamento (Onda 0, caso s2) pegou um segundo
 * formato vazando: `cria uma task no clickup: ...`, mesma família (ordem
 * interna para outra ferramenta em backticks). A regex vira lista de padrões
 * da mesma família, sempre ancorada em backticks + verbo de comando interno.
 */
const INTERNAL_HANDOFF_DIRECTIVES: RegExp[] = [
  /`[^`]*pergunta pro bento\s*:[^`]*`/gi,
  /`[^`]*cria uma task no clickup\s*:[^`]*`/gi,
];

function stripInternalHandoffDirectives(answer: string): string {
  let cleaned = answer;
  for (const pattern of INTERNAL_HANDOFF_DIRECTIVES) {
    cleaned = cleaned.replace(pattern, '');
  }
  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
}

/** Ferramenta do Tool Gateway (agent_tools, seed.ts) associada à ação que o bloco [AGUARDA_APROVACAO] de cada agente protege. */
const APPROVAL_TOOL: Record<'jarbas' | 'suzy', string> = { jarbas: 'meta_ads', suzy: 'instagram' };

/**
 * Jarbas e Suzy reais via POST /internal/ask do agentes-desigual. O token é
 * único e compartilhado (API_KEYS do serviço, permission "internal_ask"),
 * mesma filosofia do BENTO_QA_TOKEN. sessionId = conversa, pra o agente
 * manter histórico entre mensagens da mesma thread do chat.
 */
export async function callAgentesDesigual(
  agent: 'jarbas' | 'suzy',
  message: string,
  sessionId: string,
  executionId: string,
  logger: Logger,
): Promise<ExecuteResponse> {
  const url =
    process.env[agent === 'jarbas' ? 'JARBAS_ASK_URL' : 'SUZY_ASK_URL'] ??
    AGENTES_ASK_DEFAULT_URL[agent];
  const token = process.env.AGENTES_ASK_TOKEN;
  if (!token) {
    return failedAgentResponse(
      agent,
      'AGENTES_ASK_TOKEN not configured on the Orchestrator worker',
    );
  }

  try {
    const answer = await askAgent(
      { url, token, agent, timeoutMs: AGENT_TIMEOUT_MS[agent] },
      message,
      sessionId,
    );
    if (looksLikeInternalLeak(answer)) {
      logger.warn(
        { agent, answer },
        'agentes-desigual returned an internal-error string as a normal answer',
      );
      return failedAgentResponse(
        agent,
        `${agent} teve um problema interno e não conseguiu responder de verdade (resposta descartada: "${answer}")`,
      );
    }

    // Ver stripInternalHandoffDirectives: remove a diretiva interna de
    // handoff que o susy-service às vezes deixa vazar na resposta. Se a
    // resposta era SÓ a diretiva, não sobrou resposta nenhuma - vira falha
    // controlada (mesmo destino do looksLikeInternalLeak acima) em vez de
    // jargão interno na tela.
    const cleanAnswer = stripInternalHandoffDirectives(answer);
    if (!cleanAnswer) {
      logger.warn(
        { agent, answer },
        'agentes-desigual answer was only an internal handoff directive',
      );
      return failedAgentResponse(
        agent,
        `${agent} acionou um mecanismo interno no lugar de responder de verdade (resposta descartada: "${answer}")`,
      );
    }

    // Barreira real de aprovação humana (até 08/09/2026 isto era só texto de
    // prompt sem enforcement nenhum, ver personalities.ts e o achado da
    // auditoria de prontidão): o agente emitiu [AGUARDA_APROVACAO] pedindo
    // pra mexer em budget de Meta Ads (Jarbas) ou publicar no Instagram
    // (Suzy). Em vez de deixar essa resposta seguir como se já estivesse
    // liberada, ela passa pelo Tool Gateway de verdade (requestToolCall) -
    // que cria um tool_call pendente e notifica os masters. O "pode ir" que
    // o prompt do agente espera só é mandado de volta a ele quando um
    // master aprova de verdade (POST /tool-calls/:id/approve, ver
    // apps/api/src/tool-calls/routes.ts) - não quando alguém digita "pode
    // ir" solto no chat, que o agente externo não teria como distinguir de
    // um "pode ir" real vindo de uma pessoa autorizada.
    const proposal = extractApprovalProposal(cleanAnswer);
    if (proposal) {
      const outcome = await requestToolCall({
        executionId,
        agent,
        tool: APPROVAL_TOOL[agent],
        input: { proposal, session_id: sessionId },
      });
      const pendingAnswer =
        outcome.status === 'denied'
          ? `Eu ia propor uma ação que precisa de aprovação, mas hoje não tenho permissão pra isso na matriz de ferramentas (tool_call ${outcome.toolCallId}). Preciso que um master ajuste minha permissão antes.`
          : `⏳ Isso precisa de aprovação humana antes de eu seguir.\n\nProposta:\n${proposal}\n\nUm master vai revisar em Aprovações (referência ${outcome.toolCallId}). Assim que aprovar, eu recebo o sinal de verdade e sigo - não antes.`;
      logger.info(
        { agent, toolCallId: outcome.toolCallId, status: outcome.status },
        'Ação sensível interceptada pelo Tool Gateway antes de seguir',
      );
      return {
        execution_id: '',
        agent,
        status: 'completed',
        answer: pendingAnswer,
        sources: [],
        tool_calls: [],
        usage: { input_tokens: 0, output_tokens: 0 },
        metadata: {
          pending_tool_call_id: outcome.toolCallId,
          pending_tool_call_status: outcome.status,
        },
      };
    }

    return {
      execution_id: '',
      agent,
      status: 'completed',
      answer: cleanAnswer,
      sources: [],
      tool_calls: [],
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  } catch (error) {
    const detail =
      error instanceof AgentAskError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    logger.error({ agent, error: detail }, 'agentes-desigual dispatch failed');
    return failedAgentResponse(agent, detail);
  }
}

async function callNode(
  agent: AgentName,
  executionId: string,
  message: string,
  contextRefs: string[],
  logger: Logger,
  sessionId?: string,
  clientBrandKit?: ClientBrandKit,
  attachments: AgentJobData['attachments'] = [],
  operationalContext?: string,
  clientFeedbackHistory: ClientFeedbackEntry[] = [],
): Promise<ExecuteResponse> {
  // Personalidade oficial (pacote v1.0, ver personalities.ts no
  // context-engine). ATENÇÃO (alinhamento de docs, 13/09/2026): desde
  // 09/09/2026 PREPEND_PERSONALITY está VAZIO e withPersonality é um no-op -
  // a personalidade vive no system prompt do serviço de cada máquina, não
  // nesta injeção. A chamada fica aqui como ponto único de reintrodução, se
  // algum serviço novo aparecer sem prompt próprio.
  const personalizedMessage = withPersonality(agent, message);

  if (agent === 'bento') {
    const result = await callBento(personalizedMessage, logger, operationalContext);
    return { ...result, execution_id: executionId };
  }

  if (agent === 'jarbas' || agent === 'suzy') {
    const result = await callAgentesDesigual(
      agent,
      personalizedMessage,
      sessionId ?? executionId,
      executionId,
      logger,
    );
    return { ...result, execution_id: executionId };
  }

  const node = await findHealthyNodeForAgent(agent);
  if (!node) {
    throw new Error(`Agent '${agent}' has no healthy node at dispatch time`);
  }

  const timeoutMs = AGENT_TIMEOUT_MS[agent];
  const url = `${buildNodeUrl(node.privateHost)}/execute`;
  logger.info({ executionId, agent, url }, 'Dispatching execution to node');

  const nodeSecret = process.env.NODE_SECRET;
  if (!nodeSecret) {
    throw new Error('NODE_SECRET not configured on the Orchestrator worker');
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${nodeSecret}` },
    body: JSON.stringify({
      execution_id: executionId,
      message,
      context_refs: contextRefs,
      // Brand kit só quando o chamador buscou (hoje: Otto, pra derivar o DNA
      // criativo no node, que não acessa o banco). Campo aditivo do protocolo;
      // nodes que não conhecem ignoram.
      ...(clientBrandKit ? { client_brand_kit: clientBrandKit } : {}),
      // Idem client_brand_kit: histórico real de aprovação/rejeição, pro
      // otto-node derivar approvedPatterns/rejectedPatterns em
      // deriveCreativeDNA em vez do `feedbacks: []` fixo de antes.
      ...(clientFeedbackHistory.length ? { client_feedback_history: clientFeedbackHistory } : {}),
      attachments,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Node returned ${response.status}: ${await response.text()}`);
  }

  return executeResponseSchema.parse(await response.json());
}

async function recordAuditLog(
  agent: AgentName,
  executionId: string,
  result: ExecuteResponse,
): Promise<void> {
  await db.insert(schema.auditLogs).values({
    action: result.status === 'completed' ? 'execution.completed' : 'execution.node_failure',
    agent,
    result: result.status,
    metadata: { execution_id: executionId, sources: result.sources, error: result.error ?? null },
  });
}

/** Fecha o ciclo User -> Conversation da seção 6.3: a resposta final também vira mensagem. */
async function recordAssistantMessage(
  conversationId: string | null,
  agent: AgentName,
  content: string | null,
): Promise<void> {
  if (!conversationId || !content) return;
  await db.insert(schema.messages).values({ conversationId, role: 'assistant', agent, content });
}

/**
 * Handoff Otto -> Studio (seção 7.3 aplicada ao diretor criativo): quando a
 * resposta do otto-node traz uma production_spec válida na metadata, ela
 * vira um job REAL na fila studio-jobs, no mesmo padrão do POST
 * /studio/jobs (apps/api/src/studio/routes.ts): insert em studio_jobs +
 * enqueue + job_id STU-XXXX.
 *
 * O client_id autoritativo é o da execution (banco), NÃO o da spec: a spec
 * atravessou um LLM e um prompt de usuário, então pode carregar até um nome
 * de cliente no lugar do uuid (ver extractClientId no otto-node). Sem
 * client_id na execution (conversa solta, sem workspace), o plano continua
 * válido como resposta de chat, mas não vira gasto de GPU.
 */
async function handoffOttoProductionSpec(
  spec: ProductionSpec,
  execution: { id: string; clientId: string | null; userId: string },
  executionId: string,
  logger: Logger,
): Promise<void> {
  if (!execution.clientId) {
    logger.info(
      { executionId },
      'Otto gerou production_spec mas a execution não tem client_id; spec fica só no chat',
    );
    return;
  }
  const clientId = execution.clientId;
  const resolution = studioResolutionForAspectRatio(spec.aspect_ratio);

  try {
    const jobId = generateStudioJobId();
    const jobMetadata: Record<string, unknown> = {
      ...spec.metadata,
      origin: 'otto',
      execution_id: executionId,
      aspect_ratio: spec.aspect_ratio,
      negative_prompt: spec.negative_prompt,
    };

    // Snapshot do brand kit, mesmo motivo do POST /studio/jobs: o worker do
    // Studio aplica paleta/tom sem consultar o banco e o job fica
    // reproduzível se o kit mudar depois.
    const [brandKit] = await db
      .select()
      .from(schema.clientBrandKits)
      .where(eq(schema.clientBrandKits.clientId, clientId));
    if (brandKit) {
      jobMetadata.brand_kit = {
        logo_url: brandKit.logoUrl,
        colors: brandKit.colors,
        fonts: brandKit.fonts,
        tone_of_voice: brandKit.toneOfVoice,
      };
    }

    // Copy automática desligada por decisão explícita do usuário (2026-09-10),
    // inclusive quando é o próprio Otto quem escreveu (spec.copy) como parte
    // do conceito criativo: nenhum caminho deve mais aplicar legenda sem um
    // clique no botão manual "Gerar legenda com Otto" (ver
    // packages/otto/src/creative/caption-from-image.ts,
    // apps/api/src/studio/routes.ts POST /studio/assets/:id/caption).
    const attachments = spec.reference_assets;

    const [job] = await db
      .insert(schema.studioJobs)
      .values({
        jobId,
        clientId,
        requestedBy: execution.userId,
        projectId: null,
        type: spec.job_type,
        prompt: spec.prompt,
        resolution,
        attachments,
        status: 'queued',
        numSlides: spec.job_type === 'carousel' ? (spec.slides?.length ?? 10) : null,
        durationSeconds: null,
        qualityPreset: spec.quality,
        includeText: false,
        style: 'padrao',
        variations: 1,
        metadata: jobMetadata,
        caption: null,
        copySlides: null,
      })
      .returning();

    if (!job) {
      throw new Error('studio_jobs insert returned no row');
    }

    await getStudioJobQueue().add('generate', {
      studioJobDbId: job.id,
      jobId: job.jobId,
      clientId,
      requestedBy: execution.userId,
      projectId: null,
      type: spec.job_type,
      prompt: spec.prompt,
      resolution,
      attachments,
      numSlides: job.numSlides,
      durationSeconds: job.durationSeconds,
      qualityPreset: job.qualityPreset,
      includeText: job.includeText,
      copySlides: job.copySlides,
      style: job.style,
      variations: job.variations,
      metadata: jobMetadata,
    });

    await recordLearning({
      kind: 'otto.studio_handoff',
      content: `Otto gerou spec de produção (${spec.job_type}) que virou o job ${job.jobId} do Studio.`,
      agent: 'otto',
      clientId,
      userId: execution.userId,
      metadata: { execution_id: executionId, studio_job_id: job.jobId, job_type: spec.job_type },
    });
    logger.info(
      { executionId, studioJobId: job.jobId, jobType: spec.job_type },
      'Otto production_spec enfileirada no Studio',
    );
  } catch (error) {
    // O handoff é efeito colateral da execução, não a execução: a resposta
    // criativa do Otto JÁ foi entregue no chat e gravada. Derrubar o job aqui
    // (rethrow) marcaria a execution como failed e apagaria do usuário um
    // trabalho que deu certo - além de reenfileirar e cobrar o LLM de novo.
    // Registra em audit_log pra ninguém perder o rastro e segue.
    logger.error(
      { error, executionId },
      'Falha no handoff Otto -> Studio (a execução do Otto segue concluída)',
    );
    await db.insert(schema.auditLogs).values({
      action: 'otto.studio_handoff_failed',
      agent: 'otto',
      result: 'failed',
      metadata: {
        execution_id: executionId,
        client_id: clientId,
        reason: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

/** Aprendizado do ciclo criativo do Otto: plano gerado e, se houver spec, handoff pro Studio. */
async function recordOttoCreativeCycle(
  result: ExecuteResponse,
  execution: { id: string; clientId: string | null; userId: string },
  executionId: string,
  logger: Logger,
): Promise<void> {
  const rawPlan = result.metadata?.creative_plan;
  if (rawPlan) {
    const plan = creativePlanSchema.safeParse(rawPlan);
    await recordLearning({
      kind: 'otto.creative_plan_created',
      content: plan.success
        ? `Otto criou plano criativo "${plan.data.concept}" (objetivo: ${plan.data.objective}).`
        : 'Otto criou um plano criativo (payload fora do schema esperado).',
      agent: 'otto',
      clientId: execution.clientId,
      userId: execution.userId,
      metadata: { execution_id: executionId, plan_valid: plan.success },
    });
  }

  const rawSpec = result.metadata?.production_spec;
  if (!rawSpec) return;
  const parsed = productionSpecSchema.safeParse(rawSpec);
  if (!parsed.success) {
    // Spec inválida NÃO vira job: enfileirar payload fora do contrato
    // studio-jobs quebraria o studio-node na máquina da GPU. Loga e audita.
    logger.warn(
      { executionId, error: parsed.error.message },
      'Otto devolveu production_spec fora do schema; handoff ignorado',
    );
    await db.insert(schema.auditLogs).values({
      action: 'otto.studio_handoff_rejected',
      agent: 'otto',
      result: 'failed',
      metadata: { execution_id: executionId, reason: parsed.error.message },
    });
    return;
  }
  await handoffOttoProductionSpec(parsed.data, execution, executionId, logger);
}

/**
 * Entrega o texto de resposta via WS assim que existe, em vez do front
 * depender só do refetch disparado por `execution.completed` (que existe,
 * mas é um GET a mais depois do evento - aqui o texto já vai junto do
 * evento). `delta` é sempre o texto ACUMULADO até agora (não um diff) -
 * contrato pensado pra sobreviver a uma mensagem WS perdida/fora de ordem
 * (o próximo evento reafirma o texto inteiro, nunca depende do anterior ter
 * chegado). Hoje só existe um único evento por execução (`done: true` com a
 * resposta inteira, já que nenhum agente gera token a token pro Chat ainda);
 * um agente com streaming real de verdade (ex: Suzy via SSE) publicaria
 * vários eventos com `done: false` no meio, mesmo contrato. Privado por
 * padrão (`conversations.visibility`, mesma regra de POST /chat): sem checar
 * isso aqui, o texto de uma conversa privada vazaria pra toda conexão WS
 * aberta, já que o handler de `/ws` faz broadcast por padrão (só
 * `dm.received` tinha esse filtro até aqui).
 */
async function publishMessageDelta(params: {
  conversationId: string | null;
  executionId: string;
  agent: AgentName;
  delta: string;
  done: boolean;
}): Promise<void> {
  const { conversationId, executionId, agent, delta, done } = params;
  if (!conversationId || !delta) return;
  const [meta] = await db
    .select({ userId: schema.conversations.userId, visibility: schema.conversations.visibility })
    .from(schema.conversations)
    .where(eq(schema.conversations.id, conversationId));
  if (!meta) return;
  await publishWsEvent({
    type: 'message.delta',
    payload: {
      execution_id: executionId,
      conversation_id: conversationId,
      agent,
      delta,
      done,
      owner_user_id: meta.userId,
      visibility: meta.visibility,
    },
  });
}

/**
 * Notificação de "terminei" pro dono da execution (pedido do usuário,
 * 2026-09-03): com chat compartilhado e várias conversas rodando em
 * paralelo em background, é assim que ele sabe que o Bento/Jarbas/Suzy
 * terminou sem precisar ficar com a aba daquela conversa aberta. Só faz
 * sentido pra execution de CHAT (tem conversationId) - jobs do Studio já
 * notificam por conta própria (nodes/studio-node), não duplicar aqui.
 */
/**
 * Texto que o usuário vê quando o agente devolveu FALHA sem lançar exceção.
 *
 * Achado real (11/09/2026): `callBento`/`callAgentesDesigual` não lançam - eles
 * RETORNAM `{status:'failed', error:'...'}` com o motivo verdadeiro dentro. Só
 * que o gravador do step montava `output: { answer, sources }` e descartava
 * `error`, então o step ficava `{"answer":null,"sources":[]}` (medido no banco,
 * execução bento/manual_override das 12:02Z) e o chat caía no texto genérico
 * "Tente reformular a pergunta". Naquele caso concreto o motivo real era um
 * HTTP 502 do bento-qa - "o motor de texto não respondeu em 30s" -, ou seja, a
 * tela mandava a pessoa reescrever uma pergunta que não tinha defeito nenhum,
 * enquanto o defeito era de infraestrutura. São reações opostas: uma a pessoa
 * refaz a pergunta, a outra ela vai ligar uma máquina.
 */
export function failureAnswerFor(agent: AgentName, error: string | null | undefined): string {
  const label = agent.charAt(0).toUpperCase() + agent.slice(1);
  const detalhe = (error ?? '').trim();
  return detalhe
    ? `Não consegui responder agora: ${detalhe}`
    : `Não consegui responder agora e ${label} não informou o motivo.`;
}

async function notifyChatCompletion(
  userId: string | undefined,
  agent: AgentName,
  conversationId: string | null,
  status: 'completed' | 'failed',
  answer: string | null,
): Promise<void> {
  if (!userId || !conversationId) return;
  const label = agent.charAt(0).toUpperCase() + agent.slice(1);
  const title = status === 'completed' ? `${label} respondeu` : `${label} não conseguiu responder`;
  // Na falha, `answer` já vem preenchido com o motivo real (ver
  // failureAnswerFor). O texto fixo antigo mandava reformular a pergunta
  // mesmo quando o problema era a máquina do agente estar fora.
  const body =
    status === 'completed'
      ? (answer ?? '').slice(0, 140)
      : (answer ?? '').trim().slice(0, 140) || 'Tente reformular a pergunta ou mandar de novo.';
  await db.insert(schema.notifications).values({
    userId,
    type: 'chat.execution_completed',
    title,
    body,
    link: `/chat?agent=${agent}&conversation=${conversationId}`,
  });
}

export async function processAgentJob(job: Job<AgentJobData>, logger: Logger): Promise<void> {
  if (job.data.workflowId !== undefined && job.data.stepIndex !== undefined) {
    await processWorkflowStep(job.data, logger);
  } else {
    await processSingleAgentJob(job.data, logger);
  }
}

async function processSingleAgentJob(data: AgentJobData, logger: Logger): Promise<void> {
  const { executionDbId, executionId, agent, message, contextRefs, conversationId, attachments, operationalContext } = data;

  const [runningExecution] = await db
    .update(schema.executions)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(schema.executions.id, executionDbId))
    .returning({ userId: schema.executions.userId, clientId: schema.executions.clientId });
  await publishWsEvent({
    type: 'execution.progress',
    payload: { execution_id: executionId, agent, status: 'running' },
  });

  // BENTO ACTION GUARD (14/09/2026): intenções de ESCRITA no ClickUp
  // (criar/atribuir/reagendar/mudar status) com alvo resolvível são
  // executadas na borda, com read-after-write e recibo, em vez de cair no
  // caminho cego do serviço remoto (que criou a task "perfeito, a ele" numa
  // conversa de atribuição). Retorna null quando não é escrita tratável: o
  // fluxo segue pro agente como antes.
  let guardedResult: ExecuteResponse | null = null;

  // FAST PATH de cortesia, ANTES de qualquer retrieval/dispatch: "Oi, tudo
  // bem?" ia parar no RAG e voltava "não consegui montar uma resposta com
  // fonte confiável" (medido no release gate). Saudação não tem fato pra
  // ancorar — gastar retrieval e evidência aqui só produz resposta errada.
  // REGISTRO DE CONHECIMENTO. Afirmação que ensina ("decidimos que...", "daqui
  // pra frente...") não é pergunta, e empurrá-la para o loop operacional fazia
  // o avaliador reprovar por não haver resposta e o replan se esgotar — medido:
  // replan_exhausted em 11s numa frase que só registrava uma decisão. Como
  // ENSINAR é o fluxo de que a memória depende, ele não pode devolver erro.
  const registro = await registrarConhecimentoDoTurno({
    message,
    clientId: runningExecution?.clientId ?? null,
    clientName: null,
    userId: runningExecution?.userId ?? null,
    agent,
    conversationId: conversationId ?? null,
    executionId,
    logger,
  }).catch(() => null);
  if (registro) {
    logger.info({ executionId, agent, tipos: registro.tipos }, '[registro] afirmação registrada sem passar pelo loop');
    guardedResult = {
      execution_id: executionId,
      agent,
      status: 'completed',
      answer: registro.answer,
      sources: [],
      tool_calls: [],
      usage: { input_tokens: 0, output_tokens: 0 },
      metadata: { fast_path: 'knowledge_statement', kinds: registro.tipos, episodios_gravados: registro.gravados },
    };
  }

  const smallTalk = !guardedResult ? detectSmallTalk(message, agent) : null;
  if (smallTalk) {
    logger.info({ executionId, agent, kind: smallTalk.kind }, "[small-talk] resposta direta, sem retrieval");
    guardedResult = {
      execution_id: executionId,
      agent,
      status: 'completed',
      answer: smallTalk.answer,
      sources: [],
      tool_calls: [],
      usage: { input_tokens: 0, output_tokens: 0 },
      metadata: { fast_path: 'small_talk', kind: smallTalk.kind },
    };
  }

  if (!guardedResult && agent === 'bento') {
    const [jobUser] = runningExecution?.userId
      ? await db.select().from(schema.users).where(eq(schema.users.id, runningExecution.userId))
      : [];    const agencyClient = await db
      .select({ clickupListId: schema.clients.clickupListId })
      .from(schema.clients)
      .where(eq(schema.clients.slug, 'agencia-desigual'))
      .limit(1);
    // Nome do cliente da execução: entra no briefing como identificação e é
    // o que torna o texto específico em vez de genérico.
    const [clienteDaExecucao] = runningExecution?.clientId
      ? await db
          .select({ name: schema.clients.name })
          .from(schema.clients)
          .where(eq(schema.clients.id, runningExecution.clientId))
          .limit(1)
          .catch(() => [])
      : [];
    const guarded = await tryBentoActionGuard({
      message,
      conversationId: conversationId ?? null,
      userName: jobUser?.name ?? jobUser?.email ?? 'usuário',
      userClickUpEmail: jobUser?.clickupEmail ?? null,
      agencyListId: agencyClient[0]?.clickupListId ?? null,
      clientId: runningExecution?.clientId ?? null,
      clientName: clienteDaExecucao?.name ?? null,
      briefingWriter: async (prompt) => {
        const brief = await callBento(prompt, logger);
        return brief.status === 'completed' ? brief.answer : null;
      },
      logger,
    }).catch((error: unknown) => {
      logger.error({ error, executionId }, 'Bento action guard falhou; seguindo pro fluxo normal do agente');
      return null;
    });
    if (guarded) {
      guardedResult = guarded;
    }
  }

  // Brand kit do cliente pro Otto derivar o DNA criativo no turno (o node
  // não acessa o banco). Só busca quando faz sentido: agente otto + execution
  // com cliente. Falha/ausência de kit não pode impedir o dispatch - o turno
  // sem DNA é o comportamento anterior, perfeitamente válido.
  let clientBrandKit: ClientBrandKit | undefined;
  let clientFeedbackHistory: ClientFeedbackEntry[] = [];
  if (agent === 'otto' && runningExecution?.clientId) {
    const [kit] = await db
      .select()
      .from(schema.clientBrandKits)
      .where(eq(schema.clientBrandKits.clientId, runningExecution.clientId));
    if (kit) {
      clientBrandKit = {
        colors: kit.colors,
        fonts: kit.fonts,
        tone_of_voice: kit.toneOfVoice,
        logo_url: kit.logoUrl,
      };
    }

    // Aprendizado real de identidade visual: feedback humano já gravado em
    // `memories` (kind otto.feedback, ver POST /studio/assets/:id/feedback)
    // vira o histórico que deriveCreativeDNA usa pra achar padrões
    // aprovados/rejeitados - antes desta busca, o node sempre recebia
    // `feedbacks: []` e o DNA nunca saía de zero.
    const feedbackMemories = await recallMemories({
      clientId: runningExecution.clientId,
      kinds: ['otto.feedback'],
      limit: 30,
    });
    clientFeedbackHistory = feedbackMemories
      .map((memory) => {
        const verdict = (memory.metadata as { verdict?: string } | null)?.verdict;
        if (verdict !== 'approved' && verdict !== 'rejected' && verdict !== 'needs_iteration') {
          return null;
        }
        const reason = (memory.metadata as { reason?: string } | null)?.reason;
        return { verdict, reason: reason ?? '', context: '' } satisfies ClientFeedbackEntry;
      })
      .filter((entry): entry is ClientFeedbackEntry => entry !== null);

    // Regras que o funil de confiança já promoveu (validated pra cima, ver
    // apps/api/src/studio/otto-learnings.ts) entram como feedback
    // consolidado: o DNA passa a derivar de padrões CONFIRMADOS por
    // evidência humana recorrente, não só de feedback individual solto.
    const promotedLearnings = await recallMemories({
      clientId: runningExecution.clientId,
      kinds: ['otto.approval_reason', 'otto.rejection_reason'],
      limit: 20,
    });
    for (const memory of promotedLearnings) {
      const stage = (memory.metadata as { otto_learning?: { stage?: string } } | null)?.otto_learning?.stage;
      if (stage !== 'validated' && stage !== 'trusted' && stage !== 'core') continue;
      clientFeedbackHistory.push({
        verdict: memory.kind === 'otto.approval_reason' ? 'approved' : 'rejected',
        reason: memory.content,
        context: `regra ${stage} do funil de aprendizado (confiança ${memory.confidence ?? 'n/a'})`,
      });
    }
  }

  let result: ExecuteResponse;
  let usageEstimated = false;
  if (guardedResult) {
    result = guardedResult;
  } else try {
    if (agentLoopV2Enabled(agent)) {
      // Caminho agêntico: o callNode vira uma ferramenta dentro do loop
      // understand→context→plan→act→observe→evaluate→replan, com checkpoint
      // no Postgres e outcome gravado por execução.
      result = await dispatchWithAgentLoop({
        data,
        userId: runningExecution?.userId ?? null,
        clientId: runningExecution?.clientId ?? null,
        clientBrandKit,
        clientFeedbackHistory,
        logger,
        callAgent: (msg, contextoApartado) =>
          callNode(
            agent,
            executionId,
            msg,
            contextRefs,
            logger,
            conversationId ?? undefined,
            clientBrandKit,
            attachments,
            // O contexto apartado entra pelo campo próprio, junto com o que já
            // viesse de operacional. Ver `aceitaContextoNaMensagem`: pro Bento,
            // contexto dentro da pergunta sequestra a intenção dele.
            limitarContexto([operationalContext, contextoApartado]),
            clientFeedbackHistory,
          ),
      });
    } else {
      result = await callNode(
        agent,
        executionId,
        message,
        contextRefs,
        logger,
        conversationId ?? undefined,
        clientBrandKit,
        attachments,
        operationalContext,
        clientFeedbackHistory,
      );
    }
    // Regra de ouro de craft: bot nunca usa travessão. Aplicado na borda,
    // porque os prompts dos agentes vivem nas máquinas deles. Os marcadores
    // [FIM_BLOCO] dos prompts de personalidade viram parágrafo aqui também.
    if (result.answer)
      result = { ...result, answer: stripMarkdownArtifacts(stripBlockMarkers(stripEmDashes(result.answer))) };
    // Ver estimateTokenUsage acima: sem isso, Bento/Jarbas/Suzy nunca geravam
    // linha de custo nenhuma (usage sempre {0,0} vindo deles).
    if (result.usage.input_tokens === 0 && result.usage.output_tokens === 0 && result.answer) {
      usageEstimated = true;
      result = { ...result, usage: estimateTokenUsage(message, result.answer) };
    }
  } catch (error) {
    await failExecution(executionDbId, error instanceof Error ? error.message : String(error));
    await publishWsEvent({
      type: 'execution.completed',
      payload: { execution_id: executionId, agent, status: 'failed' },
    });
    await notifyChatCompletion(runningExecution?.userId, agent, conversationId, 'failed', null);
    throw error;
  }

  const now = new Date();
  // Agente que devolveu falha (sem lançar) traz o motivo em `result.error`;
  // sem isto ele morria aqui e o chat mostrava "reformule a pergunta" pra uma
  // queda de infraestrutura. Ver failureAnswerFor.
  const failureAnswer = result.status === 'failed' ? failureAnswerFor(agent, result.error) : null;
  // callNode() já teve sucesso aqui - o agente já respondeu de verdade (e no
  // caso de Jarbas/Suzy, uma resposta real pode já ter saído no WhatsApp do
  // lead). Tudo daqui pra baixo é só gravação/pós-processamento: se algo
  // falhar (ex: hiccup transitório do Postgres), NUNCA deixa a exceção
  // subir - isso faria o BullMQ reprocessar o job inteiro (attempts: 2) e
  // rechamar o agente de verdade uma 2ª vez, duplicando mensagem/custo. O
  // pior caso aceitável aqui é um registro incompleto, nunca uma ação
  // externa repetida.
  let execution: { id: string; userId: string; clientId: string | null } | undefined;
  try {
    [execution] = await db
      .update(schema.executions)
      .set({
        status: result.status,
        completedAt: now,
        tokensInput: result.usage.input_tokens,
        tokensOutput: result.usage.output_tokens,
      })
      .where(eq(schema.executions.id, executionDbId))
      .returning({
        id: schema.executions.id,
        userId: schema.executions.userId,
        clientId: schema.executions.clientId,
      });

    await recordTokenUsage(executionDbId, result);
    await recordAuditLog(agent, executionId, result);
    await recordAssistantMessage(conversationId, agent, result.answer);
    // Sem isso, GET /executions/:id sempre devolvia steps: [] pro caminho de
    // agente único (só processWorkflowStep grava execution_steps) - o balão
    // do chat lê execution.steps.at(-1) e ficava vazio mesmo quando o agente
    // respondeu certo (a resposta existia em `messages`, só não chegava aqui).
    // onConflictDoUpdate porque este job pode rodar com attempts > 1
    // (AGENT_MAX_ATTEMPTS, hoje só bento/otto/studio) - uma 2ª tentativa
    // reexecuta esta função inteira e um insert puro bateria na
    // unique(executionId, stepIndex) da 1ª tentativa.
    await db
      .insert(schema.executionSteps)
      .values({
        executionId: executionDbId,
        stepIndex: 0,
        agent,
        status: result.status,
        output: {
          answer: result.answer ?? failureAnswer,
          sources: result.sources,
          ...(result.error ? { error: result.error } : {}),
          // Metadata do node (timings de fase do Otto: classify_ms,
          // retrieval_ms, llm_ms; bloco agentic do loop V2) — antes era
          // descartada, então a análise fina de latência era impossível
          // (achado 4 da Onda 0, 12/09/2026).
          ...(result.metadata ? { metadata: result.metadata } : {}),
        },
        startedAt: now,
        completedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.executionSteps.executionId, schema.executionSteps.stepIndex],
        set: {
          status: result.status,
          output: {
            answer: result.answer ?? failureAnswer,
            sources: result.sources,
            ...(result.error ? { error: result.error } : {}),
            ...(result.metadata ? { metadata: result.metadata } : {}),
          },
          completedAt: now,
        },
      });
    if (execution) {
      await recordCostForStep(
        execution.clientId,
        execution.userId,
        executionDbId,
        agent,
        result.usage,
        usageEstimated,
      );
      await finalizeExecutionCost(executionDbId);
    }
    // Handoff criativo do Otto: roda DEPOIS de custo/audit gravados pra que,
    // mesmo se o handoff falhar, a execução já esteja fechada e contabilizada.
    if (agent === 'otto' && result.status === 'completed' && execution) {
      await recordOttoCreativeCycle(result, execution, executionId, logger);
    }
  } catch (error) {
    logger.error(
      { error, executionId, agent },
      'Falha ao gravar efeitos colaterais pós-execução (não reprocessa: o agente já respondeu)',
    );
  }

  if (result.status !== 'failed' && result.answer) {
    await publishMessageDelta({
      conversationId,
      executionId,
      agent,
      delta: result.answer,
      done: true,
    });
  }
  await publishWsEvent({
    type: 'execution.completed',
    payload: { execution_id: executionId, agent, status: result.status },
  });
  await notifyChatCompletion(
    execution?.userId ?? runningExecution?.userId,
    agent,
    conversationId,
    result.status === 'failed' ? 'failed' : 'completed',
    result.answer ?? failureAnswer,
  );

  if (result.status === 'failed') {
    throw new Error(result.error ?? 'Node reported failure');
  }
}

async function recordCostForStep(
  clientId: string | null,
  userId: string,
  executionDbId: string,
  agent: AgentName,
  usage: { input_tokens: number; output_tokens: number },
  estimated: boolean,
): Promise<void> {
  await recordCostEvent({
    executionDbId,
    clientId,
    userId,
    agent,
    model: 'unknown',
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    estimated,
  });
}

/**
 * Etapa de um workflow multi agente (Fase 10). Cada etapa some no seu
 * próprio job; ao terminar, encadeia a próxima (mesmo execution_id, mesma
 * linha em executions até a última etapa) ou fecha o workflow inteiro.
 */
async function processWorkflowStep(data: AgentJobData, logger: Logger): Promise<void> {
  const {
    executionDbId,
    executionId,
    agent,
    message,
    contextRefs,
    conversationId,
    workflowId,
    stepIndex,
    attachments,
  } = data;
  if (workflowId === undefined || stepIndex === undefined) {
    throw new Error('processWorkflowStep called without workflowId/stepIndex');
  }

  await db
    .update(schema.executionSteps)
    .set({ status: 'running', startedAt: new Date() })
    .where(
      and(
        eq(schema.executionSteps.executionId, executionDbId),
        eq(schema.executionSteps.stepIndex, stepIndex),
      ),
    );
  await db
    .update(schema.workflowSteps)
    .set({ status: 'running' })
    .where(
      and(
        eq(schema.workflowSteps.workflowId, workflowId),
        eq(schema.workflowSteps.stepIndex, stepIndex),
      ),
    );
  if (stepIndex === 0) {
    await db
      .update(schema.executions)
      .set({ status: 'running', startedAt: new Date() })
      .where(eq(schema.executions.id, executionDbId));
  }
  await publishWsEvent({
    type: 'execution.progress',
    payload: { execution_id: executionId, agent, step_index: stepIndex, status: 'running' },
  });

  let result: ExecuteResponse;
  let usageEstimated = false;
  try {
    result = await callNode(
      agent,
      executionId,
      message,
      contextRefs,
      logger,
      conversationId ?? undefined,
      undefined,
      attachments,
    );
    if (result.answer)
      result = { ...result, answer: stripMarkdownArtifacts(stripBlockMarkers(stripEmDashes(result.answer))) };
    // Ver estimateTokenUsage: mesma lacuna do caminho de agente único quando
    // a etapa é Bento/Jarbas/Suzy.
    if (result.usage.input_tokens === 0 && result.usage.output_tokens === 0 && result.answer) {
      usageEstimated = true;
      result = { ...result, usage: estimateTokenUsage(message, result.answer) };
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await failWorkflowStep(executionDbId, workflowId, stepIndex, reason);
    await publishWsEvent({
      type: 'execution.completed',
      payload: { execution_id: executionId, agent, step_index: stepIndex, status: 'failed' },
    });
    throw error;
  }

  const now = new Date();
  await db
    .update(schema.executionSteps)
    .set({
      status: result.status,
      output: { answer: result.answer, sources: result.sources },
      completedAt: now,
    })
    .where(
      and(
        eq(schema.executionSteps.executionId, executionDbId),
        eq(schema.executionSteps.stepIndex, stepIndex),
      ),
    );
  await db
    .update(schema.workflowSteps)
    .set({ status: result.status })
    .where(
      and(
        eq(schema.workflowSteps.workflowId, workflowId),
        eq(schema.workflowSteps.stepIndex, stepIndex),
      ),
    );

  await recordTokenUsage(executionDbId, result);
  await recordAuditLog(agent, executionId, result);

  const [execution] = await db
    .select()
    .from(schema.executions)
    .where(eq(schema.executions.id, executionDbId));
  if (execution) {
    await recordCostForStep(
      execution.clientId,
      execution.userId,
      executionDbId,
      agent,
      result.usage,
      usageEstimated,
    );
  }

  if (result.status === 'failed') {
    await failWorkflowStep(
      executionDbId,
      workflowId,
      stepIndex,
      result.error ?? 'Node reported failure',
    );
    await publishWsEvent({
      type: 'execution.completed',
      payload: { execution_id: executionId, agent, step_index: stepIndex, status: 'failed' },
    });
    throw new Error(result.error ?? 'Node reported failure');
  }
  if (result.answer) {
    await publishMessageDelta({ conversationId, executionId, agent, delta: result.answer, done: true });
  }
  await publishWsEvent({
    type: 'execution.progress',
    payload: { execution_id: executionId, agent, step_index: stepIndex, status: result.status },
  });

  const [workflow] = await db
    .select()
    .from(schema.workflows)
    .where(eq(schema.workflows.id, workflowId));
  const definition = (workflow?.definition ?? []) as AgentName[];
  const nextIndex = stepIndex + 1;
  const nextAgent = definition[nextIndex];

  if (nextAgent) {
    const chainedMessage = await buildChainedMessage({
      executionDbId,
      originalMessage: message,
      currentStepIndex: stepIndex,
      currentAgent: agent,
      currentAnswer: result.answer,
      nextAgent,
    });
    const queue = getAgentQueue(nextAgent);
    await queue.add(
      'execute',
      {
        executionDbId,
        executionId,
        agent: nextAgent,
        message: chainedMessage,
        contextRefs,
        ...(attachments?.length ? { attachments } : {}),
        conversationId,
        workflowId,
        stepIndex: nextIndex,
      },
      // Antes hardcoded em P1: uma execution 'low' criada como P3 virava a
      // prioridade máxima do BullMQ assim que a 2ª etapa era encadeada,
      // contradizendo a prioridade que o Router/complexidade calculou pra
      // ela na 1ª etapa (workflow-service.ts).
      {
        priority: PRIORITY_VALUE[execution?.priority ?? 'P2'],
        attempts: AGENT_MAX_ATTEMPTS[nextAgent],
        backoff: { type: 'fixed', delay: 2000 },
      },
    );
    logger.info({ executionId, nextAgent, nextIndex }, 'Chained next workflow step');
  } else {
    // Última etapa: soma o consumo de todas as etapas do workflow pro total
    // da execution (cada etapa já gravou a própria linha em token_usage).
    const usageRows = await db
      .select({
        inputTokens: schema.tokenUsage.inputTokens,
        outputTokens: schema.tokenUsage.outputTokens,
      })
      .from(schema.tokenUsage)
      .where(eq(schema.tokenUsage.executionId, executionDbId));
    const totalInput = usageRows.reduce((sum, row) => sum + row.inputTokens, 0);
    const totalOutput = usageRows.reduce((sum, row) => sum + row.outputTokens, 0);

    await db
      .update(schema.executions)
      .set({
        status: 'completed',
        completedAt: now,
        tokensInput: totalInput,
        tokensOutput: totalOutput,
      })
      .where(eq(schema.executions.id, executionDbId));
    await db
      .update(schema.workflows)
      .set({ status: 'completed' })
      .where(eq(schema.workflows.id, workflowId));
    await finalizeExecutionCost(executionDbId);

    // CONSOLIDAÇÃO (antes não existia). Até 10/09/2026 a resposta final do workflow era
    // literalmente a do ÚLTIMO agente, e as respostas das etapas anteriores morriam em
    // `execution_steps.output` sem nunca chegar ao usuário: um workflow de 4 etapas
    // entregava 1/4 do trabalho. Agora a resposta persistida é a consolidação de todas as
    // contribuições, com atribuição por agente.
    const consolidated = await consolidateWorkflowAnswer(executionDbId, definition, result.answer);
    await recordAssistantMessage(conversationId, agent, consolidated);
    await publishMessageDelta({
      conversationId,
      executionId,
      agent,
      delta: consolidated,
      done: true,
    });
    await publishWsEvent({
      type: 'execution.completed',
      payload: { execution_id: executionId, agent, status: 'completed' },
    });
    await notifyChatCompletion(
      execution?.userId,
      agent,
      conversationId,
      'completed',
      consolidated,
    );
    logger.info({ executionId, totalInput, totalOutput, steps: definition.length }, 'Workflow completed');
  }
}

/** Quanto de cada contribuição anterior viaja pra próxima etapa. */
const CONTRIBUTION_CHARS = 1200;
/** Quantas contribuições anteriores, no máximo (as mais recentes). */
const MAX_CONTRIBUTIONS = 3;

const AGENT_ROLE: Record<AgentName, string> = {
  bento: 'operação e memória institucional',
  jarbas: 'tráfego e performance',
  suzy: 'relacionamento e social selling',
  otto: 'direção criativa',
  studio: 'produção de mídia',
};

/**
 * Mensagem da próxima etapa do workflow.
 *
 * O que era feito antes: `mensagemAnterior + "\n\nResultado da etapa anterior..."`, de forma
 * CUMULATIVA — a etapa 4 recebia a transcrição inteira das etapas 1 a 3 concatenada, sem
 * teto de tamanho. Dois defeitos reais nisso:
 *  1. crescimento ilimitado (o prompt da última etapa era o maior de todos, justamente onde
 *     o contexto útil deveria ser o mais enxuto);
 *  2. o único workflow existente TERMINA no Bento, e o backend do Bento usa a mensagem
 *     INTEIRA como consulta vetorial — então toda a transcrição acumulada entrava no
 *     embedding da busca e puxava documento errado do vault.
 *
 * Agora: a pergunta ORIGINAL do usuário volta a ser a primeira linha (é ela que deve guiar
 * a busca), as contribuições anteriores vêm lidas do banco (`execution_steps.output`),
 * limitadas às 3 últimas e truncadas, num bloco claramente delimitado. Nada de acumular
 * texto de etapa em etapa.
 */
export async function buildChainedMessage(params: {
  executionDbId: string;
  originalMessage: string;
  currentStepIndex: number;
  currentAgent: AgentName;
  currentAnswer: string | null;
  nextAgent: AgentName;
}): Promise<string> {
  const { executionDbId, originalMessage, currentStepIndex, currentAgent, currentAnswer, nextAgent } = params;

  // A pergunta original é a primeira linha da mensagem da etapa 0; recupera dela em vez de
  // reconstruir, pra que a partir da etapa 2 a pergunta não venha já contaminada.
  const [primeiraEtapa] = await db
    .select({ input: schema.executionSteps.input })
    .from(schema.executionSteps)
    .where(and(eq(schema.executionSteps.executionId, executionDbId), eq(schema.executionSteps.stepIndex, 0)));
  const perguntaOriginal =
    (primeiraEtapa?.input as { message?: string } | null)?.message?.split('\n\n---\n')[0]?.trim() ||
    originalMessage.split('\n\n---\n')[0]!.trim();

  const anteriores = await db
    .select({
      stepIndex: schema.executionSteps.stepIndex,
      agent: schema.executionSteps.agent,
      output: schema.executionSteps.output,
    })
    .from(schema.executionSteps)
    .where(eq(schema.executionSteps.executionId, executionDbId));

  const contribuicoes = anteriores
    .filter((step) => step.stepIndex < currentStepIndex)
    .sort((a, b) => a.stepIndex - b.stepIndex)
    .map((step) => ({
      agent: step.agent as AgentName,
      answer: ((step.output as { answer?: string } | null)?.answer ?? '').trim(),
    }))
    .filter((step) => step.answer.length > 0);

  if (currentAnswer?.trim()) {
    contribuicoes.push({ agent: currentAgent, answer: currentAnswer.trim() });
  }

  const recentes = contribuicoes.slice(-MAX_CONTRIBUTIONS);
  if (recentes.length === 0) return perguntaOriginal;

  const bloco = recentes
    .map((c) => `[${c.agent} — ${AGENT_ROLE[c.agent]}]\n${c.answer.slice(0, CONTRIBUTION_CHARS)}`)
    .join('\n\n');

  return [
    perguntaOriginal,
    '---',
    `Você é a etapa de ${AGENT_ROLE[nextAgent]} deste pedido. O que os outros agentes já produziram:`,
    bloco,
    '---',
    'Contribua com a SUA parte. Não repita o que já foi dito acima.',
  ].join('\n\n');
}

/**
 * Junta as contribuições de todas as etapas numa resposta única e atribuída.
 *
 * É consolidação DETERMINÍSTICA de propósito: não gasta uma chamada de LLM só pra costurar
 * texto, não pode alucinar, e funciona mesmo quando o provedor de LLM está fora (situação
 * real hoje, com a conta OpenAI sem crédito). O ganho principal não é estilo — é que as
 * respostas das etapas intermediárias deixam de ser descartadas.
 *
 * `fallbackAnswer` é a resposta da última etapa: usada quando, por qualquer motivo, não há
 * nada legível em `execution_steps` (nunca devolve string vazia pro usuário).
 */
export async function consolidateWorkflowAnswer(
  executionDbId: string,
  definition: AgentName[],
  fallbackAnswer: string | null,
): Promise<string> {
  const steps = await db
    .select({
      stepIndex: schema.executionSteps.stepIndex,
      agent: schema.executionSteps.agent,
      output: schema.executionSteps.output,
      status: schema.executionSteps.status,
    })
    .from(schema.executionSteps)
    .where(eq(schema.executionSteps.executionId, executionDbId));

  const contribuicoes = steps
    .sort((a, b) => a.stepIndex - b.stepIndex)
    .map((step) => ({
      agent: step.agent as AgentName,
      answer: ((step.output as { answer?: string } | null)?.answer ?? '').trim(),
    }))
    .filter((c) => c.answer.length > 0);

  if (contribuicoes.length === 0) return (fallbackAnswer ?? '').trim();
  // Workflow de uma etapa só (ou onde só uma etapa produziu texto): não há o que
  // consolidar, e enfeitar com cabeçalho de seção só polui a resposta.
  if (contribuicoes.length === 1) return contribuicoes[0]!.answer;

  // Se o mesmo agente aparece duas vezes na definição (o caso real
  // bento -> jarbas -> studio -> bento), a última passagem dele é a que vale: ela já foi
  // escrita vendo o trabalho dos outros.
  const ultimaPorAgente = new Map<AgentName, string>();
  for (const c of contribuicoes) ultimaPorAgente.set(c.agent, c.answer);

  const ordem = definition.filter((agent, index) => definition.lastIndexOf(agent) === index);
  const partes: string[] = [];
  for (const agent of ordem) {
    const answer = ultimaPorAgente.get(agent);
    if (!answer) continue;
    partes.push(`${AGENT_ROLE[agent].toUpperCase()} (${agent})\n${answer}`);
    ultimaPorAgente.delete(agent);
  }
  // Qualquer agente que respondeu mas não estava na definição (não deveria acontecer) entra
  // no fim em vez de ser perdido.
  for (const [agent, answer] of ultimaPorAgente) {
    partes.push(`${AGENT_ROLE[agent].toUpperCase()} (${agent})\n${answer}`);
  }

  return partes.join('\n\n');
}

async function recordTokenUsage(executionDbId: string, result: ExecuteResponse): Promise<void> {
  if (result.usage.input_tokens > 0 || result.usage.output_tokens > 0) {
    await db.insert(schema.tokenUsage).values({
      executionId: executionDbId,
      model: 'unknown', // Node ainda não devolve qual modelo o OpenClaw usou; ver Fase 04.
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
    });
  }
}

async function failExecution(executionDbId: string, reason: string): Promise<void> {
  const now = new Date();
  await db
    .update(schema.executions)
    .set({ status: 'failed', completedAt: now })
    .where(eq(schema.executions.id, executionDbId));

  // Falha SEM step registrado virava bolha vazia no chat (defeito medido ao vivo em 08/09/2026,
  // briefing da Fratelli pro Otto): o front lê `execution.steps.at(-1)?.answer` pra preencher o
  // balão, e se não existe step nenhum ele preenche com string vazia. O usuário via o Otto
  // "não responder", quando na verdade tinha falhado com um motivo conhecido.
  //
  // Só grava quando a execução não tem step NENHUM: se já existe (workflow multi-etapa, ou uma
  // etapa que concluiu antes da falha), quem manda é o step real - sobrescrever apagaria a
  // resposta de uma etapa que deu certo.
  const existingSteps = await db
    .select({ stepIndex: schema.executionSteps.stepIndex })
    .from(schema.executionSteps)
    .where(eq(schema.executionSteps.executionId, executionDbId))
    .limit(1);

  if (existingSteps.length === 0) {
    const [execution] = await db
      .select({ agent: schema.executions.agent })
      .from(schema.executions)
      .where(eq(schema.executions.id, executionDbId))
      .limit(1);

    if (execution) {
      await db
        .insert(schema.executionSteps)
        .values({
          executionId: executionDbId,
          stepIndex: 0,
          agent: execution.agent,
          status: 'failed',
          output: { answer: `Não consegui responder agora: ${reason}`, sources: [] },
          startedAt: now,
          completedAt: now,
        })
        .onConflictDoNothing({
          target: [schema.executionSteps.executionId, schema.executionSteps.stepIndex],
        });
    }
  }

  await db.insert(schema.auditLogs).values({
    action: 'execution.failed',
    result: 'failed',
    metadata: { execution_db_id: executionDbId, reason },
  });
}

async function failWorkflowStep(
  executionDbId: string,
  workflowId: string,
  stepIndex: number,
  reason: string,
): Promise<void> {
  const now = new Date();
  await db
    .update(schema.executionSteps)
    .set({ status: 'failed', completedAt: now })
    .where(
      and(
        eq(schema.executionSteps.executionId, executionDbId),
        eq(schema.executionSteps.stepIndex, stepIndex),
      ),
    );
  await db
    .update(schema.workflowSteps)
    .set({ status: 'failed' })
    .where(
      and(
        eq(schema.workflowSteps.workflowId, workflowId),
        eq(schema.workflowSteps.stepIndex, stepIndex),
      ),
    );
  await db
    .update(schema.executions)
    .set({ status: 'failed', completedAt: now })
    .where(eq(schema.executions.id, executionDbId));
  await db
    .update(schema.workflows)
    .set({ status: 'failed' })
    .where(eq(schema.workflows.id, workflowId));

  await db.insert(schema.auditLogs).values({
    action: 'execution.failed',
    result: 'failed',
    metadata: {
      execution_db_id: executionDbId,
      workflow_id: workflowId,
      step_index: stepIndex,
      reason,
    },
  });
}

import {
  buildPlan,
  createInitialState,
  DEFAULT_STEP_LIMITS,
  groundClaims,
  inferPlanSignals,
  runStepLoop,
  type AgentExecutionState,
  type AgentPlan,
  type Evidence,
  type EvidenceRef,
  type StepHandler,
  type StepLoopHooks,
  type TaskClass,
} from '@desigual-os/agent-runtime';
import { db, schema } from '@desigual-os/database';
import { eq } from 'drizzle-orm';
import type { AgentJobData } from '@desigual-os/orchestrator';
import { publishWsEvent, recallMemories, rememberFact } from '@desigual-os/orchestrator';
import type { ExecuteResponse } from '@desigual-os/node-protocol';
import type { ClientBrandKit, ClientFeedbackEntry } from '@desigual-os/node-protocol';
import type { AgentName } from '@desigual-os/types';
import { classifyTask, evaluatorFor, goalFor, successCriteriaFor } from './agentic-profiles';
import { checkCountConsistency } from './count-consistency';
import { getClickUpConfigOrNull } from './bento-action-guard';
import { authorizeAction, proposeActions, resumoDeAcoes, MARCADOR_ATRASO, type AgentAction } from './agent-actions';
import { executeAction } from './action-executor';
import { capturePreferences, formatPreferenceBlock, recallPreferences } from './preference-memory';
import { queryOperationTasks, getTaskComments, type OperationTask } from '@desigual-os/tool-gateway';
import { getWriteScopeListId } from '@desigual-os/tool-gateway';
import type { Logger } from '@desigual-os/logging';

interface DispatchParams {
  data: AgentJobData;
  userId: string | null;
  clientId: string | null;
  clientBrandKit: ClientBrandKit | undefined;
  clientFeedbackHistory: ClientFeedbackEntry[];
  logger: Logger;
  callAgent: (message: string) => Promise<ExecuteResponse>;
}

const PHASE_LABELS: Record<string, string> = {
  GATHERING_CONTEXT: 'Buscando contexto e memória',
  PLANNING: 'Planejando',
  ACTING: 'Executando',
  OBSERVING: 'Analisando o resultado',
  EVALUATING: 'Validando a resposta',
  REPLANNING: 'Ajustando a estratégia',
  FINALIZING: 'Finalizando',
  COMPLETED: 'Concluído',
  FAILED: 'Encerrado sem completar',
};

/** Fase de checkpoint associada a cada tipo de passo do plano. */
const PHASE_FOR_STEP: Record<string, AgentExecutionState['phase']> = {
  retrieve: 'GATHERING_CONTEXT',
  analyze: 'ACTING',
  tool: 'ACTING',
  verify: 'OBSERVING',
  evaluate: 'EVALUATING',
};

/**
 * O turno afirma fato sobre estado operacional REAL? Sinal determinístico e barato: só o
 * Bento recebe dado operacional ao vivo (campo separado), e o builder marca o bloco de
 * dado real com "DADOS AO VIVO DO CLICKUP". Um bloco de FALHA não conta — ali a resposta
 * honesta é admitir que não consultou, não uma afirmação factual — por isso não exige
 * evidência (seção 25: grounding cobra CLAIM, não penaliza honestidade sobre falha).
 */
// Os DOIS formatos de dado ao vivo que a API manda pro Bento: a lista crua
// (build-operational-context) e o briefing estruturado (briefing-engine), que
// tem precedência quando o pedido é de briefing/panorama.
//
// Só o primeiro era reconhecido. Efeito medido ao vivo no release gate
// (15/09/2026): "como está a operação hoje?" recebe o BRIEFING, então
// requiresEvidence virava false, nenhuma evidência operacional era gravada e o
// plano caía no fast path (analyze -> evaluate) — sem retrieve e sem verify.
// A resposta saía cheia de número certo e nada disso passava por grounding.
export const MARCADORES_DADO_AO_VIVO = ['DADOS AO VIVO DO CLICKUP', 'BRIEFING MONTADO COM DADO AO VIVO'] as const;

export function operationalDataRetrieved(data: AgentJobData): boolean {
  const ctx = data.operationalContext;
  return Boolean(ctx && MARCADORES_DADO_AO_VIVO.some((m) => ctx.includes(m)));
}

/** Plano curto de recuperação (estratégia reduzida): reconsulta o agente e reavalia. */
function reducedPlan(objective: string): AgentPlan {
  return {
    objective,
    steps: [
      { id: 'r1', type: 'analyze', objective: 'reconsultar o agente sem os blocos de contexto anexados', status: 'pending' },
      { id: 'r2', type: 'evaluate', objective: 'reavaliar a resposta reduzida', status: 'pending', dependsOn: ['r1'] },
    ],
    knowledgeGaps: [],
    status: 'replanning',
  };
}

/**
 * Caminho agêntico (AGENT_LOOP_V2). Agora o RUNTIME controla a progressão via
 * runStepLoop: ele escolhe o próximo passo do plano adaptativo, executa via
 * handler, coleta observação, anexa evidência, verifica grounding, avalia e só
 * conclui quando os critérios de sucesso são satisfeitos — replanejando com
 * estratégia diferente quando um passo falha e cortando em limites duros
 * (maxSteps/maxToolCalls/timeout/tool repetida). O node remoto continua sendo
 * a INTELIGÊNCIA dentro dos passos analyze/tool; o runtime manda no estado.
 * Comportamento preservado no caminho comum: uma chamada ao node + grounding +
 * avaliação, com a estratégia reduzida como replan (spec seções 8-12, 66-70).
 */
/**
 * Resumo da evidência operacional. Precisa conter os NÚMEROS, não só o
 * cabeçalho.
 *
 * Achado ao vivo (15/09/2026, release gate): esta evidência guardava apenas a
 * primeira linha do bloco — "DADOS AO VIVO DO CLICKUP (consultados agora...)"
 * — que não carrega fato nenhum. Duas consequências, as duas graves:
 *   1. a auditoria não conseguia conferir nada: a linha que deveria PROVAR a
 *      resposta não continha dado;
 *   2. groundClaims liga afirmação a evidência por token saliente (número,
 *      nome). Com resumo sem número, NENHUMA contagem podia ser ancorada —
 *      o Bento respondeu "5 tarefas vencem hoje" com 15 no bloco e o
 *      grounding não tinha como perceber.
 *
 * O preâmbulo do bloco (até a primeira linha em branco) é exatamente a parte
 * quantitativa: total, atrasadas, sem responsável e o aviso de truncamento.
 * É o que precisa viajar junto com a evidência.
 */
export function operationalEvidenceSummary(operationalContext: string): string {
  const todas = operationalContext.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (todas.length === 0) return 'dados operacionais ao vivo do ClickUp';
  // Cabeçalho + as linhas que carregam CONTAGEM. Cobre os dois formatos: o
  // preâmbulo da lista crua e a linha de VISÃO GERAL do briefing.
  // Linha quantitativa = tem número e NÃO é cabeçalho de grupo ("3Net (6):")
  // nem item de detalhe ("- nome da task | status..."). Mantém os totais dos
  // dois formatos e deixa de fora a listagem item a item.
  const quantitativas = todas
    .slice(1)
    .filter((l) => /\d/.test(l) && !l.endsWith(':') && !l.startsWith('-'))
    .slice(0, 4);
  return [todas[0], ...quantitativas].join(' ').slice(0, 600);
}

export async function dispatchWithAgentLoop(params: DispatchParams): Promise<ExecuteResponse> {
  const { data, userId, clientId, logger, callAgent } = params;
  const taskClass: TaskClass = classifyTask(data.message, data.agent);

  let lastNodeMetadata: Record<string, unknown> | undefined;

  const [agentRow] = await db
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .where(eq(schema.agents.name, data.agent))
    .catch(() => [] as { id: string }[]);
  const agentUuid = agentRow?.id ?? null;

  // ---- STATE + UNDERSTAND ----
  const state = createInitialState({
    executionId: data.executionId,
    requestId: data.executionId,
    agentId: data.agent,
    userId: userId ?? 'unknown',
    clientId,
    conversationId: data.conversationId ?? null,
    originalRequest: data.message,
  });
  state.interpretedGoal = goalFor(data.agent, data.message.split('\n\n---\n')[0] ?? data.message);
  state.successCriteria = successCriteriaFor(data.agent);
  state.requiresEvidence = operationalDataRetrieved(data);

  const persistCheckpoint = async () => {
    await publishWsEvent({
      type: 'agent.phase',
      payload: {
        execution_id: data.executionId,
        conversation_id: data.conversationId,
        agent: data.agent,
        phase: state.phase,
        label: PHASE_LABELS[state.phase] ?? null,
        attempt: state.iterations,
      },
    });
    await db
      .insert(schema.agentExecutionStates)
      .values({
        executionId: data.executionId,
        agent: data.agent,
        userId,
        clientId,
        conversationId: data.conversationId,
        phase: state.phase,
        taskClass,
        iterations: state.iterations,
        evaluatorScore: state.evaluatorScore != null ? String(state.evaluatorScore) : null,
        state: state as unknown as Record<string, unknown>,
      })
      .onConflictDoUpdate({
        target: schema.agentExecutionStates.executionId,
        set: {
          phase: state.phase,
          iterations: state.iterations,
          evaluatorScore: state.evaluatorScore != null ? String(state.evaluatorScore) : null,
          state: state as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        },
      });
  };
  const checkpoint = (terminal: boolean) => {
    const write = persistCheckpoint().catch((error: unknown) => {
      logger.warn({ error, executionId: data.executionId }, 'Falha ao persistir checkpoint do agent loop');
    });
    return terminal ? write : Promise.resolve();
  };

  // ---- GATHER CONTEXT + EVIDENCE (memória + dado operacional ao vivo) ----
  state.phase = 'GATHERING_CONTEXT';
  void checkpoint(false);
  const [episodes, preferences] = await Promise.all([
    recallMemories({ clientId, agentId: agentUuid, kinds: ['agent.episode'], limit: 3 }).catch(() => []),
    userId ? recallMemories({ userId, kinds: ['user.preference'], limit: 5 }).catch(() => []) : Promise.resolve([]),
  ]);
  // MEMÓRIA SEMÂNTICA (§19, §48): o turno pode ENSINAR uma preferência
  // durável ("para o Cliente X, prefira headlines curtas"). A captura é
  // determinística e roda antes da recuperação, pra a regra ensinada AGORA
  // já valer neste mesmo turno.
  await capturePreferences(data.message, { userId, clientId, executionId: data.executionId }, logger).catch(
    (error: unknown) => {
      logger.warn({ error }, '[memoria] falha ao capturar preferência');
      return [];
    },
  );
  const preferencias = await recallPreferences({ clientId, userId }).catch(() => []);

  const nowIso = new Date().toISOString();
  const evidence: Evidence[] = [];
  // Preferência é evidência de 1a classe: a resposta que a segue está
  // ancorada numa regra real do cliente, não em estilo do modelo.
  for (const p of preferencias) {
    evidence.push({
      type: 'memory',
      source: 'memory:preference',
      ...(p.subject ? { sourceId: p.subject } : {}),
      clientId,
      confidence: 0.95,
      retrievedAt: nowIso,
      summary: p.content.slice(0, 240),
    });
  }
  for (const m of [...episodes, ...preferences]) {
    evidence.push({
      type: 'memory',
      source: `memory:${m.kind}`,
      sourceId: m.id,
      clientId: m.clientId,
      ...(m.confidence != null ? { confidence: m.confidence } : {}),
      retrievedAt: nowIso,
      summary: m.content.slice(0, 240),
    });
  }
  if (operationalDataRetrieved(data)) {
    evidence.push({
      type: 'clickup_task',
      source: 'clickup_operational',
      confidence: 1,
      retrievedAt: nowIso,
      validAt: nowIso,
      summary: operationalEvidenceSummary(data.operationalContext ?? ''),
    });
  }
  state.evidence.push(...evidence);
  if (evidence.length > 0) {
    void db
      .insert(schema.agentEvidence)
      .values(
        evidence.map((item) => ({
          executionId: data.executionId,
          agent: data.agent,
          userId,
          clientId: item.clientId ?? clientId,
          type: item.type,
          source: item.source,
          sourceId: item.sourceId ?? null,
          confidence: item.confidence != null ? String(item.confidence) : null,
          validAt: item.validAt ? new Date(item.validAt) : null,
          summary: item.summary,
        })),
      )
      .catch((error: unknown) => {
        logger.warn({ error, executionId: data.executionId }, 'Falha ao gravar evidência do agent loop');
      });
  }

  // ---- PLAN (adaptativo) ----
  state.phase = 'PLANNING';
  const objective = state.interpretedGoal ?? data.message;
  // Sinais numa const: o modo autônomo muda a forma do plano E o handler do
  // passo `tool`, então os dois precisam enxergar a MESMA decisão.
  const sinais = inferPlanSignals(objective);
  state.structuredPlan = buildPlan({
    agent: data.agent,
    objective,
    taskClass,
    requiresEvidence: state.requiresEvidence,
    hasOperationalData: operationalDataRetrieved(data),
    creative: data.agent === 'otto',
    ...sinais,
  });
  void checkpoint(false);
  // Guarda o plano COMO FOI MONTADO: o replan troca state.structuredPlan pelo
  // plano reduzido, e sem isto a auditoria via metadata mostrava só
  // "analyze -> evaluate", escondendo o ciclo autônomo que de fato rodou.
  const planoInicial = state.structuredPlan.steps.map((x) => ({ id: x.id, type: x.type, objective: x.objective }));

  // ---- STEP LOOP: o runtime controla a execução ----
  const evaluator = evaluatorFor(data.agent);
  let nodeAnswer: string | null = null;
  let nodeCalled = false;
  let useReduced = false;

  const callNode = async (): Promise<{ ok: boolean; answer: string; error?: string; durationMs: number }> => {
    const startedAt = performance.now();
    const message = useReduced ? (data.message.split('\n\n---\n')[0] ?? data.message) : data.message;
    if (!state.strategiesTried.includes(useReduced ? 'dispatch_reduzido' : 'dispatch_completo')) {
      state.strategiesTried.push(useReduced ? 'dispatch_reduzido' : 'dispatch_completo');
    }
    state.iterations += 1;
    try {
      const blocoPreferencias = formatPreferenceBlock(preferencias);
      const response = await callAgent(
        blocoPreferencias ? `${message}\n\n---\n${blocoPreferencias}` : message,
      );
      lastNodeMetadata = response.metadata;
      const ok = response.status === 'completed' && Boolean(response.answer?.trim());
      nodeAnswer = response.answer ?? '';
      nodeCalled = true;
      return { ok, answer: nodeAnswer, durationMs: Math.round(performance.now() - startedAt), ...(response.error ? { error: response.error } : {}) };
    } catch (error) {
      nodeCalled = true;
      nodeAnswer = '';
      return { ok: false, answer: '', error: error instanceof Error ? error.message : String(error), durationMs: Math.round(performance.now() - startedAt) };
    }
  };

  // analyze/tool: a inteligência do node. Memoizado — vários passos analyze no
  // plano NÃO multiplicam a chamada (nem o custo); reusam a resposta.
  const analyzeHandler: StepHandler = async () => {
    if (!nodeCalled) {
      const r = await callNode();
      return {
        ok: r.ok,
        observation: r.answer,
        answer: r.answer,
        toolCalls: [{ tool: `agent:${data.agent}`, input_summary: objective.slice(0, 120), ok: r.ok, duration_ms: r.durationMs, ...(r.error ? { error: r.error } : {}) }],
        toolSignature: `agent:${data.agent}:${useReduced ? 'reduzido' : 'completo'}`,
        recoverable: true,
        ...(r.error ? { error: r.error } : {}),
      };
    }
    return { ok: Boolean(nodeAnswer?.trim()), observation: nodeAnswer ?? '', answer: nodeAnswer ?? '' };
  };

  const retrieveHandler: StepHandler = async () => ({
    ok: true,
    observation: `contexto e memória prontos: ${state.evidence.length} evidência(s), ${episodes.length} episódio(s)`,
  });

  // verify: grounding factual (seção 25). Duas checagens, nesta ordem:
  //   1. houve recuperação? (turno factual sem NENHUMA evidência não passa);
  //   2. a RESPOSTA se sustenta na evidência recuperada?
  //
  // A segunda não existia: groundClaims só rodava DEPOIS do loop, pro trace,
  // e nunca voltava pra avaliação. Achado ao vivo no release gate
  // (15/09/2026): perguntado "quantas tarefas vencem hoje?" com 15 no bloco
  // operacional, o Bento respondeu "5" e o turno fechou com score 1.0 — havia
  // evidência, então o critério antigo ("length > 0") estava satisfeito.
  //
  // O gatilho é DELIBERADAMENTE estreito: só reprova fato NUMÉRICO sem âncora.
  // Número é a afirmação que dá pra conferir contra a evidência e a que mais
  // machuca quando sai errada; prosa sem número continua passando, pra a régua
  // não virar replan a cada turno por heurística de texto.
  const verifyHandler: StepHandler = async () => {
    if (state.requiresEvidence && state.evidence.length === 0) {
      return { ok: false, observation: 'afirmação factual sem evidência recuperada', recoverable: true };
    }
    const texto = nodeAnswer?.trim();
    if (!state.requiresEvidence || !texto) {
      return { ok: true, observation: `grounding ok (${state.evidence.length} evidência(s))` };
    }
    // CONTAGEM primeiro: é a checagem determinística e sem ambiguidade. O
    // bloco operacional declara o total; se a resposta afirma outro (ou nega
    // que exista algo), está errada e ponto — não depende de heurística de
    // token. Foi o que pegou "5 tarefas" e "Nenhuma tarefa vence hoje" contra
    // um bloco com 15, os dois aprovados com score 1.0 antes disto.
    const contagem = checkCountConsistency(texto, data.operationalContext ?? '');
    if (contagem.ok === false) {
      return { ok: false, observation: `contagem inconsistente com o dado ao vivo: ${contagem.reason}`, recoverable: true };
    }

    const refs: EvidenceRef[] = state.evidence.map((e, i) => ({ id: e.sourceId ?? `ev${i}`, summary: e.summary }));
    const relatorio = groundClaims(texto, refs);
    const numericosSemAncora = relatorio.ungroundedFacts.filter((c) => /\d/.test(c.text));
    if (numericosSemAncora.length > 0) {
      return {
        ok: false,
        observation: `afirmação numérica sem âncora na evidência: ${numericosSemAncora.map((c) => c.text).join(' | ').slice(0, 300)}`,
        recoverable: true,
      };
    }
    return {
      ok: true,
      observation: `grounding ok (${state.evidence.length} evidência(s), ${relatorio.claims.length} afirmação(ões) ancorada(s))`,
    };
  };

  const evaluateHandler: StepHandler = async () => {
    const observation = { text: nodeAnswer ?? '', strategy: 'evaluate', attempt: state.iterations };
    const ev = evaluator({ state, observation, actOk: Boolean(nodeAnswer?.trim()) });
    state.evaluatorScore = ev.score;
    return ev.pass
      ? { ok: true, observation: `avaliação aprovada (score ${ev.score})` }
      : { ok: false, observation: `avaliação reprovou: ${ev.failures.join('; ')}`, recoverable: true };
  };

  // ---- AÇÃO AUTÔNOMA ----
  // O passo `tool` do plano autônomo. Aqui o RUNTIME manda: consulta o estado
  // real (tool 1), propõe ações a partir de fato observável, AUTORIZA por
  // código (escopo/risco/aprovação) e executa cada ação autorizada com
  // read-back (tools 2..N). O node remoto continua sendo a inteligência do
  // texto; a EXECUÇÃO é do runtime, que é o que faltava.
  const acoesDoTurno: AgentAction[] = [];
  // O ciclo de ação é um FATO da execução, não um atributo do plano atual: o
  // replan troca o plano por um reduzido (sem passo `tool`), e checar o plano
  // fazia o critério de sucesso ficar impossível depois de qualquer replan —
  // a execução terminava em replan_exhausted com resposta VAZIA mesmo tendo
  // executado e verificado ação de verdade (medido ao vivo, 15/09/2026).
  let cicloDeAcaoExecutado = false;
  const actionHandler: StepHandler = async () => {
    const config = getClickUpConfigOrNull();
    if (!config) {
      return { ok: true, observation: 'ClickUp não configurado: nenhuma ação automática possível' };
    }
    const escopo = getWriteScopeListId();
    const toolCalls: NonNullable<Awaited<ReturnType<StepHandler>>["toolCalls"]> = [];

    // TOOL 1 — estado real. Em QA a varredura é restrita à lista de teste;
    // sem cerca, usa as listas que o próprio turno já trouxe no escopo.
    let tasks: OperationTask[] = [];
    const tQuery = performance.now();
    try {
      const page = await queryOperationTasks(config, {
        ...(escopo ? { listIds: [escopo] } : {}),
        includeClosed: false,
      });
      tasks = page.tasks;
      toolCalls.push({ tool: 'clickup.query_tasks', input_summary: escopo ?? 'escopo do turno', ok: true, duration_ms: Math.round(performance.now() - tQuery) });
    } catch (error) {
      const motivo = error instanceof Error ? error.message : String(error);
      toolCalls.push({ tool: 'clickup.query_tasks', input_summary: escopo ?? '-', ok: false, error: motivo, duration_ms: Math.round(performance.now() - tQuery) });
      return { ok: false, observation: `não consegui ler o estado operacional: ${motivo}`, toolCalls, recoverable: true };
    }

    // Quais atrasos já foram comentados: evita repetir o mesmo aviso todo dia.
    const jaComentadas = new Set<string>();
    for (const t of tasks) {
      if (t.dueDate === null) continue;
      try {
        const cs = await getTaskComments(config, t.id);
        if (cs.some((c) => c.text.includes(MARCADOR_ATRASO))) jaComentadas.add(t.id);
      } catch {
        // sem comentários legíveis: trata como não comentada (o pior caso é
        // um aviso repetido, não uma escrita errada).
      }
    }

    const inicioDeHoje = new Date();
    inicioDeHoje.setHours(0, 0, 0, 0);
    const propostas = proposeActions(tasks, { startOfToday: inicioDeHoje.getTime(), jaComentadas });
    const listaPorTask = new Map(tasks.map((t) => [t.id, t.listId]));

    let executadas = 0;
    for (const acao of propostas) {
      acoesDoTurno.push(acao);
      const auth = authorizeAction(acao, { writeScopeListId: escopo, listIdPorTask: listaPorTask });
      if (!auth.authorized) {
        acao.status = acao.requiresApproval ? 'deferred' : acao.type === 'no_action' ? 'proposed' : 'blocked';
        acao.observation = auth.reason;
        continue;
      }
      acao.status = 'authorized';
      // TOOL 2..N — escrita + read-back.
      const tAcao = performance.now();
      const r = await executeAction(config, acao);
      toolCalls.push({
        tool: r.toolCall.tool,
        input_summary: `${acao.type} ${acao.taskId ?? ''}`.slice(0, 120),
        ok: r.toolCall.ok,
        duration_ms: Math.round(performance.now() - tAcao),
        ...(r.toolCall.error ? { error: r.toolCall.error } : {}),
      });
      if (r.ok) executadas += 1;
    }

    cicloDeAcaoExecutado = true;
    const resumo = resumoDeAcoes(acoesDoTurno);
    const falhou = resumo.falhas.length > 0 && executadas === 0;
    return {
      ok: !falhou,
      observation: `ações: ${propostas.length} proposta(s), ${executadas} executada(s) e verificada(s), ${resumo.humanas.length} para humano, ${resumo.bloqueadas.length} bloqueada(s), ${resumo.falhas.length} falha(s)`,
      toolCalls,
      recoverable: true,
    };
  };

  const hooks: StepLoopHooks = {
    handlers: {
      retrieve: retrieveHandler,
      analyze: analyzeHandler,
      // No plano autônomo o passo `tool` é EXECUÇÃO DE AÇÃO; nos demais
      // continua sendo a inteligência do node (comportamento preservado).
      tool: sinais.autonomous ? actionHandler : analyzeHandler,
      verify: verifyHandler,
      evaluate: evaluateHandler,
    },
    evaluate: evaluator,
    checkSuccess: (s) => {
      const hasAnswer = Boolean(nodeAnswer?.trim());
      const grounded = !s.requiresEvidence || s.evidence.length > 0;
      const missing: string[] = [];
      if (!hasAnswer) missing.push('resposta do agente');
      if (!grounded) missing.push('evidência para afirmação factual');
      // AUTÔNOMO: texto bom não é sucesso. O pedido foi RESOLVER, então o
      // turno só fecha depois de o estado operacional ter sido lido e as ações
      // terem sido decididas — executadas ou explicitamente devolvidas pra
      // pessoa. Sem isto, "organize minha operação" terminava em análise.
      if (sinais.autonomous && !cicloDeAcaoExecutado) {
        missing.push('ciclo de ação executado (decidir -> agir -> verificar)');
      }
      return { satisfied: missing.length === 0, missing };
    },
    replan: async () => {
      // Estratégia 2 (seção 11): reduz a mensagem e reconsulta. Só uma vez.
      if (useReduced) return null;
      useReduced = true;
      nodeCalled = false;
      nodeAnswer = null;
      state.phase = 'REPLANNING';
      void checkpoint(false);
      return reducedPlan(objective);
    },
    finalize: async () => {
      const base = (nodeAnswer ?? '').trim();
      if (!sinais.autonomous || acoesDoTurno.length === 0) return { answer: base };
      // Sem texto do node, o relatório de ações É a resposta: trabalho feito
      // não pode voltar como resposta vazia.
      // RELATÓRIO FINAL do modo autônomo: o texto do node é a leitura da
      // operação; estas linhas são o que o RUNTIME de fato fez e o que ficou
      // pra pessoa. Sai do estado real das ações, nunca de promessa.
      const r = resumoDeAcoes(acoesDoTurno);
      const linhas: string[] = base ? [base] : ['Passei a operação da lista e resolvi o que estava nas minhas permissões.'];
      if (r.executadas.length > 0) {
        linhas.push(
          '',
          `RESOLVIDO POR MIM (${r.executadas.length}, confirmado por leitura):`,
          ...r.executadas.map((a) => `- ${a.objective} — ${a.reason}`),
        );
      }
      if (r.humanas.length > 0) {
        linhas.push(
          '',
          `DEPENDE DE VOCÊ (${r.humanas.length}):`,
          ...r.humanas.map((a) => `- ${a.objective} — ${a.reason}`),
        );
      }
      if (r.bloqueadas.length > 0) {
        linhas.push(
          '',
          `NÃO EXECUTEI (${r.bloqueadas.length}):`,
          ...r.bloqueadas.map((a) => `- ${a.objective} — ${a.observation ?? 'bloqueada'}`),
        );
      }
      if (r.falhas.length > 0) {
        linhas.push(
          '',
          `FALHOU (${r.falhas.length}):`,
          ...r.falhas.map((a) => `- ${a.objective} — ${a.observation ?? 'falha'}`),
        );
      }
      return { answer: linhas.filter((l) => l !== undefined).join('\n') };
    },
    onStep: async (s, stepDef) => {
      s.phase = PHASE_FOR_STEP[stepDef.type] ?? s.phase;
      void checkpoint(false);
    },
  };

  const loop = await runStepLoop(hooks, state, { ...DEFAULT_STEP_LIMITS, maxRetriesPerStep: 1 });
  const completed = loop.completed && Boolean(loop.answer?.trim());
  state.phase = completed ? 'COMPLETED' : 'FAILED';
  await checkpoint(true);

  // CLAIM GROUNDING (§20-24): separa cada afirmação da resposta em
  // fato/inferência/recomendação e liga fato a evidência. Vai no trace pra o
  // grounding ser rastreável (fato não ancorado aparece explicitamente).
  const evidenceRefs: EvidenceRef[] = state.evidence.map((e, i) => ({ id: e.sourceId ?? `ev${i}`, summary: e.summary }));
  const grounding = completed && loop.answer ? groundClaims(loop.answer, evidenceRefs) : null;

  // Outcome real por execução (seções 66-68).
  void db
    .insert(schema.agentOutcomes)
    .values({
      executionId: data.executionId,
      agent: data.agent,
      userId,
      clientId,
      conversationId: data.conversationId,
      goalCompletion: Boolean(completed),
      firstAttemptSuccess: Boolean(completed) && state.iterations === 1,
      iterations: state.iterations,
      toolFailures: state.toolCalls.filter((call) => !call.ok).length,
      evaluatorScore: state.evaluatorScore != null ? String(state.evaluatorScore) : null,
      latencyMs: Math.round(new Date(state.updatedAt).getTime() - new Date(state.startedAt).getTime()),
      taskClass,
    })
    .onConflictDoNothing()
    .catch((error: unknown) => {
      logger.warn({ error, executionId: data.executionId }, 'Falha ao gravar outcome do agent loop');
    });

  // Episódio (seção 24): objetivo, estratégia vencedora, tentativas — relido no futuro.
  if (completed) {
    void rememberFact({
      kind: 'agent.episode',
      agentId: agentUuid,
      clientId,
      userId,
      content: `Objetivo: ${state.interpretedGoal ?? data.message.slice(0, 200)}. Estratégia vencedora: ${state.strategiesTried.at(-1) ?? 'desconhecida'}. Tentativas: ${state.iterations}. Score: ${state.evaluatorScore ?? 'n/a'}. Término: ${loop.terminationReason}.`,
      sourceType: 'agent',
      sourceId: data.executionId,
      confidence: 0.9,
      importance: state.iterations > 1 ? 0.7 : 0.4,
      subject: `episode:${data.agent}:${(state.interpretedGoal ?? '').slice(0, 80)}`,
    }).catch((error: unknown) => {
      logger.warn({ error, executionId: data.executionId }, 'Falha ao gravar episódio do agent loop');
    });
  }

  const response: ExecuteResponse = {
    execution_id: data.executionId,
    agent: data.agent as AgentName,
    status: completed ? 'completed' : 'failed',
    answer: completed ? loop.answer : null,
    sources: [],
    tool_calls: [],
    usage: { input_tokens: 0, output_tokens: 0 },
    ...(completed ? {} : { error: loop.evaluation?.failures.join('; ') || `o agente não completou o objetivo (${loop.terminationReason})` }),
    metadata: {
      ...(lastNodeMetadata ? { node: lastNodeMetadata } : {}),
      agentic: {
        task_class: taskClass,
        iterations: state.iterations,
        strategies_tried: state.strategiesTried,
        evaluator_score: state.evaluatorScore,
        phase: state.phase,
        termination_reason: loop.terminationReason,
        // Observabilidade (§77): plano adaptativo, lacunas, evidência e passos executados.
        plan_steps: state.structuredPlan?.steps.map((step) => ({ id: step.id, type: step.type, objective: step.objective, status: step.status })) ?? [],
        knowledge_gaps: state.structuredPlan?.knowledgeGaps ?? [],
        evidence_count: state.evidence.length,
        steps_observed: loop.observations.length,
        claims: grounding?.claims.map((c) => ({ type: c.type, confidence: c.confidence, evidence_ids: c.evidenceIds, text: c.text.slice(0, 160) })) ?? [],
        ungrounded_facts: grounding?.ungroundedFacts.length ?? 0,
        // Ações estruturadas do turno autônomo: é o que prova, na auditoria,
        // que houve DECISÃO e EXECUÇÃO, e não só texto.
        actions: acoesDoTurno.map((a) => ({
          id: a.id,
          type: a.type,
          status: a.status,
          risk: a.risk,
          requires_approval: a.requiresApproval,
          task_id: a.taskId,
          objective: a.objective,
          reason: a.reason,
          verified: a.verified ?? false,
          observation: a.observation ?? null,
        })),
        tool_calls: state.toolCalls.map((c) => ({ tool: c.tool, ok: c.ok, duration_ms: c.duration_ms })),
        // Plano original + plano final: juntos mostram replan sem perder o trace.
        plan_initial: planoInicial,
        autonomous: sinais.autonomous,
      },
    },
  };
  return response;
}

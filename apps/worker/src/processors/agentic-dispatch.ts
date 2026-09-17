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
import {
  extractEpisodeCandidates,
  formatEpisodeBlock,
  formatFactualEpisodeBlock,
  janelaDoTexto,
  recallFactualEpisodes,
  termosDeConsulta,
  publishWsEvent,
  recallEpisodes,
  recallMemories,
  recordEpisodes,
  rememberFact,
} from '@desigual-os/orchestrator';
import type { ExecuteResponse } from '@desigual-os/node-protocol';
import type { ClientBrandKit, ClientFeedbackEntry } from '@desigual-os/node-protocol';
import type { AgentName } from '@desigual-os/types';
import { classifyTask, evaluatorFor, goalFor, successCriteriaFor } from './agentic-profiles';
import { checkCountConsistency } from './count-consistency';
import { getClickUpConfigOrNull } from './bento-action-guard';
import { authorizeAction, proposeActions, resumoDeAcoes, MARCADOR_ATRASO, type AgentAction } from './agent-actions';
import { executeAction } from './action-executor';
import { capturePreferences, formatPreferenceBlock, recallPreferences } from './preference-memory';
import { captureClientFacts } from './client-fact';
import { buscarTasksDaLista, formatCampaignBlock, nomeDoCliente, resolveCampaignTurnContext } from './campaign-context';
import { formatPersonBlock, resolvePersonTurnContext } from './person-context';
import { assembleContext, type BlocoDeContexto } from './context-assembler';
import { classificarFalha, ehFalhaDeInfraestrutura, mensagemDeFalhaDeInfra } from '@desigual-os/agent-runtime';
import { anexarFontes, formatProvenanceBlock } from './provenance-block';
import { resolveCrossAgentContext } from './cross-agent-context';
import { resolveEnvironment } from './environment';
import { formatFreshnessWarning } from '../scheduler/integration-health';
import { contarClientes, formatClientBlock, resolveClientTurnContext } from './client-context';
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
  /**
   * `contextoApartado` existe por causa do Bento. O node do Otto reconhece o
   * bloco de contexto DENTRO da mensagem (CONTEXT_BLOCK_MARKER); o Bento, não:
   * ele usa a mensagem inteira como sinal de intenção E como consulta vetorial.
   * Concatenar o pack ali fazia qualquer "task"/"tarefa" do contexto disparar o
   * detector de ClickUp dele, e a listagem de tasks respondia no lugar do
   * agente — a pergunta do usuário nunca era lida.
   */
  callAgent: (message: string, contextoApartado?: string) => Promise<ExecuteResponse>;
}

/**
 * Quem entende o bloco de contexto dentro da própria mensagem. Otto entende (o
 * node dele procura o CONTEXT_BLOCK_MARKER); Bento não. Lista explícita em vez
 * de negar o Bento por nome: node novo entra sabendo que precisa declarar isso.
 */
const NODES_QUE_LEEM_CONTEXTO_NA_MENSAGEM = new Set(['otto', 'jarbas', 'suzy', 'studio']);

export function aceitaContextoNaMensagem(agente: string): boolean {
  return NODES_QUE_LEEM_CONTEXTO_NA_MENSAGEM.has(agente);
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
  // AMBIENTE DA EXECUÇÃO, resolvido antes de QUALQUER leitura ou escrita de
  // cognição. Sem isto o default 'production' vencia em silêncio e turno de
  // cliente de teste gravava episódio e memória recuperáveis na operação real:
  // 41 registros estavam assim em 16/09/2026.
  const ambiente = await resolveEnvironment(clientId).catch(() => 'production' as const);
  void checkpoint(false);
  const [episodes, preferences] = await Promise.all([
    recallMemories({ clientId, agentId: agentUuid, kinds: ['agent.episode'], limit: 3 }).catch(() => []),
    userId ? recallMemories({ userId, kinds: ['user.preference'], limit: 5 }).catch(() => []) : Promise.resolve([]),
  ]);
  // MEMÓRIA SEMÂNTICA (§19, §48): o turno pode ENSINAR uma preferência
  // durável ("para o Cliente X, prefira headlines curtas"). A captura é
  // determinística e roda antes da recuperação, pra a regra ensinada AGORA
  // já valer neste mesmo turno.
  await capturePreferences(data.message, { userId, clientId, executionId: data.executionId, environment: ambiente }, logger).catch(
    (error: unknown) => {
      logger.warn({ error }, '[memoria] falha ao capturar preferência');
      return [];
    },
  );
  const preferencias = await recallPreferences({ clientId, userId, environment: ambiente }).catch(() => []);

  // CONHECIMENTO DE CLIENTE dito AGORA ("anota que o decisor da Elite é a
  // Marina"). Roda antes de resolveClientTurnContext de propósito: o fato
  // gravado aqui entra no dossiê deste mesmo turno, então quem acabou de
  // ensinar vê o agente já usando o dado, em vez de só no turno seguinte.
  await captureClientFacts(data.message, { clientId, userId, executionId: data.executionId, environment: ambiente }, logger).catch(
    (error: unknown) => {
      logger.warn({ error }, '[memoria] falha ao capturar fato de cliente');
      return [];
    },
  );

  // MEMÓRIA EPISÓDICA (L1). O que o turno DECIDE, REPROVA ou define como regra
  // vira episódio datado. Só forma explícita entra: conversa não é verdade, e a
  // esmagadora maioria dos turnos não deixa episódio nenhum — que é o certo.
  const candidatosEpisodio = extractEpisodeCandidates(data.message);
  if (candidatosEpisodio.length > 0) {
    void recordEpisodes(candidatosEpisodio, {
      clientId,
      userId,
      agent: data.agent,
      conversationId: data.conversationId ?? null,
      executionId: data.executionId,
      sourceRefs: [`execution:${data.executionId}`],
      environment: ambiente,
    }).catch((error: unknown) => logger.warn({ error }, '[memoria] falha ao gravar episódio'));
  }

  // IDENTIDADE DO CLIENTE (bug real de 15/09/2026): sem isto o node recebia
  // só o vault de teoria de marketing e inventava quem era o cliente — chegou
  // a dizer que uma concessionária John Deere era "rede de joias".
  const clienteDoTurno = await resolveClientTurnContext({
    message: data.message,
    executionClientId: clientId,
  }).catch(() => null);
  const totalClientes = await contarClientes().catch(() => 0);
  const blocoCliente = clienteDoTurno ? formatClientBlock(clienteDoTurno, totalClientes) : "";

  // CAMPANHA DO TURNO. A ordem importa: resolver a campanha ANTES de criar é o
  // que impede o caminho que entregou legenda do cliente errado — campanha
  // citada e não resolvida agora é estado declarado, não improviso silencioso.
  const campanhaDoTurno = await resolveCampaignTurnContext({
    message: data.message,
    clientId: clienteDoTurno?.clientId ?? clientId,
    // Fonte de verdade para a autocura: se a campanha citada não estiver no
    // registro, o turno relê o ClickUp e tenta de novo antes de desistir.
    buscarTasks: buscarTasksDaLista,
  }).catch(() => null);
  // A campanha CARREGA o cliente. Quando o texto nomeia a campanha e não o
  // cliente ("campanha de aniversário do Jardim Europa 5"), é a campanha que
  // diz de quem é o trabalho — e sem isto o Otto ficaria com o contexto da
  // campanha certa e o dossiê de marca de ninguém.
  let clienteDoTurnoFinal = clienteDoTurno;
  if (campanhaDoTurno?.campanha && !clienteDoTurno?.clientId) {
    clienteDoTurnoFinal = await resolveClientTurnContext({
      message: data.message,
      executionClientId: campanhaDoTurno.campanha.clientId,
    }).catch(() => clienteDoTurno);
  }
  const blocoClienteFinal = clienteDoTurnoFinal ? formatClientBlock(clienteDoTurnoFinal, totalClientes) : blocoCliente;

  const donoDaCampanha = campanhaDoTurno?.campanha ? await nomeDoCliente(campanhaDoTurno.campanha.clientId).catch(() => null) : null;
  const donosForaDoEscopo: Record<string, string> = {};
  for (const f of campanhaDoTurno?.foraDoEscopo ?? []) {
    const n = await nomeDoCliente(f.clientId).catch(() => null);
    if (n) donosForaDoEscopo[f.clientId] = n;
  }
  const blocoCampanha = campanhaDoTurno
    ? formatCampaignBlock(campanhaDoTurno, { campanhaDe: donoDaCampanha, foraDoEscopo: donosForaDoEscopo })
    : '';

  // PESSOAS CITADAS, com tipo de relação e evidência. Sem isto, "aparece numa
  // task" virava "responde pela conta" — o bug da Esther.
  const pessoasDoTurno = await resolvePersonTurnContext(data.message).catch(() => null);
  const blocoPessoas = pessoasDoTurno ? formatPersonBlock(pessoasDoTurno) : '';

  // RECALL TEMPORAL. "o que conversamos ontem?" passa a ser respondível com o
  // que ficou REGISTRADO na janela, em vez de reler a conversa (que numa
  // conversa nova nem existe).
  // FRESCOR DA FONTE. Quando o ClickUp está atrasado, o agente diz isso em vez
  // de responder como se estivesse em dia — foi o que faltou nos cinco dias em
  // que o webhook esteve morto e ninguém percebeu.
  const blocoFrescor = await formatFreshnessWarning().catch(() => '');

  // A2A: o domínio do OUTRO agente, quando o turno precisa dele. Registrado
  // como envelope tipado e atendido pela FONTE — nunca por um modelo chamando
  // o outro, que é o caminho de loop e de verdade inventada em consenso.
  const cruzado = await resolveCrossAgentContext({
    agent: data.agent,
    message: data.message,
    executionId: data.executionId,
    clientId: clienteDoTurnoFinal?.clientId ?? clientId,
    campaignId: campanhaDoTurno?.campanha?.id ?? null,
    environment: ambiente,
    logger,
  }).catch(() => ({ bloco: '', chamadas: [] }));

  /**
   * DOIS MODOS DE RECALL, porque são duas perguntas diferentes.
   *
   * TEMPORAL responde "o que conversamos ontem": a janela é o filtro, e o
   * resultado é o que aconteceu nela.
   *
   * FACTUAL responde "quem é o decisor da Colpar?": não cita tempo nenhum, e
   * até 17/09/2026 essa pergunta não consultava episódio algum — a janela era
   * nula e o `if` abaixo simplesmente não entrava. Rastreado com prova: o
   * episódio estava gravado, a consulta o ACHAVA quando forçada, e o portão
   * temporal é que não deixava consultar. Ensinar funcionava; lembrar não.
   */
  const janela = janelaDoTexto(data.message);
  let blocoEpisodios = '';
  let episodiosDoTurno: Awaited<ReturnType<typeof recallEpisodes>> = [];
  if (janela) {
    const episodios = await recallEpisodes({
      userId,
      clientId: clienteDoTurno?.clientId ?? clientId,
      desde: janela.desde,
      ...(janela.ate ? { ate: janela.ate } : {}),
      // Recall NUNCA cruza ambiente: QA não aparece em produção e vice-versa.
      environment: ambiente,
    }).catch(() => []);
    episodiosDoTurno = episodios;
    blocoEpisodios = formatEpisodeBlock(episodios, janela.rotulo);
  }

  const termosDoTurno = termosDeConsulta(data.message);
  const episodiosFactuais = await recallFactualEpisodes({
    clientId: clienteDoTurno?.clientId ?? clientId,
    termos: termosDoTurno,
    environment: ambiente,
  }).catch(() => []);
  // Sem dobrar o que o bloco temporal já trouxe: o mesmo episódio duas vezes no
  // prompt só gasta orçamento e sugere ao modelo que houve dois registros.
  const jaNoBlocoTemporal = new Set(episodiosDoTurno.map((e) => `${e.occurredAt.toISOString()}|${e.summary}`));
  const factuaisNovos = episodiosFactuais.filter(
    (e) => !jaNoBlocoTemporal.has(`${e.occurredAt.toISOString()}|${e.summary}`),
  );
  const blocoAprendizado = formatFactualEpisodeBlock(factuaisNovos);

  // BLACKBOARD: NÃO é escrito aqui, de propósito.
  //
  // Medido em 16/09/2026: 27 blackboards gravados, ZERO com fatos e ZERO com
  // saída de agente, e `lerBlackboard` sem nenhum chamador. O motivo é
  // estrutural, não descuido: nesta arquitetura cada execução tem UM agente, e
  // o contexto do outro domínio vem do A2A source-backed, que lê a fonte
  // direto. Não há o segundo agente que entraria na mesma execução para ler o
  // que o primeiro deixou.
  //
  // Escrever mesmo assim custa uma linha por turno e, pior, faz o componente
  // parecer vivo numa auditoria futura. A tabela e as funções continuam no
  // repositório como infraestrutura para execução multiagente de verdade,
  // quando existir; o release não depende delas.

  const nowIso = new Date().toISOString();
  const evidence: Evidence[] = [];
  // Preferência é evidência de 1a classe: a resposta que a segue está
  // ancorada numa regra real do cliente, não em estilo do modelo.
  if (clienteDoTurnoFinal?.clientId && clienteDoTurnoFinal.profile) {
    evidence.push({
      type: 'document',
      source: 'client.profile',
      sourceId: clienteDoTurnoFinal.clientId,
      clientId: clienteDoTurnoFinal.clientId,
      confidence: 0.95,
      retrievedAt: nowIso,
      // Perfil INTEIRO, não os 200 primeiros caracteres. O grounding compara
      // cada afirmação contra `ev.summary` (grounding.ts): com o corte antigo a
      // evidência guardava pouco mais que o cabeçalho, e todo fato que vinha do
      // dossiê caía como NÃO ancorado — o agente era barrado justamente quando
      // acertava. Medido ao vivo: "o decisor é a Dra. Marina Salles", que estava
      // no registro, virou "não consegui montar uma resposta com fonte
      // confiável". Estes refs alimentam só o groundClaims, nunca o prompt, então
      // o texto cheio aqui não custa contexto.
      summary: `Dossiê de ${clienteDoTurnoFinal.clientName}: ${clienteDoTurnoFinal.profile}`,
    });
  }
  // Campanha e pessoas são evidência de 1a classe: sem isto o grounding trata
  // "a campanha tem 3 tarefas em aberto" como fato sem lastro e barra a resposta
  // correta (é o mesmo defeito que o dossiê teve com summary cortado).
  if (campanhaDoTurno?.campanha) {
    const c = campanhaDoTurno.campanha;
    evidence.push({
      type: 'document',
      source: 'campaign.registry',
      sourceId: c.id,
      clientId: c.clientId,
      confidence: 0.95,
      retrievedAt: nowIso,
      summary: [
        `Campanha ${c.canonicalName} (${c.status}), ${c.openTaskCount} de ${c.taskCount} tarefas em aberto`,
        c.lastSourceUpdateAt ? `atualizada em ${c.lastSourceUpdateAt.toISOString().slice(0, 10)}` : '',
        c.recentTasks.map((t) => t.name).join(' | '),
      ].filter(Boolean).join('. '),
    });
  }
  for (const pessoa of pessoasDoTurno?.encontradas ?? []) {
    evidence.push({
      type: 'document',
      source: 'people.registry',
      sourceId: pessoa.id,
      confidence: 0.95,
      retrievedAt: nowIso,
      summary: `${pessoa.canonicalName} (${pessoa.employmentType}): ${
        pessoa.relacoes.length === 0
          ? 'sem relação de cliente registrada'
          : pessoa.relacoes.map((r) => `${r.clientName} ${r.relationType} ${r.evidenceCount} evidencias ${r.temporalStatus}`).join('; ')
      }`,
    });
  }

  // TUDO que entra no prompt precisa entrar na EVIDÊNCIA. Não é simetria
  // estética: o grounding compara cada afirmação contra a evidência, então
  // bloco que chega ao modelo sem chegar aqui faz o agente ser REPROVADO por
  // usar o contexto que nós mesmos demos. Foi assim que 2 de 11 execuções
  // passaram a morrer em replan_exhausted depois que o turno ganhou memória
  // episódica e contexto cruzado.
  for (const e of episodiosDoTurno) {
    evidence.push({
      type: 'memory',
      source: 'memory:episode',
      sourceId: e.occurredAt.toISOString(),
      ...(e.clientId ? { clientId: e.clientId } : {}),
      confidence: 0.9,
      retrievedAt: nowIso,
      summary: `[${e.occurredAt.toISOString().slice(0, 10)}] ${e.eventType}: ${e.summary}`,
    });
  }
  /**
   * O que foi ENSINADO também é evidência, senão o agente recebe o fato no
   * prompt e o grounding o barra por falta de lastro — que é como uma resposta
   * certa vira "não consegui montar uma resposta com fonte confiável".
   *
   * `source` diz CONVERSA, não ClickUp: atribuir ao ClickUp algo que uma pessoa
   * falou no chat inventa uma autoridade que o fato não tem, e quem lê perde a
   * chance de checar com quem falou.
   */
  for (const e of factuaisNovos) {
    evidence.push({
      type: 'memory',
      source: 'conversation:learned',
      sourceId: e.occurredAt.toISOString(),
      ...(e.clientId ? { clientId: e.clientId } : {}),
      confidence: 0.9,
      retrievedAt: nowIso,
      summary: `Informado na conversa em ${e.occurredAt.toISOString().slice(0, 10)} (${e.eventType}): ${e.summary}`,
    });
  }
  if (cruzado.bloco.length > 0) {
    evidence.push({
      type: 'document',
      source: 'a2a:cross_agent',
      sourceId: data.executionId,
      ...(clienteDoTurnoFinal?.clientId ? { clientId: clienteDoTurnoFinal.clientId } : {}),
      confidence: 0.95,
      retrievedAt: nowIso,
      summary: cruzado.bloco,
    });
  }

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
  // O nome do cliente resolvido vira termo de marca do avaliador: copy que cita
  // a marca não é genérica por definição.
  const evaluator = evaluatorFor(data.agent, clienteDoTurnoFinal?.clientName ? [clienteDoTurnoFinal.clientName] : []);
  let nodeAnswer: string | null = null;
  let nodeCalled = false;
  // Observabilidade do pacote de contexto: sem isto não dá pra auditar quem
  // ocupou o prompt nem por que uma fonte não chegou ao modelo.
  let contextPackFontes: string[] = [];
  let contextPackChars = 0;
  let useReduced = false;

  const callNode = async (): Promise<{ ok: boolean; answer: string; error?: string; durationMs: number }> => {
    const startedAt = performance.now();
    const message = useReduced ? (data.message.split('\n\n---\n')[0] ?? data.message) : data.message;
    if (!state.strategiesTried.includes(useReduced ? 'dispatch_reduzido' : 'dispatch_completo')) {
      state.strategiesTried.push(useReduced ? 'dispatch_reduzido' : 'dispatch_completo');
    }
    state.iterations += 1;
    try {
      // CONTEXT ASSEMBLER: ordem por autoridade e orçamento com piso por bloco.
      // Concatenar tudo funcionava com dois blocos; com seis vira despejo, e o
      // modelo passa a prestar atenção no lugar errado — foi assim que um
      // aprendizado velho ancorou um pedido no cliente errado.
      const blocos: BlocoDeContexto[] = [
        { fonte: 'frescor', texto: blocoFrescor },
        { fonte: 'cliente', texto: blocoClienteFinal },
        { fonte: 'campanha', texto: blocoCampanha },
        { fonte: 'pessoas', texto: blocoPessoas },
        // O bloco do outro domínio entra junto da campanha: é fato de fonte,
        // não preferência nem histórico.
        { fonte: 'campanha', texto: cruzado.bloco },
        { fonte: 'episodios', texto: blocoEpisodios },
        { fonte: 'preferencias', texto: formatPreferenceBlock(preferencias) },
        // Por último de propósito: o que a equipe ensinou é mais novo que a
        // ficha curada e corrige o que vier antes. Ver ORDEM no assembler.
        { fonte: 'aprendizado', texto: blocoAprendizado },
      ];
      let pack = assembleContext(blocos);
      // PROVENIÊNCIA: só quando perguntam. O bloco lista as fontes que de fato
      // entraram no pacote — citar vira leitura, não memória.
      const blocoProveniencia = formatProvenanceBlock(data.message, pack.fontes);
      if (blocoProveniencia.length > 0) {
        pack = assembleContext([...blocos, { fonte: 'frescor', texto: blocoProveniencia }]);
      }
      contextPackFontes = pack.fontes;
      contextPackChars = pack.totalChars;
      // MARCADOR DO PROTOCOLO: é o que o node reconhece como contexto do
      // orquestrador (CONTEXT_BLOCK_MARKER, packages/otto/src/brain/depth.ts).
      /**
       * Medido em 16/09/2026, bateria sênior: com o pack concatenado, "Quem é a
       * Esther?" devolvia a lista de 16 tasks da D. Carvalho (status `clickup`).
       * Com a MESMA pergunta e o MESMO contexto no campo apartado, devolveu
       * `operacional` e a resposta certa: que não há Esther nos dados. O Bento
       * já tem o canal próprio pra isso, e o comentário no código dele avisa
       * exatamente contra o que estávamos fazendo.
       */
      const response =
        pack.texto.length === 0
          ? await callAgent(message)
          : aceitaContextoNaMensagem(data.agent)
            ? await callAgent(`${message}\n\n---\nContexto:\n${pack.texto}`)
            : await callAgent(message, pack.texto);
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
        // FALHA DE INFRAESTRUTURA NÃO É RECUPERÁVEL POR REPLAN. Medido em
        // 16/09/2026: GPU ocupada -> a chamada expira -> o loop replaneja ->
        // dispara OUTRA chamada -> a GPU fica mais congestionada -> expira de
        // novo -> replan_exhausted. Cada replan acrescentava carga na causa do
        // problema, e o planner não consegue "pensar melhor" para corrigir uma
        // placa saturada. Aqui o turno termina com uma mensagem honesta sobre
        // capacidade em vez de alimentar a avalanche.
        recoverable: !r.ok ? !ehFalhaDeInfraestrutura(classificarFalha(r.error)) : true,
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
  // ENTREGA COM RESSALVA (criativo): quando a porta de qualidade reprova até
  // esgotar o replan, devolver VAZIO é o pior resultado possível pra quem
  // pediu uma legenda — a pessoa fica sem nada e sem saber por quê. Copy fraca
  // ela edita; silêncio ela não. A regra que continua valendo é a original:
  // material genérico NÃO sai como aprovado. Sai rotulado.
  //
  // Só vale pro caminho criativo. Turno factual do Bento continua falhando de
  // verdade: ali um número errado é pior que resposta nenhuma.
  const criativo = data.agent === 'otto';
  const textoDisponivel = (loop.answer ?? nodeAnswer ?? "").trim();
  const entregaComRessalva =
    !loop.completed && criativo && textoDisponivel.length > 0 && loop.terminationReason === 'replan_exhausted';

  // FONTES DETERMINÍSTICAS. Quando perguntam, a seção é escrita pelo sistema a
  // partir do que entrou no pacote — não pelo modelo. Medido: o Bento recebeu
  // as fontes e mesmo assim respondeu sem citá-las.
  if (loop.answer && contextPackFontes.length >= 0) {
    loop.answer = anexarFontes(loop.answer, data.message, contextPackFontes as never);
  }

  const completed = (loop.completed && Boolean(loop.answer?.trim())) || entregaComRessalva;
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
    answer: entregaComRessalva
      ? `${textoDisponivel}\n\n---\nObs.: não aprovei isso na minha própria régua de qualidade (ficou genérico demais pra marca). Estou entregando pra você não ficar travado, mas vale pedir outro ângulo.`
      : completed
        ? loop.answer
        : null,
    sources: [],
    tool_calls: [],
    usage: { input_tokens: 0, output_tokens: 0 },
    // Quando a causa foi CAPACIDADE, o usuário precisa ouvir isso. A mensagem
    // genérica ("o agente não completou o objetivo") manda reformular uma
    // pergunta que não tinha nada de errado, e esconde que o problema era a
    // fila da GPU.
    ...(completed
      ? {}
      : {
          error: (() => {
            const ultimaFalha = state.toolCalls.filter((c) => !c.ok).at(-1)?.error;
            const tipo = classificarFalha(ultimaFalha);
            if (ehFalhaDeInfraestrutura(tipo)) return `${mensagemDeFalhaDeInfra(tipo)} [${tipo}]`;
            return loop.evaluation?.failures.join('; ') || `o agente não completou o objetivo (${loop.terminationReason})`;
          })(),
        }),
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

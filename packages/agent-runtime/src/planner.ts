import type { AgentExecutionState, TaskClass } from './state';

/**
 * planner.ts — planejador ADAPTATIVO (§10-15 da spec final). Substitui a lista
 * fixa `['entender','buscar contexto',...]` por um plano que MUDA conforme o
 * que o turno realmente exige: ler ≠ escrever ≠ organizar ≠ criar ≠ cumprimentar.
 *
 * É determinístico de propósito (§17: nada de "planner cosmético" que só chama
 * o LLM uma vez). O plano sai dos sinais já apurados por código barato
 * (classe da tarefa, precisa de evidência, tem dado operacional, é escrita, é
 * criativo), então é reproduzível, testável e explica a si mesmo. Cada passo
 * tem um TIPO real (retrieve/analyze/tool/verify/evaluate), não é enfeite.
 */

export type PlanStepType = 'retrieve' | 'analyze' | 'tool' | 'verify' | 'evaluate';
export type PlanStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface PlanStep {
  id: string;
  objective: string;
  type: PlanStepType;
  tool?: string;
  dependsOn?: string[];
  status: PlanStepStatus;
}

export type PlanStatus = 'active' | 'completed' | 'failed' | 'replanning';

export interface AgentPlan {
  objective: string;
  steps: PlanStep[];
  /** Lacunas de conhecimento detectadas ANTES de agir (§15). */
  knowledgeGaps: string[];
  status: PlanStatus;
}

export interface PlanInput {
  agent: string;
  objective: string;
  taskClass: TaskClass;
  /** O turno afirma fato sobre estado real (precisa ancorar em evidência). */
  requiresEvidence: boolean;
  /** Já chegou dado operacional AO VIVO para o turno. */
  hasOperationalData: boolean;
  /** A intenção é uma ESCRITA (criar/editar/atribuir/mudar prazo/status). */
  writeIntent: boolean;
  /** Pedido de análise/organização da operação (executive/autonomous mode). */
  operationsAnalysis: boolean;
  /** Turno criativo (Otto). */
  creative: boolean;
  /**
   * Pedido AUTÔNOMO: não é só analisar, é resolver o que der sozinho e
   * devolver só o que depende de humano. Muda a forma do plano — entram os
   * passos de decidir/executar/verificar ação, que é onde a autonomia
   * acontece de verdade.
   */
  autonomous?: boolean;
}

let counter = 0;
function step(type: PlanStepType, objective: string, extra: Partial<PlanStep> = {}): PlanStep {
  counter += 1;
  return { id: `s${counter}`, type, objective, status: 'pending', ...extra };
}

const WRITE_MARKERS = /(cri(e|a|ar)|adicione?|nova (task|tarefa)|atribu|designa|delega|muda|reagend|adia|remarc|marc(ar|a|que)|conclu|finaliz|fech|anex)/i;
// Como a operação PERGUNTA de verdade, não como o manual escreveria. "o que
// está pegando hoje?" é a pergunta executiva mais comum e caía no fast path
// (2 passos, sem retrieval e sem verify) só por não estar nesta lista.
const OPS_ANALYSIS_MARKERS = /(prioriz|como esta a operacao|como está a operação|organiz|analise a operacao|analisa a operacao|o que atacar|o que focar|panorama|resumo operacional|o que (esta|ta|está|tá) pegando|o que merece (minha )?aten|o que (eu )?(preciso|devo|deveria) (ver|olhar)|leitura executiva|como esta a opera|situacao da opera|situação da opera)/i;
// Autonomia pedida EXPLICITAMENTE. Conservador de propósito: só entra no modo
// que executa ação quando a pessoa pediu pra resolver/executar sozinho.
// "como está a operação?" continua sendo análise, não mandato de escrita.
const AUTONOMOUS_MARKERS = /(resolv[ae]|execut[ae]|cuid[ae] d|fa[çc]a o que|automaticamente|sozinh[oa]|o que depende de mim|depende de humano)/i;

/** Extrai sinais de intenção do texto do objetivo, sem LLM. */
export function inferPlanSignals(objective: string): { writeIntent: boolean; operationsAnalysis: boolean; autonomous: boolean } {
  const flat = objective.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return {
    writeIntent: WRITE_MARKERS.test(flat),
    operationsAnalysis: OPS_ANALYSIS_MARKERS.test(flat),
    autonomous: OPS_ANALYSIS_MARKERS.test(flat) && AUTONOMOUS_MARKERS.test(flat),
  };
}

/**
 * Monta o plano adaptativo. Curto e executável (§14): nunca 30 etapas. A forma
 * do plano é a evidência de que ele é adaptativo — comparar dois planos de
 * intents diferentes mostra estruturas diferentes.
 */
export function buildPlan(input: PlanInput): AgentPlan {
  counter = 0;
  const steps: PlanStep[] = [];
  const knowledgeGaps: string[] = [];

  // FAST PATH (§73): saudação/curto sem operação nem escrita não precisa de plano longo.
  if (input.taskClass === 'simple' && !input.requiresEvidence && !input.hasOperationalData && !input.writeIntent && !input.creative) {
    steps.push(step('analyze', 'responder diretamente ao pedido simples'));
    steps.push(step('evaluate', 'checar que a resposta atende o pedido'));
    return { objective: input.objective, steps, knowledgeGaps, status: 'active' };
  }

  if (input.creative) {
    // OTTO — pipeline criativo (§60): contexto -> gaps -> pesquisa (se preciso) -> conceito -> copy -> QC -> revisão.
    const ctx = step('retrieve', 'recuperar marca, oferta, público e histórico criativo do cliente');
    const gaps = step('analyze', 'detectar lacunas de conhecimento antes de criar (§54)', { dependsOn: [ctx.id] });
    const research = step('tool', 'pesquisar referências atuais quando houver lacuna que exige dado externo', { tool: 'research.search', dependsOn: [gaps.id] });
    const concept = step('analyze', 'sintetizar insight e conceito antes da copy (§61)', { dependsOn: [gaps.id] });
    const generate = step('analyze', 'gerar copy, direção visual e prompts a partir do conceito', { dependsOn: [concept.id] });
    const qc = step('evaluate', 'porta de qualidade: fit de marca, especificidade, anti-genérico (§65)', { dependsOn: [generate.id] });
    steps.push(ctx, gaps, research, concept, generate, qc);
    knowledgeGaps.push('confirmar contexto de marca/oferta/público antes de gerar');
    return { objective: input.objective, steps, knowledgeGaps, status: 'active' };
  }

  if (input.writeIntent) {
    // BENTO escrita (§18): resolver alvo -> executar -> read-back -> avaliar.
    const resolve = step('retrieve', 'resolver referente e entidade (task/pessoa) antes de escrever');
    const write = step('tool', 'executar a escrita no ClickUp via tool-gateway', { tool: 'clickup.write', dependsOn: [resolve.id] });
    const readback = step('verify', 'reler a task e conferir campos prometidos (título/responsável/prazo/status)', { dependsOn: [write.id] });
    const evalStep = step('evaluate', 'só concluir se o read-back bateu com os critérios de sucesso', { dependsOn: [readback.id] });
    steps.push(resolve, write, readback, evalStep);
    return { objective: input.objective, steps, knowledgeGaps, status: 'active' };
  }

  if (input.autonomous) {
    // BENTO AUTÔNOMO (§31-32): estado -> risco/prioridade -> DECIDIR ação ->
    // EXECUTAR -> read-back -> avaliar. A diferença pro modo analítico é que
    // aqui existem passos de AÇÃO: sem eles o pedido "resolva o que puder"
    // terminava em texto bonito e zero execução.
    const state = step('retrieve', 'recuperar estado operacional ao vivo (ClickUp) no escopo certo', { tool: 'clickup.query' });
    const analyze = step('analyze', 'classificar atrasos, bloqueios, aprovações e sem-responsável', { dependsOn: [state.id] });
    const decide = step('analyze', 'decidir quais ações são executáveis e quais dependem de humano', { dependsOn: [analyze.id] });
    const act = step('tool', 'executar as ações autorizadas via tool-gateway', { tool: 'clickup.write', dependsOn: [decide.id] });
    const readback = step('verify', 'reler o que foi escrito e confirmar (nada é "feito" sem read-back)', { dependsOn: [act.id] });
    const evalStep = step('evaluate', 'relatar o resolvido e devolver só o que depende de humano', { dependsOn: [readback.id] });
    steps.push(state, analyze, decide, act, readback, evalStep);
    if (!input.hasOperationalData) knowledgeGaps.push('estado operacional ainda não recuperado — precisa consultar ClickUp');
    return { objective: input.objective, steps, knowledgeGaps, status: 'active' };
  }

  if (input.operationsAnalysis) {
    // BENTO executive/autonomous (§31-32): estado -> riscos -> prioridade -> próxima ação -> verificar -> avaliar.
    const state = step('retrieve', 'recuperar estado operacional ao vivo (ClickUp) no escopo certo', { tool: 'clickup.query' });
    const analyze = step('analyze', 'classificar atrasos, bloqueios, aprovações e sem-responsável', { dependsOn: [state.id] });
    const rank = step('analyze', 'ranquear risco/prioridade com motivo transparente', { dependsOn: [analyze.id] });
    const nba = step('analyze', 'derivar a próxima melhor ação por risco', { dependsOn: [rank.id] });
    const verify = step('verify', 'confirmar que cada afirmação tem evidência (grounding)', { dependsOn: [state.id] });
    const evalStep = step('evaluate', 'entregar resumo executivo só com fatos ancorados', { dependsOn: [nba.id, verify.id] });
    steps.push(state, analyze, rank, nba, verify, evalStep);
    if (!input.hasOperationalData) knowledgeGaps.push('estado operacional ainda não recuperado — precisa consultar ClickUp');
    return { objective: input.objective, steps, knowledgeGaps, status: 'active' };
  }

  // BENTO factual/retrieval (§74): intent -> retrieval -> evidência -> resposta ancorada.
  const retrieve = step('retrieve', 'recuperar contexto, memória e dado operacional necessário');
  const evidence = step('analyze', 'reunir a evidência que sustenta a resposta', { dependsOn: [retrieve.id] });
  const verify = step('verify', 'checar grounding: fato factual exige evidência recuperada', { dependsOn: [evidence.id] });
  const evalStep = step('evaluate', 'entregar resposta fundamentada', { dependsOn: [verify.id] });
  steps.push(retrieve, evidence, verify, evalStep);
  if (input.requiresEvidence && !input.hasOperationalData) {
    knowledgeGaps.push('pergunta factual sem dado ao vivo recuperado — buscar antes de responder');
  }
  return { objective: input.objective, steps, knowledgeGaps, status: 'active' };
}

/** Objetivos dos passos como string[], para o campo legado `state.plan`. */
export function planStepObjectives(plan: AgentPlan): string[] {
  return plan.steps.map((s) => s.objective);
}

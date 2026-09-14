import type { AgentExecutionState, Observation } from './state';

/**
 * Evaluator determinístico default (seção 10 da spec V2). Separado da
 * geração: a ação produz, o evaluator julga. Não usa LLM de propósito -
 * é uma régua objetiva e barata que roda em toda execução. Um evaluator
 * por LLM pode ser plugado depois implementando a mesma interface.
 */
export interface Evaluation {
  /** 0..1 */
  score: number;
  pass: boolean;
  /** Lista legível do que falhou, usada pelo replan pra escolher estratégia. */
  failures: string[];
}

export interface EvaluatorInput {
  state: AgentExecutionState;
  observation: Observation;
  actOk: boolean;
}

export type Evaluator = (input: EvaluatorInput) => Evaluation;

/** Padrões que indicam vazamento de mecanismo interno na resposta final. */
const INTERNAL_LEAK_PATTERNS: RegExp[] = [
  /`[^`]*pergunta pro bento\s*:[^`]*`/i,
  /no response from openclaw/i,
  /\bexecution_id\b|\btool_call\b|\bprompt do sistema\b/i,
];

/**
 * Régua default:
 *  - ação reportou sucesso técnico: 0.30
 *  - observação não vazia e não genérica de erro: 0.25
 *  - sem vazamento interno: 0.20
 *  - critérios de sucesso cobertos pela observação: até 0.25
 */
export const deterministicEvaluator: Evaluator = ({ state, observation, actOk }) => {
  const failures: string[] = [];
  let score = 0;

  if (actOk) {
    score += 0.3;
  } else {
    failures.push('a ação reportou falha técnica');
  }

  const text = observation.text.trim();
  if (text.length > 0 && !/^(null|undefined|\{\}|\[\])$/.test(text)) {
    score += 0.25;
  } else {
    failures.push('a observação veio vazia');
  }

  const leaked = INTERNAL_LEAK_PATTERNS.some((pattern) => pattern.test(text));
  if (!leaked) {
    score += 0.2;
  } else {
    failures.push('a resposta contém vazamento de mecanismo interno');
  }

  if (state.successCriteria.length > 0) {
    const normalized = text.toLowerCase();
    const covered = state.successCriteria.filter((criterion) =>
      criterion
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word.length > 3)
        .some((word) => normalized.includes(word)),
    );
    const ratio = covered.length / state.successCriteria.length;
    score += 0.25 * ratio;
    if (ratio < 1) {
      failures.push(
        `critérios não cobertos: ${state.successCriteria.filter((c) => !covered.includes(c)).join('; ')}`,
      );
    }
  } else {
    // Sem critérios declarados não se cobra cobertura; nota máxima nesse quesito.
    score += 0.25;
  }

  return { score: Math.round(score * 1000) / 1000, pass: score >= 0.6 && failures.length === 0, failures };
};

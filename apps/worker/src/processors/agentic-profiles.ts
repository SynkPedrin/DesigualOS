import type { Evaluation, Evaluator } from '@desigual-os/agent-runtime';
import { deterministicEvaluator } from '@desigual-os/agent-runtime';
import type { TaskClass } from '@desigual-os/agent-runtime';
import type { AgentName } from '@desigual-os/types';

export type { AgentName, TaskClass };

const COMPLEX_SIGNALS = [
  'analise toda',
  'análise toda',
  'planejamento',
  'relatório completo',
  'relatorio completo',
  'organiza',
  'monte um briefing',
  'cria o briefing',
  'estratégia completa',
  'estrategia completa',
];

/**
 * Classe da tarefa por heurística determinística (barata, sempre disponível).
 * Define o teto de iterações do loop (simple=2, standard=5, complex=10).
 */
export function classifyTask(message: string, _agent: AgentName): TaskClass {
  const normalized = message.toLowerCase();
  if (normalized.length > 500 || COMPLEX_SIGNALS.some((signal) => normalized.includes(signal))) {
    return 'complex';
  }
  if (normalized.length < 80 && !normalized.includes(' e depois ')) {
    return 'simple';
  }
  return 'standard';
}

/** Objetivo interpretado por agente (seção 3-7 da spec V2): o papel dele molda o goal. */
export function goalFor(agent: AgentName, message: string): string {
  const pedido = message.slice(0, 300);
  switch (agent) {
    case 'bento':
      return `Responder com fundamento operacional verificável: ${pedido}`;
    case 'jarbas':
      return `Analisar performance com dados reais e separar fato de inferência: ${pedido}`;
    case 'otto':
      return `Entregar solução criativa executável alinhada à marca: ${pedido}`;
    case 'suzy':
      return `Avançar o relacionamento com a próxima melhor ação: ${pedido}`;
    default:
      return pedido;
  }
}

/**
 * Critérios de sucesso declarados ANTES da execução (seção 13): o evaluator
 * cobra a cobertura deles na observação final.
 */
export function successCriteriaFor(agent: AgentName): string[] {
  switch (agent) {
    case 'bento':
      return ['resposta fundamentada'];
    case 'jarbas':
      return ['dados', 'período'];
    case 'otto':
      return ['criativo'];
    case 'suzy':
      return ['resposta'];
    default:
      return [];
  }
}

/**
 * Evaluator por agente (seção 10 da spec V2). O evaluator determinístico
 * default cobra critérios por PALAVRA LITERAL, o que reprova resposta certa
 * (achado real no primeiro teste ao vivo: o Jarbas respondeu "Investimento:
 * R$ 1.234" e a régua procurava as palavras "dados"/"período" - score 0.75
 * com critério zerado, loop reprovando resposta boa). Aqui cada agente
 * ganha uma checagem semântica do que conta como sucesso PRA ELE, rodando
 * DEPOIS da régua base (que continua valendo: ação ok, não vazio, sem
 * vazamento interno).
 */
export function evaluatorFor(agent: AgentName): Evaluator {
  return (input) => {
    const base = deterministicEvaluator({
      ...input,
      state: { ...input.state, successCriteria: [] },
    });
    if (!base.pass) return base;

    const text = input.observation.text;
    const failures: string[] = [];
    switch (agent) {
      case 'jarbas':
        // Agente de performance: resposta sem nenhum número quase nunca é
        // análise de verdade (seção 5: nunca inventar métrica; se não há
        // dado, ele declara a limitação - o que também vem sem número, mas
        // aí a resposta honesta é o sucesso, ver exceção abaixo).
        if (!/\d/.test(text) && !/não (tenho|encontrei|consegui)|indisponív/i.test(text)) {
          failures.push('resposta do Jarbas sem nenhum dado numérico e sem declaração de limitação');
        }
        break;
      case 'bento':
        // Agente de operação: resposta substantiva mínima.
        if (text.trim().length < 20) failures.push('resposta do Bento curta demais pra ser fundamentada');
        break;
      case 'otto':
      case 'suzy':
      default:
        break;
    }

    if (failures.length === 0) return base;
    const score = Math.max(0, base.score - 0.35);
    return { score, pass: false, failures } satisfies Evaluation;
  };
}

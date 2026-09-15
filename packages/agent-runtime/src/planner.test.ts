import { describe, expect, it } from 'vitest';
import { buildPlan, inferPlanSignals, planStepObjectives, type PlanInput } from './planner';

const base: PlanInput = {
  agent: 'bento',
  objective: '',
  taskClass: 'standard',
  requiresEvidence: false,
  hasOperationalData: false,
  writeIntent: false,
  operationsAnalysis: false,
  creative: false,
};
const types = (p: ReturnType<typeof buildPlan>) => p.steps.map((s) => s.type);

describe('buildPlan — planejador adaptativo (§10-15)', () => {
  it('saudação simples usa fast-path curto', () => {
    const p = buildPlan({ ...base, objective: 'bom dia', taskClass: 'simple' });
    expect(types(p)).toEqual(['analyze', 'evaluate']);
  });

  it('pergunta factual planeja retrieve → verify(grounding) → evaluate', () => {
    const p = buildPlan({ ...base, objective: 'quantas tarefas vencem hoje?', requiresEvidence: true });
    expect(types(p)).toContain('retrieve');
    expect(types(p)).toContain('verify');
  });

  it('intenção de escrita inclui passo de verificação (read-back)', () => {
    const p = buildPlan({ ...base, objective: 'crie uma task pro Pedro', ...inferPlanSignals('crie uma task pro Pedro') });
    expect(p.steps.some((s) => s.type === 'verify')).toBe(true);
    expect(p.steps.some((s) => s.type === 'tool')).toBe(true);
  });

  it('análise de operação planeja estado → risco → prioridade → próxima ação → verify', () => {
    const p = buildPlan({ ...base, objective: 'organize minha operação e diga o que priorizar', ...inferPlanSignals('organize minha operação e diga o que priorizar') });
    expect(p.steps.length).toBeGreaterThanOrEqual(5);
    expect(p.steps.some((s) => s.type === 'verify')).toBe(true);
    expect(p.knowledgeGaps.length).toBeGreaterThan(0); // sem dado ainda
  });

  it('turno criativo pensa conceito ANTES de gerar copy e tem porta de qualidade', () => {
    const p = buildPlan({ ...base, agent: 'otto', objective: 'crie uma campanha', creative: true });
    const iConcept = p.steps.findIndex((s) => /sintetizar insight e conceito/.test(s.objective));
    const iGenerate = p.steps.findIndex((s) => /gerar copy/.test(s.objective));
    expect(iConcept).toBeGreaterThanOrEqual(0);
    expect(iGenerate).toBeGreaterThan(iConcept);
    expect(p.steps.some((s) => s.type === 'tool' && s.tool === 'research.search')).toBe(true);
    expect(p.steps.some((s) => s.type === 'evaluate')).toBe(true);
  });

  it('planos de intents diferentes têm estruturas diferentes (é adaptativo, não fixo)', () => {
    const read = types(buildPlan({ ...base, objective: 'quantas hoje?', requiresEvidence: true })).join(',');
    const write = types(buildPlan({ ...base, objective: 'crie task', writeIntent: true })).join(',');
    const creative = types(buildPlan({ ...base, agent: 'otto', creative: true })).join(',');
    expect(new Set([read, write, creative]).size).toBe(3);
  });

  it('planStepObjectives devolve os objetivos como string[]', () => {
    const p = buildPlan({ ...base, objective: 'x', requiresEvidence: true });
    expect(planStepObjectives(p)).toEqual(p.steps.map((s) => s.objective));
  });
});

/**
 * §29: a pergunta executiva real da operação ("o que está pegando hoje?")
 * caía no fast path — 2 passos, sem retrieval e sem verify — só porque a
 * lista de marcadores usava a linguagem do manual, não a de quem trabalha.
 */
describe('linguagem real da operação dispara análise operacional', () => {
  it.each([
    'o que está pegando hoje?',
    'o que ta pegando com esse cliente',
    'o que merece minha atenção hoje',
    'o que eu preciso ver hoje',
    'me faz uma leitura executiva da operação',
  ])('%s -> operationsAnalysis', (m) => {
    expect(inferPlanSignals(m).operationsAnalysis).toBe(true);
  });

  it('pergunta factual simples NÃO vira análise operacional', () => {
    expect(inferPlanSignals('quantas tarefas vencem hoje?').operationsAnalysis).toBe(false);
  });
});

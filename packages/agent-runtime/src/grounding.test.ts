import { describe, expect, it } from 'vitest';
import { classifyClaimType, splitClaims, groundClaims, type EvidenceRef } from './grounding';

describe('classifyClaimType (§22) — fact / inference / recommendation', () => {
  it('afirmação assertiva é fato', () => {
    expect(classifyClaimType('Pedro possui 7 tarefas críticas abertas')).toBe('fact');
  });
  it('linguagem hedge é inferência', () => {
    expect(classifyClaimType('Pedro parece sobrecarregado esta semana')).toBe('inference');
    expect(classifyClaimType('Isso indica que o cliente está insatisfeito')).toBe('inference');
  });
  it('linguagem de ação é recomendação', () => {
    expect(classifyClaimType('Redistribuir duas tarefas do Pedro')).toBe('recommendation');
    expect(classifyClaimType('Recomendo cobrar a aprovação hoje')).toBe('recommendation');
  });
});

describe('groundClaims (§20-24) — liga fato a evidência', () => {
  const evidence: EvidenceRef[] = [
    { id: 'e1', summary: 'Cliente A: 4 tarefas atrasadas na lista do ClickUp' },
    { id: 'e8', summary: 'Campanha do Cliente A bloqueada aguardando aprovação' },
  ];

  it('fato com número que casa com a evidência fica ancorado e com confiança alta', () => {
    const r = groundClaims('Cliente A tem 4 tarefas atrasadas.', evidence);
    const fact = r.claims[0]!;
    expect(fact.type).toBe('fact');
    expect(fact.evidenceIds).toContain('e1');
    expect(fact.confidence).toBeGreaterThanOrEqual(0.9);
    expect(r.ungroundedFacts).toHaveLength(0);
  });

  it('fato SEM evidência ligada é marcado como não ancorado (confiança baixa)', () => {
    const r = groundClaims('Cliente Z tem 12 pendências financeiras.', evidence);
    expect(r.ungroundedFacts).toHaveLength(1);
    expect(r.claims[0]!.confidence).toBeLessThan(0.5);
  });

  it('separa fato, inferência e recomendação numa resposta composta', () => {
    const text = 'Cliente A tem 4 tarefas atrasadas. O cliente parece em risco. Recomendo resolver a aprovação hoje.';
    const r = groundClaims(text, evidence);
    const types = r.claims.map((c) => c.type);
    expect(types).toContain('fact');
    expect(types).toContain('inference');
    expect(types).toContain('recommendation');
    // a recomendação não precisa de evidência 1:1
    const rec = r.claims.find((c) => c.type === 'recommendation')!;
    expect(rec.evidenceIds).toEqual([]);
  });

  it('splitClaims quebra por pontuação e ignora fragmentos curtos', () => {
    expect(splitClaims('Fato um aqui. Fato dois aqui. ok')).toEqual(['Fato um aqui.', 'Fato dois aqui.']);
  });
});

/**
 * Regressão do achado do release gate (15/09/2026): número casava por
 * SUBSTRING, então "5" era ancorado por "15"/"50" e nenhuma contagem errada
 * era detectável.
 */
describe('ancoragem numérica por token inteiro', () => {
  const ev = [{ id: 'op', summary: '15 tarefa(s) aberta(s) (janela: hoje) em 5 cliente(s), de 50 cliente(s) consultado(s). 1 sem responsavel definido.' }];

  it('a contagem certa ancora', () => {
    const r = groundClaims('15 tarefas vencem hoje.', ev);
    expect(r.ungroundedFacts).toHaveLength(0);
  });

  it('contagem inventada NÃO ancora, mesmo sendo dígito de um número presente', () => {
    // "7" não existe na evidência; antes casaria com qualquer coisa? não —
    // o caso perigoso é o dígito contido em outro número, coberto abaixo.
    expect(groundClaims('7 tarefas vencem hoje.', ev).ungroundedFacts).toHaveLength(1);
  });

  it('"5" não pode ancorar em "15" nem em "50"', () => {
    const so15 = [{ id: 'op', summary: '15 tarefa(s) aberta(s) em 50 cliente(s).' }];
    expect(groundClaims('5 tarefas vencem hoje.', so15).ungroundedFacts).toHaveLength(1);
  });

  it('palavra continua casando por substring (plural/flexão)', () => {
    const r = groundClaims('As entregas da Cosentino estão paradas.', [{ id: 'e', summary: 'Cosentino: 3 entregas abertas' }]);
    expect(r.claims[0]?.evidenceIds).toContain('e');
  });
});

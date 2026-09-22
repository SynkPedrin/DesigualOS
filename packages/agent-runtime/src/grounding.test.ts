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

  /**
   * P1-03 (release readiness audit, 22/09/2026): "999 diante de 3 recebe
   * confiança 0,9" — a afirmação e a evidência compartilhavam a palavra
   * "atraso", e isso sozinho lastreava o número errado. Palavra em comum
   * nunca pode confirmar um VALOR que a evidência não confirma.
   */
  it('número errado não ancora só porque a frase compartilha outra palavra com a evidência (999 vs 3)', () => {
    const ev = [{ id: 'op', summary: 'Cosentino: 3 tarefas em atraso' }];
    const r = groundClaims('A Cosentino tem 999 tarefas em atraso.', ev);
    expect(r.ungroundedFacts).toHaveLength(1);
    expect(r.claims[0]?.confidence).toBeLessThan(0.9);
  });

  it('mesmo caso, mas com o número CERTO, ancora normalmente', () => {
    const ev = [{ id: 'op', summary: 'Cosentino: 3 tarefas em atraso' }];
    const r = groundClaims('A Cosentino tem 3 tarefas em atraso.', ev);
    expect(r.ungroundedFacts).toHaveLength(0);
  });
});

/**
 * ESCOPO DO NÚMERO. O pior erro de número não é o valor errado: é o valor certo
 * pendurado em quem não é dono dele. "1106 tarefas no Cosentino" passou por
 * grounding porque 1106 estava na evidência — a evidência era da carteira toda.
 */
describe('escopo da evidência', () => {
  const global = { id: 'g1', summary: '1106 tarefa(s) aberta(s) em 40 cliente(s)', escopo: { tipo: 'global' } as const };
  const doCliente = {
    id: 'c1',
    summary: 'Cosentino: 205 tarefa(s) aberta(s)',
    escopo: { tipo: 'cliente', nome: 'Cosentino' } as const,
  };

  it('global_task_count_cannot_be_attributed_to_client', () => {
    const r = groundClaims('O Cosentino tem 1106 tarefas abertas.', [global], { clienteDoTurno: 'Cosentino' });
    expect(r.claims[0]!.evidenceIds).toEqual([]);
    expect(r.ungroundedFacts.length).toBeGreaterThan(0);
  });

  it('client_metric_requires_matching_client_id', () => {
    const r = groundClaims('O Cosentino tem 205 tarefas abertas.', [doCliente], { clienteDoTurno: 'Cosentino' });
    expect(r.claims[0]!.evidenceIds).toContain('c1');
  });

  it('global_evidence_cannot_ground_client_claim, mas ainda sustenta a afirmação GLOBAL', () => {
    const r = groundClaims('A operação tem 1106 tarefas abertas.', [global], { clienteDoTurno: 'Cosentino' });
    expect(r.claims[0]!.evidenceIds).toContain('g1');
  });

  it('same_numeric_value_different_scope_is_not_interchangeable', () => {
    const mesmoNumeroGlobal = { ...global, summary: '205 tarefa(s) aberta(s) em 40 cliente(s)' };
    const r = groundClaims('O Cosentino tem 205 tarefas abertas.', [mesmoNumeroGlobal], {
      clienteDoTurno: 'Cosentino',
    });
    expect(r.claims[0]!.evidenceIds).toEqual([]);
  });

  it('evidência de OUTRO cliente não sustenta afirmação sobre este', () => {
    const outro = { id: 'o1', summary: 'Elite: 1106 tarefas', escopo: { tipo: 'cliente', nome: 'Elite' } as const };
    const r = groundClaims('O Cosentino tem 1106 tarefas abertas.', [outro], { clienteDoTurno: 'Cosentino' });
    expect(r.claims[0]!.evidenceIds).toEqual([]);
  });

  it('sem escopo declarado, o comportamento antigo é preservado', () => {
    const r = groundClaims('O Cosentino tem 205 tarefas abertas.', [{ id: 'x', summary: 'Cosentino 205 tarefas' }], {
      clienteDoTurno: 'Cosentino',
    });
    expect(r.claims[0]!.evidenceIds).toContain('x');
  });
});

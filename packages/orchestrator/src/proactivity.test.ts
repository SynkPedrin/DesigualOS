import { describe, expect, it } from 'vitest';
import { detectTaskSignals, type TaskForRules } from './proactivity';

/** Janela real: hoje 10/09/2026, amanhã 11/09 (fuso da operação). */
const WINDOW = {
  startOfToday: new Date('2026-09-10T03:00:00.000Z').getTime(),
  startOfTomorrow: new Date('2026-09-11T03:00:00.000Z').getTime(),
  endOfTomorrow: new Date('2026-09-12T02:59:59.999Z').getTime(),
};

function task(over: Partial<TaskForRules> = {}): TaskForRules {
  return {
    id: 't1',
    name: 'Tarefa qualquer',
    status: 'aberto',
    statusType: 'open',
    priority: null,
    dueDate: WINDOW.startOfTomorrow + 3_600_000,
    assignees: ['Ana'],
    listId: 'L1',
    clientName: '3Net',
    ...over,
  };
}

describe('detectTaskSignals', () => {
  it('entrega prioritária vencendo amanhã vira sinal (o cenário §77 do dono)', () => {
    const s = detectTaskSignals(
      [task({ priority: 'urgent', status: 'briefing', assignees: [] })],
      WINDOW,
    );
    const sinal = s.find((x) => x.rule === 'task.prioritaria_vence_amanha')!;
    expect(sinal).toBeDefined();
    expect(sinal.body).toMatch(/SEM RESPONSÁVEL/);
    expect(sinal.recommendedAction).toBeTruthy();
  });

  it('3+ prioritárias amanhã elevam a severidade', () => {
    const tres = [1, 2, 3].map((n) => task({ id: `t${n}`, name: `Tarefa ${n}`, priority: 'high' }));
    const s = detectTaskSignals(tres, WINDOW);
    expect(s.find((x) => x.rule === 'task.prioritaria_vence_amanha')!.severity).toBe('high');
  });

  it('tarefa CONCLUÍDA nunca gera sinal, mesmo prioritária e vencida', () => {
    const s = detectTaskSignals(
      [
        task({ priority: 'urgent', statusType: 'done', status: 'pronto', dueDate: WINDOW.startOfToday - 86_400_000 }),
        task({ id: 'x', priority: 'urgent', statusType: 'closed', status: 'complete' }),
      ],
      WINDOW,
    );
    expect(s).toHaveLength(0);
  });

  it('prioritária ATRASADA e ainda aberta é crítica', () => {
    const s = detectTaskSignals(
      [task({ priority: 'urgent', dueDate: WINDOW.startOfToday - 86_400_000 })],
      WINDOW,
    );
    const sinal = s.find((x) => x.rule === 'task.prioritaria_atrasada')!;
    expect(sinal.severity).toBe('critical');
  });

  it('poucas tarefas sem responsável NÃO viram alerta (evita spam)', () => {
    const poucas = [1, 2, 3].map((n) => task({ id: `t${n}`, assignees: [] }));
    const s = detectTaskSignals(poucas, WINDOW);
    expect(s.find((x) => x.rule === 'task.sem_responsavel')).toBeUndefined();
  });

  it('muitas tarefas sem responsável viram alerta', () => {
    const muitas = Array.from({ length: 22 }, (_, n) => task({ id: `t${n}`, name: `T${n}`, assignees: [], priority: null }));
    const s = detectTaskSignals(muitas, WINDOW);
    const sinal = s.find((x) => x.rule === 'task.sem_responsavel')!;
    expect(sinal.severity).toBe('high');
  });

  it('operação saudável não gera sinal nenhum (proatividade não é spam)', () => {
    const s = detectTaskSignals([task({ priority: null, assignees: ['Ana'] })], WINDOW);
    expect(s).toHaveLength(0);
  });

  it('chave de dedup é por DIA: não repete hoje, mas volta amanhã se persistir', () => {
    const s = detectTaskSignals([task({ priority: 'urgent' })], WINDOW);
    const chave = s.find((x) => x.rule === 'task.prioritaria_vence_amanha')!.dedupeKey;
    expect(chave).toBe('prioritaria_amanha:2026-09-11');

    const amanha = {
      startOfToday: WINDOW.startOfTomorrow,
      startOfTomorrow: new Date('2026-09-12T03:00:00.000Z').getTime(),
      endOfTomorrow: new Date('2026-09-13T02:59:59.999Z').getTime(),
    };
    const s2 = detectTaskSignals([task({ priority: 'urgent', dueDate: amanha.startOfTomorrow + 3_600_000 })], amanha);
    expect(s2.find((x) => x.rule === 'task.prioritaria_vence_amanha')!.dedupeKey).toBe('prioritaria_amanha:2026-09-12');
  });

  it('todo sinal traz confiança alta e ação recomendada (nunca alerta vago)', () => {
    const s = detectTaskSignals(
      [task({ priority: 'urgent', dueDate: WINDOW.startOfToday - 86_400_000 }), task({ id: 'b', priority: 'high' })],
      WINDOW,
    );
    expect(s.length).toBeGreaterThan(0);
    for (const sinal of s) {
      expect(sinal.confidence).toBeGreaterThanOrEqual(0.9);
      expect(sinal.recommendedAction).toBeTruthy();
      expect(sinal.title.length).toBeGreaterThan(10);
    }
  });
});

// ---------------------------------------------------------------------------
// Bento 3.1 — risco por tarefa e chave com empresa
// ---------------------------------------------------------------------------
import { avaliarRiscosDaTarefa, chaveDoSinal, sinaisDeRiscoPorTarefa, type JanelaDeRisco } from './proactivity';

const JANELA: JanelaDeRisco = {
  ...WINDOW,
  endOfDay3: new Date('2026-09-13T02:59:59.999Z').getTime(),
};
const DIA = 86_400_000;

describe('chaveDoSinal', () => {
  it('a mesma regra no mesmo dia em duas empresas NÃO colide', () => {
    const a = chaveDoSinal('org-a', 'prioritaria_atrasada:2026-10-14');
    const b = chaveDoSinal('org-b', 'prioritaria_atrasada:2026-10-14');
    expect(a).not.toBe(b);
  });
  it('é estável: a mesma entrada dá a mesma chave (dedupe entre varreduras)', () => {
    expect(chaveDoSinal('org-a', 'x')).toBe(chaveDoSinal('org-a', 'x'));
  });
  it('sinal sem empresa fica num espaço próprio, nunca no de uma empresa', () => {
    expect(chaveDoSinal(null, 'x')).toBe('sem-empresa:x');
  });
});

describe('avaliarRiscosDaTarefa', () => {
  it('baixa prioridade atrasada 1 dia pesa MENOS que urgente vencendo amanhã (o exemplo da missão)', () => {
    const [baixaAtrasada] = avaliarRiscosDaTarefa(task({ priority: 'low', dueDate: JANELA.startOfToday - DIA / 2 }), JANELA);
    const [urgenteAmanha] = avaliarRiscosDaTarefa(task({ priority: 'urgent', dueDate: JANELA.startOfTomorrow + 3_600_000 }), JANELA);
    expect(baixaAtrasada!.evento).toBe('TASK_OVERDUE');
    expect(urgenteAmanha!.evento).toBe('TASK_DUE_SOON');
    expect(urgenteAmanha!.pontuacao).toBeGreaterThan(baixaAtrasada!.pontuacao);
  });
  it('o atraso satura: esquecida há 90 dias não passa na frente de tudo só por idade', () => {
    const [velha] = avaliarRiscosDaTarefa(task({ priority: 'normal', dueDate: JANELA.startOfToday - 90 * DIA }), JANELA);
    const [semana] = avaliarRiscosDaTarefa(task({ priority: 'normal', dueDate: JANELA.startOfToday - 7 * DIA }), JANELA);
    expect(velha!.pontuacao).toBe(semana!.pontuacao);
  });
  it('diz o porquê em texto', () => {
    const [r] = avaliarRiscosDaTarefa(task({ priority: 'high', assignees: [], dueDate: JANELA.startOfToday - 2 * DIA }), JANELA);
    expect(r!.motivos).toEqual(expect.arrayContaining(['venceu há 2 dia(s)', 'prioridade high', 'sem responsável']));
  });
  it('tarefa concluída não tem risco nenhum', () => {
    expect(avaliarRiscosDaTarefa(task({ statusType: 'closed', dueDate: JANELA.startOfToday - DIA }), JANELA)).toEqual([]);
  });
  it('sem dono e vencendo em 3 dias vira TASK_UNASSIGNED; sem dono e sem prazo não (o agregado cobre)', () => {
    const comPrazo = avaliarRiscosDaTarefa(task({ assignees: [], dueDate: JANELA.endOfDay3 - 3_600_000 }), JANELA);
    const semPrazo = avaliarRiscosDaTarefa(task({ assignees: [], dueDate: null }), JANELA);
    expect(comPrazo.map((r) => r.evento)).toContain('TASK_UNASSIGNED');
    expect(semPrazo).toEqual([]);
  });
});

describe('sinaisDeRiscoPorTarefa', () => {
  const tarefa = task({ id: 'abc', priority: 'high', dueDate: JANELA.startOfToday - DIA });
  it('a chave identifica tarefa + evento + prazo + dia, e o cooldown é de um dia', () => {
    const [s] = sinaisDeRiscoPorTarefa([tarefa], JANELA, 'org-a');
    expect(s!.dedupeKey).toBe(`task.atrasada:abc:${new Date(tarefa.dueDate!).toISOString().slice(0, 10)}:2026-09-10`);
    expect(s!.cooldownHoras).toBe(24);
    expect(s!.organizationId).toBe('org-a');
  });
  it('prazo remarcado é outro problema: outra chave', () => {
    const [antes] = sinaisDeRiscoPorTarefa([tarefa], JANELA, 'org-a');
    const [depois] = sinaisDeRiscoPorTarefa([{ ...tarefa, dueDate: tarefa.dueDate! - DIA }], JANELA, 'org-a');
    expect(antes!.dedupeKey).not.toBe(depois!.dedupeKey);
  });
  it('risco baixo não vira sinal (piso de ruído)', () => {
    const baixa = task({ priority: 'low', dueDate: JANELA.startOfTomorrow + 3_600_000 });
    expect(sinaisDeRiscoPorTarefa([baixa], JANELA, 'org-a')).toEqual([]);
  });
});

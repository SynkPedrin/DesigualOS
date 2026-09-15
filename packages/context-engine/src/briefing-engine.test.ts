import { describe, expect, it } from 'vitest';
import { buildOperationalBriefing, formatBriefingForPrompt, rankPriorities, scoreTaskPriority, computeNextBestActions } from './briefing-engine';
import type { OperationalTaskLike } from './build-operational-context';

const NOW = new Date('2026-09-10T04:30:00.000Z'); // 01:30 local, quinta

function task(over: Partial<OperationalTaskLike> = {}): OperationalTaskLike {
  return {
    id: 't1',
    name: 'Card 22/09 - Terça do casal',
    status: 'aberto',
    statusType: 'open',
    priority: null,
    dueDate: new Date('2026-09-11T14:00:00.000Z').getTime(),
    assignees: ['Ana Luiza'],
    listId: 'L-3net',
    listName: '3Net',
    url: null,
    ...over,
  };
}

describe('buildOperationalBriefing — contagens derivadas do dado real', () => {
  it('classifica estado da entrega pelos status reais da agência', () => {
    const b = buildOperationalBriefing({
      clientName: '3Net',
      now: NOW,
      tasks: [
        task({ id: 'a', status: 'em andamento' }),
        task({ id: 'b', status: 'aguardando aprovação' }),
        task({ id: 'c', status: 'bloqueado' }),
        task({ id: 'd', status: 'aberto', dueDate: new Date('2026-09-01T12:00:00Z').getTime() }),
        task({ id: 'e', status: 'aberto', assignees: [] }),
      ],
    });
    expect(b.overview.totalTasks).toBe(5);
    expect(b.overview.inProduction).toBe(1);
    expect(b.overview.awaitingApproval).toBe(1);
    expect(b.overview.blocked).toBe(1);
    expect(b.overview.overdue).toBe(1);
    expect(b.overview.unassigned).toBe(1);
  });

  it('tarefa que vence HOJE conta em dueToday e NÃO em overdue', () => {
    const b = buildOperationalBriefing({
      clientName: '3Net',
      now: NOW,
      tasks: [task({ dueDate: new Date('2026-09-10T13:00:00.000Z').getTime() })],
    });
    expect(b.overview.dueToday).toBe(1);
    expect(b.overview.overdue).toBe(0);
  });

  it('briefing global agrupa por cliente e ordena por volume', () => {
    const nomes = new Map([
      ['L-3net', '3Net'],
      ['L-dc', 'D. Carvalho'],
    ]);
    const b = buildOperationalBriefing({
      clientName: null,
      clientNameByListId: nomes,
      now: NOW,
      tasks: [
        task({ id: '1', listId: 'L-dc' }),
        task({ id: '2', listId: 'L-dc' }),
        task({ id: '3', listId: 'L-3net' }),
      ],
    });
    expect(b.overview.byClient).toEqual([
      { clientName: 'D. Carvalho', count: 2 },
      { clientName: '3Net', count: 1 },
    ]);
  });
});

describe('procedência — o briefing mostra onde ele próprio não sabe', () => {
  it('sem dossiê/tom/materiais, os campos saem MISSING e viram lacuna explícita', () => {
    const b = buildOperationalBriefing({ clientName: '3Net', now: NOW, tasks: [task()] });
    const contexto = b.sections.find((s) => s.title === 'Contexto do cliente')!;
    const faltando = contexto.fields.filter((f) => f.provenance === 'MISSING').map((f) => f.label);
    expect(faltando).toContain('Dossiê do cliente');
    expect(faltando).toContain('Tom de voz');
    expect(faltando).toContain('Público-alvo');
    expect(b.gaps.some((g) => g.includes('Público-alvo'))).toBe(true);
  });

  it('com dossiê e tom de voz reais, os campos saem KNOWN com a fonte nomeada', () => {
    const b = buildOperationalBriefing({
      clientName: '3Net',
      now: NOW,
      tasks: [task()],
      clientProfile: 'Provedor de internet regional, ticket médio R$ 99.',
      toneOfVoice: 'Direto, sem jargão técnico.',
      projectFiles: [{ filename: 'identidade.pdf', kind: 'brand' }],
    });
    const contexto = b.sections.find((s) => s.title === 'Contexto do cliente')!;
    const dossie = contexto.fields.find((f) => f.label === 'Dossiê')!;
    expect(dossie.provenance).toBe('KNOWN');
    expect(dossie.source).toMatch(/client\.profile/);
    expect(contexto.fields.find((f) => f.label === 'Tom de voz')!.provenance).toBe('KNOWN');
  });

  it('NUNCA inventa solicitante/aprovador (o ClickUp não expõe isso de forma confiável)', () => {
    const b = buildOperationalBriefing({ clientName: '3Net', now: NOW, tasks: [task()] });
    const ident = b.sections.find((s) => s.title === 'Identificação')!;
    expect(ident.fields.find((f) => f.label === 'Solicitante')!.provenance).toBe('MISSING');
    expect(ident.fields.find((f) => f.label === 'Aprovador')!.provenance).toBe('MISSING');
  });
});

describe('riscos e oportunidades — concretos, tirados do dado', () => {
  it('prioridade alta que não está em produção vira risco nomeado', () => {
    const b = buildOperationalBriefing({
      clientName: 'D. Carvalho',
      now: NOW,
      tasks: [task({ id: 'p', name: 'DC_Campanha Plantadeira', priority: 'high', status: 'aberto' })],
    });
    expect(b.risks.some((r) => /prioridade alta\/urgente ainda NÃO estão em produção/.test(r))).toBe(true);
    expect(b.risks.join(' ')).toContain('DC_Campanha Plantadeira');
  });

  it('tarefa sem responsável vira risco', () => {
    const b = buildOperationalBriefing({ clientName: '3Net', now: NOW, tasks: [task({ assignees: [] })] });
    expect(b.risks.some((r) => /sem responsável/.test(r))).toBe(true);
  });

  it('tarefa sem prazo vira oportunidade de adiantamento', () => {
    const b = buildOperationalBriefing({ clientName: '3Net', now: NOW, tasks: [task({ dueDate: null })] });
    expect(b.opportunities.some((o) => /sem prazo definido/.test(o))).toBe(true);
  });

  it('consulta truncada vira risco explícito de número não-total', () => {
    const b = buildOperationalBriefing({ clientName: '3Net', now: NOW, tasks: [task()], truncated: true });
    expect(b.risks.some((r) => /MÍNIMOS, não totais/.test(r))).toBe(true);
  });

  it('operação saudável não inventa risco', () => {
    const b = buildOperationalBriefing({
      clientName: '3Net',
      now: NOW,
      tasks: [task({ status: 'em andamento', priority: 'high' })],
    });
    expect(b.risks).toHaveLength(0);
  });
});

describe('formatBriefingForPrompt', () => {
  it('instrui explicitamente a NÃO preencher MISSING com suposição', () => {
    const b = buildOperationalBriefing({ clientName: '3Net', now: NOW, tasks: [task()] });
    const texto = formatBriefingForPrompt(b);
    // A instrução tem que proibir INVENTAR e, ao mesmo tempo, proibir RECUSAR: a primeira
    // versão só proibia inventar e o Bento passou a recusar o pedido inteiro.
    expect(texto).toMatch(/NÃO invente conteúdo/);
    expect(texto).toMatch(/NUNCA\s+recuse o pedido/);
    expect(texto).toMatch(/\[MISSING\] Público-alvo/);
    expect(texto).toMatch(/\[DERIVED\]/);
  });

  it('a visão geral mostra os STATUS REAIS do ClickUp, não categorias inventadas', () => {
    // Achado com dado de produção: o funil desta agência usa `aberto`/`pronto`/
    // `aguardando aprovação`/`pendente` e NÃO tem status de "em produção". O briefing
    // dizia "0 em produção" entre 1085 tarefas — verdadeiro e enganoso ao mesmo tempo.
    const b = buildOperationalBriefing({
      clientName: '3Net',
      now: NOW,
      tasks: [task({ id: 'a', status: 'aberto' }), task({ id: 'b', status: 'pronto' }), task({ id: 'c', status: 'aberto' })],
    });
    const texto = formatBriefingForPrompt(b);
    expect(texto).toMatch(/3 tarefa\(s\)/);
    expect(texto).toMatch(/Status reais: aberto \(2\), pronto \(1\)/);
    // não inventa bucket vazio
    expect(texto).not.toMatch(/Em produção/);
    expect(texto).not.toMatch(/Bloqueadas/);
  });

  it('categoria semântica aparece só quando de fato existe no funil', () => {
    const b = buildOperationalBriefing({
      clientName: '3Net',
      now: NOW,
      tasks: [task({ status: 'aguardando aprovação' })],
    });
    const texto = formatBriefingForPrompt(b);
    expect(texto).toMatch(/Aguardando aprovação: 1/);
    expect(texto).not.toMatch(/Bloqueadas/);
  });

  it('lacunas aparecem como pedido, não como campo preenchido', () => {
    const b = buildOperationalBriefing({ clientName: '3Net', now: NOW, tasks: [task()] });
    const texto = formatBriefingForPrompt(b);
    expect(texto).toMatch(/PENDÊNCIAS PRA COMPLETAR DEPOIS/);
    expect(texto).toMatch(/sem travar a entrega/);
  });
});

describe('atrasada = vencida E ainda aberta (achado com dado de producao)', () => {
  it('tarefa PRONTA com prazo no passado nao conta como atrasada', () => {
    const passado = new Date('2026-09-01T12:00:00Z').getTime();
    const b = buildOperationalBriefing({
      clientName: '3Net',
      now: NOW,
      tasks: [
        task({ id: 'feita', name: 'Tarefa JA CONCLUIDA', status: 'pronto', statusType: 'done', dueDate: passado }),
        task({ id: 'aberta', name: 'Tarefa AINDA ABERTA', status: 'aberto', statusType: 'open', dueDate: passado }),
      ],
    });
    // De duas com prazo vencido, so a que continua aberta e atrasada de verdade.
    expect(b.overview.overdue).toBe(1);
    expect(b.risks.join(' ')).toContain('AINDA ABERTA');
    expect(b.risks.join(' ')).not.toContain('JA CONCLUIDA');
  });

  it('tarefa concluida tambem nao entra em dueToday', () => {
    const hoje = new Date('2026-09-10T13:00:00.000Z').getTime();
    const b = buildOperationalBriefing({
      clientName: '3Net',
      now: NOW,
      tasks: [task({ status: 'pronto', statusType: 'done', dueDate: hoje })],
    });
    expect(b.overview.dueToday).toBe(0);
  });
});

describe('prioridades', () => {
  it('tarefa alta/urgente JA CONCLUIDA nao aparece como prioridade do momento', () => {
    const b = buildOperationalBriefing({
      clientName: 'Cosentino',
      now: NOW,
      tasks: [
        task({ id: 'ok', name: 'Layout ja entregue', priority: 'urgent', status: 'pronto', statusType: 'done' }),
        task({ id: 'faz', name: 'Layout a fazer', priority: 'urgent', status: 'aberto', statusType: 'open' }),
      ],
    });
    const prio = b.sections.find((s) => s.title === 'Prioridades')!;
    const texto = prio.fields.map((f) => `${f.label} ${f.value}`).join(' ');
    expect(texto).toContain('Layout a fazer');
    expect(texto).not.toContain('Layout ja entregue');
  });
});

describe('nome de tarefa com vírgula dentro', () => {
  /**
   * Defeito de leitura medido ao vivo em 10/09/2026: com os nomes reais do ClickUp numa linha
   * só separados por ";", o Bento respondeu "Dois clientes têm problemas, pois passaram da
   * data marcada" para DUAS TAREFAS do MESMO cliente. Os nomes têm vírgula dentro, e não havia
   * como distinguir a vírgula do nome da que separava itens.
   */
  const NOMES_REAIS = [
    '3Net, Criação Layout (850 Mega R$89,99), SETEMBRO',
    '3Net, Criação Layout (500 Mega R$79,99), SETEMBRO',
  ];

  it('lista uma tarefa por linha e entre aspas, sem juntar nomes na mesma linha', () => {
    const b = buildOperationalBriefing({
      clientName: '3Net',
      now: NOW,
      tasks: NOMES_REAIS.map((name, i) =>
        task({ id: `atrasada-${i}`, name, dueDate: new Date('2026-09-01T12:00:00Z').getTime() }),
      ),
    });
    const risco = b.risks.find((r) => /passaram do prazo/.test(r))!;
    expect(risco).toBeDefined();
    for (const nome of NOMES_REAIS) expect(risco).toContain(`· "${nome}"`);
    // Cada nome na SUA linha: nenhuma linha pode conter os dois.
    for (const linha of risco.split('\n')) {
      expect(NOMES_REAIS.every((n) => linha.includes(n))).toBe(false);
    }
  });

  it('o prompt final preserva a lista quebrada em linhas', () => {
    const b = buildOperationalBriefing({
      clientName: '3Net',
      now: NOW,
      tasks: NOMES_REAIS.map((name, i) =>
        task({ id: `atrasada-${i}`, name, dueDate: new Date('2026-09-01T12:00:00Z').getTime() }),
      ),
    });
    const prompt = formatBriefingForPrompt(b);
    expect(prompt).toContain(`· "${NOMES_REAIS[0]}"`);
    expect(prompt).toContain(`· "${NOMES_REAIS[1]}"`);
  });

  it('acima do teto de 3, diz quantas ficaram de fora em vez de omitir', () => {
    const b = buildOperationalBriefing({
      clientName: '3Net',
      now: NOW,
      tasks: Array.from({ length: 7 }, (_, i) =>
        task({ id: `a${i}`, name: `Atrasada ${i}`, dueDate: new Date('2026-09-01T12:00:00Z').getTime() }),
      ),
    });
    const risco = b.risks.find((r) => /passaram do prazo/.test(r))!;
    expect(risco).toContain('e mais 4 tarefa(s)');
  });
});

describe('priorityRanking (§50) — pontuação transparente com motivo', () => {
  it('vencida pontua mais que vence-hoje e concluída não prioriza', () => {
    const vencida = scoreTaskPriority(task({ dueDate: new Date('2026-09-05T12:00:00Z').getTime() }), NOW).score;
    const hoje = scoreTaskPriority(task({ dueDate: new Date('2026-09-10T12:00:00Z').getTime() }), NOW).score;
    expect(vencida).toBeGreaterThan(hoje);
    expect(scoreTaskPriority(task({ statusType: 'done', dueDate: new Date('2026-09-01T12:00:00Z').getTime() }), NOW).score).toBe(0);
  });

  it('acumula fatores e explica cada um em reasons', () => {
    const r = scoreTaskPriority(task({ priority: 'urgent', assignees: [], dueDate: new Date('2026-09-01T12:00:00Z').getTime() }), NOW);
    expect(r.score).toBeGreaterThanOrEqual(40);
    expect(r.reasons.join(' ')).toMatch(/urgente/);
    expect(r.reasons.join(' ')).toMatch(/sem responsável/);
    expect(r.reasons.join(' ')).toMatch(/vencida/);
  });

  it('rankPriorities ordena por score desc e exclui concluída', () => {
    const ranked = rankPriorities({
      now: NOW,
      tasks: [
        task({ id: 'a', statusType: 'done', dueDate: new Date('2026-09-01T12:00:00Z').getTime() }),
        task({ id: 'b', priority: 'urgent', dueDate: new Date('2026-09-01T12:00:00Z').getTime() }),
        task({ id: 'c', priority: 'normal', dueDate: null }),
      ],
    });
    expect(ranked.some((x) => x.taskId === 'a')).toBe(false);
    expect(ranked[0]?.taskId).toBe('b');
    expect(ranked[0]?.reasons.length).toBeGreaterThan(0);
  });
});

describe('nextBestActions (§52) — uma ação por risco, rastreável', () => {
  it('gera ação de vencidas nomeando a primeira e ação de sem-responsável', () => {
    const nba = computeNextBestActions({
      overdue: [task({ name: 'Vencida X' })],
      unassigned: [task({ assignees: [] })],
      blocked: [],
      awaitingApproval: [],
      prioritariasParadas: [],
    });
    expect(nba.some((a) => /Vencida X/.test(a.action))).toBe(true);
    expect(nba.some((a) => /designar/i.test(a.action))).toBe(true);
    expect(nba.every((a) => a.because.length > 0)).toBe(true);
  });
});

describe('formatBriefingForPrompt inclui priorização e próximas ações', () => {
  it('renderiza as seções novas quando há dado', () => {
    const b = buildOperationalBriefing({
      clientName: '3Net',
      now: NOW,
      tasks: [task({ id: 'b', priority: 'urgent', assignees: [], dueDate: new Date('2026-09-01T12:00:00Z').getTime() })],
    });
    const prompt = formatBriefingForPrompt(b);
    expect(prompt).toMatch(/PRIORIZAÇÃO/);
    expect(prompt).toMatch(/PRÓXIMAS AÇÕES/);
  });
});

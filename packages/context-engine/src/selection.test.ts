import { describe, expect, it } from 'vitest';
import {
  buildSelectionSnapshot,
  detectSelectionReference,
  formatSelectionBlock,
  parseSelectionSnapshot,
  resolveSelectionReference,
  type SelectionSnapshot,
  type SelectedTaskRef,
} from './selection';
import type { OperationalScope } from './resolve-scope';

const NOW = new Date('2026-09-24T15:00:00-03:00');

function task(id: string, overrides: Partial<SelectedTaskRef> = {}): SelectedTaskRef {
  return {
    id,
    title: `Task ${id}`,
    clientName: 'Cliente Teste 7',
    listId: 'list-1',
    assignees: [],
    dueDate: NOW.getTime(),
    status: 'aberto',
    priority: null,
    url: `https://app.clickup.com/t/${id}`,
    ...overrides,
  };
}

function snapshot(tasks: SelectedTaskRef[], focusTaskId: string | null = null): SelectionSnapshot {
  return {
    version: 1,
    reason: 'tasks_due_today',
    reasonLabel: 'tasks que vencem hoje, 24/09/2026',
    source: 'clickup_operational_tasks',
    capturedAt: NOW.toISOString(),
    tasks,
    focusTaskId,
  };
}

describe('detectSelectionReference', () => {
  it('reconhece referências ao conjunto inteiro', () => {
    expect(detectSelectionReference('crie um briefing detalhado de cada uma delas e lança pro pedro')).toEqual({ kind: 'all' });
    expect(detectSelectionReference('essas aí')).toEqual({ kind: 'all' });
    expect(detectSelectionReference('todas elas')).toEqual({ kind: 'all' });
    expect(detectSelectionReference('manda elas pro Pedro')).toEqual({ kind: 'all' });
    expect(detectSelectionReference('atribui essas pro Pedro')).toEqual({ kind: 'all' });
  });

  it('reconhece ordinais', () => {
    expect(detectSelectionReference('e a segunda?')).toEqual({ kind: 'ordinal', position: 1 });
    expect(detectSelectionReference('abre a primeira')).toEqual({ kind: 'ordinal', position: 0 });
    expect(detectSelectionReference('e a terceira?')).toEqual({ kind: 'ordinal', position: 2 });
    expect(detectSelectionReference('troca o responsável da última')).toEqual({ kind: 'ordinal', position: 'last' });
  });

  it('não confunde dia da semana com ordinal', () => {
    expect(detectSelectionReference('o que vence na segunda?')).toBeNull();
    // "DA segunda" é possessivo — item 2 da lista ("muda o prazo da segunda"),
    // não data. Regressão do fast gate (25/09/2026).
    expect(detectSelectionReference('muda o prazo da segunda para 28 de setembro')).toEqual({ kind: 'ordinal', position: 1 });
    expect(detectSelectionReference('e na segunda-feira?')).toBeNull();
    expect(detectSelectionReference('tasks da semana passada')).toBeNull();
    expect(detectSelectionReference('o que rolou na última semana?')).toBeNull();
  });

  it('reconhece urgência sobre o conjunto', () => {
    expect(detectSelectionReference('qual delas é mais urgente?')).toEqual({ kind: 'urgent', mode: 'top' });
    expect(detectSelectionReference('só as urgentes')).toEqual({ kind: 'urgent', mode: 'subset' });
    expect(detectSelectionReference('quais são as mais urgentes?')).toEqual({ kind: 'urgent', mode: 'subset' });
  });

  it('pronome nu "ela" é foco (regressão incidente Tammy, 25/09/2026)', () => {
    expect(detectSelectionReference('altere ela, apague todo o briefing antigo')).toEqual({ kind: 'focus' });
  });

  it('reconhece foco singular', () => {
    expect(detectSelectionReference('qual o prazo dela?')).toEqual({ kind: 'focus' });
    expect(detectSelectionReference('e o prazo?')).toEqual({ kind: 'focus' });
    expect(detectSelectionReference('quem é o responsável?')).toEqual({ kind: 'focus' });
  });

  it('não dispara em mensagem sem referência', () => {
    expect(detectSelectionReference('me liste todas as tasks q vencem hoje')).toBeNull();
    expect(detectSelectionReference('quanto gastou a 3net esse mês?')).toBeNull();
    expect(detectSelectionReference('cria uma task de onboarding pra equipe')).toBeNull();
    expect(detectSelectionReference('')).toBeNull();
  });

  it('exclusão: "todas menos a primeira", "menos a pronta"', () => {
    expect(detectSelectionReference('todas menos a primeira')).toEqual({ kind: 'exclude', position: 0 });
    expect(detectSelectionReference('menos a pronta')).toEqual({ kind: 'exclude', status: 'pronta' });
    expect(detectSelectionReference('passa todas elas, menos a última, pro Pedro')).toEqual({ kind: 'exclude', position: 'last' });
  });

  it('atributo: "a do Endrigo", "as da DCS", "aquela da Cosentino"', () => {
    expect(detectSelectionReference('a do Endrigo')).toEqual({ kind: 'attribute', term: 'Endrigo' });
    expect(detectSelectionReference('as da DCS')).toEqual({ kind: 'attribute', term: 'DCS' });
    expect(detectSelectionReference('abre aquela da Cosentino')).toEqual({ kind: 'attribute', term: 'Cosentino' });
  });

  it('repetição: "faz o mesmo nas outras", "faz igual nela"', () => {
    expect(detectSelectionReference('faz a mesma coisa nas outras')).toEqual({ kind: 'repeat', scope: 'rest' });
    expect(detectSelectionReference('beleza, faz o mesmo nas outras')).toEqual({ kind: 'repeat', scope: 'rest' });
    expect(detectSelectionReference('faz igual nas outras')).toEqual({ kind: 'repeat', scope: 'rest' });
    expect(detectSelectionReference('faz o mesmo nela')).toEqual({ kind: 'repeat', scope: 'focus' });
  });
});

describe('resolveSelectionReference', () => {
  const snap = snapshot([
    task('a', { priority: 'normal', title: 'Primeira' }),
    task('b', { priority: 'urgent', title: 'Segunda' }),
    task('c', { priority: 'high', title: 'Terceira', dueDate: NOW.getTime() - 86_400_000 }),
  ]);

  it('all devolve o conjunto inteiro sem mexer no foco', () => {
    const r = resolveSelectionReference(snap, { kind: 'all' });
    expect(r?.tasks.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(r?.newFocusTaskId).toBeNull();
  });

  it('ordinal resolve posição e seta foco', () => {
    expect(resolveSelectionReference(snap, { kind: 'ordinal', position: 1 })).toEqual({
      tasks: [snap.tasks[1]],
      newFocusTaskId: 'b',
    });
    expect(resolveSelectionReference(snap, { kind: 'ordinal', position: 'last' })?.newFocusTaskId).toBe('c');
    expect(resolveSelectionReference(snap, { kind: 'ordinal', position: 'penultimate' })?.newFocusTaskId).toBe('b');
  });

  it('ordinal fora do range devolve null (resposta honesta, nunca task errada)', () => {
    expect(resolveSelectionReference(snap, { kind: 'ordinal', position: 9 })).toBeNull();
  });

  it('urgent top pega prioridade primeiro, prazo depois', () => {
    const r = resolveSelectionReference(snap, { kind: 'urgent', mode: 'top' });
    expect(r?.tasks[0]?.id).toBe('b');
    expect(r?.newFocusTaskId).toBe('b');
  });

  it('urgent subset filtra as marcadas urgent', () => {
    const r = resolveSelectionReference(snap, { kind: 'urgent', mode: 'subset' });
    expect(r?.tasks.map((t) => t.id)).toEqual(['b']);
  });

  it('focus usa o foco gravado; sem foco, null', () => {
    expect(resolveSelectionReference(snap, { kind: 'focus' })).toBeNull();
    const comFoco = { ...snap, focusTaskId: 'c' };
    expect(resolveSelectionReference(comFoco, { kind: 'focus' })?.tasks[0]?.id).toBe('c');
  });

  it('exclude por ordinal: todas menos a primeira = T2..Tn', () => {
    const r = resolveSelectionReference(snap, { kind: 'exclude', position: 0 });
    expect(r?.tasks.map((t) => t.id)).toEqual(['b', 'c']);
  });

  it('exclude por status: "menos a pronta" tira as prontas', () => {
    const comPronta = snapshot([task('a'), task('b', { status: 'pronto' }), task('c')]);
    const r = resolveSelectionReference(comPronta, { kind: 'exclude', status: 'pronta' });
    expect(r?.tasks.map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('attribute casa por responsável OU cliente; sem casa, null', () => {
    const comNomes = snapshot([
      task('a', { assignees: ['Endrigo Almada'], clientName: 'Agência Desigual' }),
      task('b', { assignees: ['Stephany Bergamasco'], clientName: 'DCS Diagnostico' }),
      task('c', { assignees: ['Stephany Bergamasco'], clientName: 'DCS Diagnostico' }),
    ]);
    expect(resolveSelectionReference(comNomes, { kind: 'attribute', term: 'Endrigo' })?.tasks.map((t) => t.id)).toEqual(['a']);
    expect(resolveSelectionReference(comNomes, { kind: 'attribute', term: 'dcs' })?.tasks.map((t) => t.id)).toEqual(['b', 'c']);
    expect(resolveSelectionReference(comNomes, { kind: 'attribute', term: 'Zzz' })).toBeNull();
    // atributo único vira foco ("aquela da DCS" com uma só)
    expect(resolveSelectionReference(comNomes, { kind: 'attribute', term: 'Endrigo' })?.newFocusTaskId).toBe('a');
  });
});

describe('buildSelectionSnapshot / parseSelectionSnapshot', () => {
  const scope: OperationalScope = {
    kind: 'GLOBAL',
    clients: [],
    ambiguous: [],
    temporal: { from: 0, to: 1, label: 'hoje' },
    operational: true,
    comparative: false,
    briefing: false,
    confidence: 0.7,
    signals: [],
  };

  it('monta snapshot com motivo datado real', () => {
    const s = buildSelectionSnapshot({ tasks: [task('x')], scope, now: NOW });
    expect(s?.reason).toBe('tasks_due_today');
    expect(s?.reasonLabel).toContain('24/09/2026');
    expect(s?.tasks).toHaveLength(1);
    expect(s?.focusTaskId).toBeNull();
  });

  it('sem tasks não há snapshot', () => {
    expect(buildSelectionSnapshot({ tasks: [], scope, now: NOW })).toBeNull();
  });

  it('roundtrip pelo parse da metadata', () => {
    const s = buildSelectionSnapshot({ tasks: [task('x'), task('y', { assignees: ['Pedro'] })], scope, now: NOW })!;
    const parsed = parseSelectionSnapshot(JSON.parse(JSON.stringify(s)));
    expect(parsed).toEqual(s);
  });

  it('parse rejeita lixo sem explodir', () => {
    expect(parseSelectionSnapshot(null)).toBeNull();
    expect(parseSelectionSnapshot({ version: 2 })).toBeNull();
    expect(parseSelectionSnapshot({ version: 1, source: 'clickup_operational_tasks', reason: 'x', reasonLabel: 'y', tasks: [{ id: 1 }] })).toBeNull();
    expect(parseSelectionSnapshot('tasks_due_today')).toBeNull();
  });
});

describe('formatSelectionBlock', () => {
  it('numera as tasks, data de hoje real e declara o referente atual', () => {
    const snap = snapshot([task('a', { title: 'Post aniversário' }), task('b', { title: 'Landing page' })], 'b');
    const block = formatSelectionBlock({ snapshot: snap, focusTaskId: 'b', now: NOW });
    expect(block).toContain('Hoje é 24/09/2026');
    expect(block).toContain('1. Post aniversário');
    expect(block).toContain('2. Landing page');
    expect(block).toContain('"a segunda" = item 2');
    expect(block).toContain('REFERENTE ATUAL: item 2 — "Landing page"');
    expect(block).toContain('tasks que vencem hoje, 24/09/2026');
  });
});

/**
 * 28/09/2026 — a guarda de "dia da semana × ordinal" existia só pra SEGUNDA,
 * com o comentário afirmando que ela era a única ambígua. Não é: quarta,
 * quinta e sexta também são dia da semana, e são exatamente como uma agência
 * marca prazo. Medido: "muda o prazo da DC_Caderno 2027_Layout pra sexta"
 * resolvia a SEXTA task da lista e ignorava o nome escrito na frase — pedido
 * de prazo virando escrita na task errada.
 */
describe('dia da semana não é ordinal', () => {
  it.each([
    'joga o prazo pra sexta',
    'muda pra quarta',
    'deixa pra quinta',
    'passa pra segunda',
    'até sexta',
    'na quarta',
    'entrega até quinta',
  ])('%s -> não é referência ordinal', (m) => {
    const ref = detectSelectionReference(m);
    expect(ref?.kind === 'ordinal' ? `ordinal:${(ref as { position: number }).position}` : (ref?.kind ?? 'nenhuma')).not.toMatch(/^ordinal/);
  });

  it.each([
    ['muda o prazo da segunda', 1],
    ['muda o prazo da sexta', 5],
    ['abre a quarta', 3],
    ['a quinta task', 4],
  ])('%s continua sendo posição — possessivo e artigo não são data', (m, pos) => {
    const ref = detectSelectionReference(m as string);
    expect(ref).toMatchObject({ kind: 'ordinal', position: pos });
  });

  it('a frase com as DUAS coisas lê cada uma no seu lugar', () => {
    // "a segunda" é o item; "pra sexta" é o prazo.
    expect(detectSelectionReference('muda a segunda pra sexta')).toMatchObject({ kind: 'ordinal', position: 1 });
  });
});

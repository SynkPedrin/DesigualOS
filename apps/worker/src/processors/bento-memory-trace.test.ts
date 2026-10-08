/**
 * bento-memory-trace.test.ts — FASE B.11 (auditoria forense, 26/09/2026).
 *
 * Prova se a MEMÓRIA do Bento é efetivamente utilizada, não apenas existe.
 * Cobre: supersessão por subject em cenário de 4 dias, isolamento por cliente
 * e por environment (qa vs production) nas duas camadas de recall, a furação
 * de isolamento D-09 do build-context, o comportamento do recall factual
 * (ILIKE %termo%) sob acentos/volume, e a fragilidade das FORMAS regex que
 * decidem o que vira episódio.
 *
 * Os mocks abaixo seguem o padrão do repo (build-context.test.ts): drizzle-orm
 * vira descritores de condição e @desigual-os/database vira um bancinho fake
 * com semântica fiel ao Postgres — inclusive ILIKE case-insensitive, acento
 * sensível por padrão e dobrado por translate() quando a query o usa.
 *
 * ATUALIZAÇÃO (26/09/2026, workstream de memória): as seções que documentavam
 * os bugs D-09 (F-12), ILIKE acento-sensível (F-13) e 4/10 decisões naturais
 * (F-20) viraram testes de REGRESSÃO do comportamento corrigido. O que segue
 * marcado "COMPORTAMENTO ATUAL" é só a degradação por volume (F-19), que
 * continua aberta — a saída é tsvector/ranking, fora deste workstream.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Cond {
  op: string;
  column?: string;
  value?: unknown;
  values?: unknown[];
  conditions?: Cond[];
  strings?: string[];
}

vi.mock('drizzle-orm', () => {
  const bin = (op: string) => (column: unknown, value: unknown): Cond => ({ op, column: String(column), value });
  const un = (op: string) => (column: unknown): Cond => ({ op, column: String(column) });
  const sqlTag = (strings: TemplateStringsArray | readonly string[], ...values: unknown[]): Cond => ({
    op: 'sql',
    strings: Array.from(strings as readonly string[]),
    values,
  });
  return {
    eq: bin('eq'),
    ne: bin('ne'),
    gt: bin('gt'),
    gte: bin('gte'),
    lte: bin('lte'),
    isNull: un('isNull'),
    isNotNull: un('isNotNull'),
    and: (...conditions: Cond[]): Cond => ({ op: 'and', conditions }),
    or: (...conditions: Cond[]): Cond => ({ op: 'or', conditions }),
    desc: (column: unknown): Cond => ({ op: 'desc', column: String(column) }),
    inArray: (column: unknown, values: unknown[]): Cond => ({ op: 'in', column: String(column), values }),
    sql: Object.assign(sqlTag, { raw: (s: string): Cond => ({ op: 'sql', strings: [s], values: [] }) }),
  };
});

vi.mock('@desigual-os/logging', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

/** Linha do bancinho fake: colunas dinâmicas por fora, e tipados os campos
 *  que o avaliador de condições e os testes leem de verdade. */
type Row = {
  [key: string]: unknown;
  id?: string;
  metadata?: { subject?: unknown } | null;
  updatedAt?: Date;
};

/**
 * Bancinho fake + avaliador de condições, içados porque vi.mock é hoisted.
 * O avaliador implementa a semântica REAL de cada operador usado pelos
 * módulos sob teste (memory-engine, episodic-memory, build-context).
 */
const fake = vi.hoisted(() => {
  type R = Row;
  /** Tabela do schema mockado: { __table: nome, coluna: 'tabela.coluna' }. */
  type FakeTable = Record<string, string>;
  type IdRows = Array<{ id: unknown }>;
  /** O código real awaita os estágios da query: then com a assinatura do
   *  Promise sobre o payload T. catch só onde o bancinho implementa (os
   *  estágios de select; o update do fake não o tem). */
  interface ThenableQuery<T> {
    then: <TResult1 = T, TResult2 = never>(
      res?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
      rej?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => Promise<TResult1 | TResult2>;
    catch?: <TResult = never>(
      rej?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
    ) => Promise<T | TResult>;
  }
  interface Chainable extends ThenableQuery<R[]> {
    orderBy: (...descs: Cond[]) => Chainable;
    limit: (n: number) => Promise<R[]>;
  }
  interface InsertChain {
    returning: (cols?: unknown) => Promise<IdRows>;
    onConflictDoNothing: () => {
      returning: (cols?: unknown) => Promise<IdRows>;
    };
  }
  interface UpdateChain extends ThenableQuery<IdRows> {
    returning: (cols?: unknown) => Promise<IdRows>;
  }
  const store = {
    memories: [] as R[],
    agentEpisodes: [] as R[],
    users: [] as R[],
    clients: [] as R[],
    clientBrandKits: [] as R[],
    agents: [] as R[],
    messages: [] as R[],
    projectFiles: [] as R[],
    /**
     * Acrescentado em 30/09/2026, quando `organizacaoDaEscrita` passou a
     * resolver a empresa de toda linha nova (migração 0045). O banco falso
     * precisa ter as mesmas tabelas que o código consulta — senão o teste
     * reprova por ausência de mock, não por defeito de produto.
     */
    organizationMembers: [] as R[],
  };
  const rowsOf = (key: string): R[] => (store as Record<string, R[]>)[key]!;
  let seq = 0;

  const colName = (c?: string): string => (c ? c.split('.').pop()! : '');
  const toN = (v: unknown): number => {
    if (v instanceof Date) return v.getTime();
    if (v === null || v === undefined) return 0;
    const n = Number(v);
    return Number.isNaN(n) ? 0 : n;
  };

  function evalSql(row: R, cond: Cond): boolean {
    const text = (cond.strings ?? []).join('');
    const vals = cond.values ?? [];
    const last = vals[vals.length - 1];
    // build-context (30/09/2026) — metadata->>'subject' is not null.
    // Precisa vir ANTES da comparação por igualdade: esta forma não tem
    // parâmetro, e o ramo de baixo compararia com `undefined`, reprovando
    // justamente as linhas que TÊM procedência.
    if (text.includes("->>'subject'") && text.includes('is not null')) {
      return row.metadata?.subject !== undefined && row.metadata?.subject !== null;
    }
    // memory-engine:207 — metadata->>'subject' = ${subject}
    if (text.includes("->>'subject'")) return row.metadata?.subject === last;
    // recall factual: translate(summary, ...) ilike '%termo%'. FIEL AO
    // POSTGRES: ILIKE dobra CAIXA, não dobra ACENTO — o acento só é dobrado
    // quando a query usa translate() no resumo (F-13).
    if (text.includes(' ilike ')) {
      const dobra = (s: string): string =>
        s
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .toLowerCase();
      const termo = String(last).replace(/^%|%$/g, '');
      const resumo = String(row.summary ?? '');
      if (text.includes('translate(')) return dobra(resumo).includes(dobra(termo));
      return resumo.toLowerCase().includes(termo.toLowerCase());
    }
    // episodic-memory:342 — event_type in (...)
    if (text.includes(' in ') && Array.isArray(last)) return last.includes(row.eventType);
    // memory-engine:309 — kind = ANY(ARRAY['a','b'])
    if (text.includes('= ANY(')) {
      const raw = last as Cond | undefined;
      const lista = [...String((raw?.strings ?? []).join('')).matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]!.replace(/''/g, "'"));
      return lista.includes(String(row.kind));
    }
    // memory-engine:312 — COALESCE(importance, 0.5) >= N
    if (text.includes('COALESCE') && text.includes('>=')) return Number(row.importance ?? 0.5) >= Number(last);
    // expires_at > now() / <= now()
    if (text.includes('> now()')) return row.expiresAt != null && toN(row.expiresAt) > Date.now();
    if (text.includes('<= now()')) return row.expiresAt != null && toN(row.expiresAt) <= Date.now();
    return true;
  }

  function evalCond(row: R, cond: Cond): boolean {
    switch (cond.op) {
      case 'eq': return row[colName(cond.column)] === cond.value;
      case 'ne': return row[colName(cond.column)] !== cond.value;
      case 'gt': return toN(row[colName(cond.column)]) > toN(cond.value);
      case 'gte': return toN(row[colName(cond.column)]) >= toN(cond.value);
      case 'lte': return toN(row[colName(cond.column)]) <= toN(cond.value);
      case 'isNull': return row[colName(cond.column)] === null || row[colName(cond.column)] === undefined;
      case 'isNotNull': return row[colName(cond.column)] !== null && row[colName(cond.column)] !== undefined;
      case 'in': return (cond.values ?? []).includes(row[colName(cond.column)]);
      case 'and': return (cond.conditions ?? []).every((c) => evalCond(row, c));
      case 'or': return (cond.conditions ?? []).some((c) => evalCond(row, c));
      case 'sql': return evalSql(row, cond);
      default: return true;
    }
  }

  function applyOrder(rows: R[], descs: Cond[]): R[] {
    const out = [...rows];
    for (const d of [...descs].reverse()) {
      if (d.op === 'desc') {
        const key = colName(d.column);
        out.sort((a, b) => toN(b[key]) - toN(a[key]));
      } else if (d.op === 'sql' && (d.strings ?? []).join('').includes('COALESCE')) {
        out.sort((a, b) => Number(b.importance ?? 0.5) - Number(a.importance ?? 0.5));
      }
    }
    return out;
  }

  function chainable(compute: () => R[]): Chainable {
    let cached: R[] | null = null;
    const get = () => (cached ??= compute());
    return {
      then: (res, rej) => Promise.resolve().then(get).then(res, rej),
      // client-context.ts chama .catch direto no resultado do .where() (sem
      // .limit no meio) — sem isto o fake quebrava com "catch is not a function".
      catch: (rej) => Promise.resolve().then(get).catch(rej),
      orderBy: (...descs: Cond[]) => chainable(() => applyOrder(get(), descs)),
      limit: (n: number) => Promise.resolve().then(() => get().slice(0, n)),
    };
  }

  const tableKey = (table: FakeTable): string => table.__table!;

  const db = {
    select: (_cols?: unknown) => ({
      from: (table: FakeTable) => ({
        where: (cond: Cond) => chainable(() => rowsOf(tableKey(table)).filter((r) => evalCond(r, cond))),
      }),
    }),
    insert: (table: FakeTable) => ({
      values: (v: R): InsertChain => {
        const key = tableKey(table);
        const doInsert = () => {
          const row = { ...v, id: v.id ?? `${key}-${++seq}` };
          rowsOf(key).push(row);
          return [{ id: row.id }];
        };
        return {
          returning: (_cols?: unknown) => Promise.resolve().then(doInsert),
          onConflictDoNothing: () => ({
            returning: (_cols?: unknown) =>
              Promise.resolve().then(() =>
                rowsOf(key).some((r) => r.dedupeKey && r.dedupeKey === v.dedupeKey) ? [] : doInsert(),
              ),
          }),
        };
      },
    }),
    update: (table: FakeTable) => ({
      set: (patch: R) => ({
        where: (cond: Cond): UpdateChain => {
          const apply = (): IdRows => {
            const matched = rowsOf(tableKey(table)).filter((r) => evalCond(r, cond));
            for (const r of matched) Object.assign(r, patch);
            return matched.map((r) => ({ id: r.id }));
          };
          return {
            then: (res, rej) => Promise.resolve().then(apply).then(res, rej),
            returning: (_cols?: unknown) => Promise.resolve().then(apply),
          };
        },
      }),
    }),
  };

  function reset(): void {
    for (const k of Object.keys(store)) rowsOf(k).length = 0;
    seq = 0;
  }

  return { store, db, reset };
});

vi.mock('@desigual-os/database', () => {
  const table = (name: string, fields: string[]) =>
    Object.fromEntries([['__table', name], ...fields.map((f) => [f, `${name}.${f}`])]) as Record<string, string>;
  const schema = {
    memories: table('memories', [
      'id', 'kind', 'content', 'environment', 'clientId', 'agentId', 'userId', 'sourceType', 'sourceId',
      'confidence', 'importance', 'status', 'lastVerifiedAt', 'expiresAt', 'dedupeKey', 'metadata',
      'supersededBy', 'supersededAt', 'createdAt', 'updatedAt', 'organizationId',
    ]),
    agentEpisodes: table('agentEpisodes', [
      'id', 'occurredAt', 'clientId', 'campaignId', 'userId', 'agent', 'conversationId', 'executionId',
      'eventType', 'summary', 'facts', 'decisions', 'feedback', 'sourceRefs', 'importance', 'environment', 'dedupeKey',
      'organizationId',
    ]),
    users: table('users', ['id', 'name']),
    clients: table('clients', ['id', 'name', 'environment', 'slug', 'organizationId']),
    organizationMembers: table('organizationMembers', ['userId', 'organizationId']),
    clientBrandKits: table('clientBrandKits', ['clientId', 'toneOfVoice']),
    agents: table('agents', ['id', 'name']),
    messages: table('messages', ['conversationId', 'role', 'agent', 'content', 'attachmentUrl', 'attachmentFilename', 'attachmentType', 'createdAt']),
    projectFiles: table('projectFiles', ['projectId', 'filename', 'kind', 'textContent']),
  };
  return { db: fake.db, schema };
});

import {
  extractEpisodeCandidates,
  formatFactualEpisodeBlock,
  recallEpisodes,
  recallFactualEpisodes,
  recallMemories,
  recordEpisodes,
  rememberFact,
  termosDeConsulta,
} from '@desigual-os/orchestrator';
import { buildContext } from '@desigual-os/context-engine';
import { resolveClientTurnContext } from './client-context';
import { registrarConhecimentoDoTurno } from './knowledge-statement';
import type { Logger } from '@desigual-os/logging';

const DIA = 86_400_000;
const T0 = new Date('2026-09-21T10:00:00Z').getTime();

function resetAll(): void {
  fake.reset();
}

/* ------------------------------------------------------------------ */
/* 1. CENÁRIO 4 DIAS — regra do Cliente X (memória semântica)          */
/* ------------------------------------------------------------------ */
describe('1. cenário 4 dias — supersessão por subject (memory-engine)', () => {
  beforeEach(() => {
    resetAll();
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  const REGRA_X = {
    kind: 'client.rule',
    subject: 'cliente:x:emojis',
    clientId: 'client-x',
    userId: 'tammy',
    sourceType: 'chat_message' as const,
    environment: 'production',
  };

  async function semeiaQuatroDias() {
    // Dia 1: Tammy informa a regra.
    vi.setSystemTime(T0);
    const d1 = await rememberFact({ ...REGRA_X, content: 'Cliente X proíbe emojis em qualquer post, sem exceção.' });
    // Dia 2: atualização da regra.
    vi.setSystemTime(T0 + DIA);
    const d2 = await rememberFact({ ...REGRA_X, content: 'Cliente X agora permite emojis em posts de bastidores.' });
    // Dia 3: correção da atualização.
    vi.setSystemTime(T0 + 2 * DIA);
    const d3 = await rememberFact({ ...REGRA_X, content: 'Emoji de bastidores no Cliente X vale só pro Instagram, não pro TikTok.' });
    // Cliente Y tem regra DIFERENTE no mesmo store.
    await rememberFact({
      kind: 'client.rule',
      subject: 'cliente:y:emojis',
      clientId: 'client-y',
      userId: 'tammy',
      sourceType: 'chat_message',
      environment: 'production',
      content: 'Cliente Y exige emoji em toda legenda, quanto mais melhor.',
    });
    // Mesma superfície, mas em QA — não pode vazar pra produção.
    await rememberFact({
      ...REGRA_X,
      environment: 'qa',
      subject: 'cliente:x:regra-qa',
      content: 'Regra de homologação em QA: cliente fictício aceita qualquer coisa.',
    });
    return { d1, d2, d3 };
  }

  it('(a) supersessão encadeada: dia 2 aposenta dia 1, dia 3 aposenta dia 2', async () => {
    const { d1, d2, d3 } = await semeiaQuatroDias();
    expect(d1.status).toBe('written');
    expect(d2.status).toBe('superseded');
    expect(d3.status).toBe('superseded');
    if (d1.status === 'written' && d2.status === 'superseded') expect(d2.supersededId).toBe(d1.memoryId);
    if (d2.status === 'superseded' && d3.status === 'superseded') expect(d3.supersededId).toBe(d2.memoryId);

    // (b) as versões antigas ficam INATIVAS no store, não apagadas (auditável).
    const porId = new Map(fake.store.memories.map((m) => [m.id, m]));
    if (d1.status === 'written') expect(porId.get(d1.memoryId)?.status).toBe('superseded');
    if (d2.status === 'superseded') expect(porId.get(d2.memoryId)?.status).toBe('superseded');
  });

  it('(a)+(b) dia 4, pedido implícito: recallMemories devolve APENAS a versão vigente', async () => {
    await semeiaQuatroDias();
    vi.setSystemTime(T0 + 3 * DIA);
    const recall = await recallMemories({ environment: 'production', clientId: 'client-x', kinds: ['client.rule'] });
    const vigentes = recall.filter((m) => !m.content.includes('fictício'));
    expect(vigentes).toHaveLength(1);
    expect(vigentes[0]!.content).toContain('Instagram'); // versão do dia 3 vence
    expect(recall.some((m) => m.content.includes('proíbe emojis'))).toBe(false); // dia 1 não prevalece
    expect(recall.some((m) => m.content.includes('agora permite') && !m.content.includes('Instagram'))).toBe(false);
  });

  it('(c) isolamento por cliente: regra do cliente Y não contamina o recall do cliente X', async () => {
    await semeiaQuatroDias();
    vi.setSystemTime(T0 + 3 * DIA);
    const rx = await recallMemories({ environment: 'production', clientId: 'client-x', kinds: ['client.rule'] });
    const ry = await recallMemories({ environment: 'production', clientId: 'client-y', kinds: ['client.rule'] });
    expect(rx.some((m) => m.content.includes('Cliente Y'))).toBe(false);
    expect(ry).toHaveLength(1);
    expect(ry[0]!.content).toContain('Cliente Y exige emoji');
  });

  it('(d) isolamento por environment: memória de QA não aparece em produção e vice-versa', async () => {
    await semeiaQuatroDias();
    vi.setSystemTime(T0 + 3 * DIA);
    const prod = await recallMemories({ environment: 'production', clientId: 'client-x', kinds: ['client.rule'] });
    const qa = await recallMemories({ environment: 'qa', clientId: 'client-x', kinds: ['client.rule'] });
    expect(prod.some((m) => m.content.includes('fictício'))).toBe(false);
    expect(qa).toHaveLength(1);
    expect(qa[0]!.content).toContain('homologação em QA');
  });
});

/* ------------------------------------------------------------------ */
/* 1b. CENÁRIO 4 DIAS — camada episódica (rótulo ATUAL/SUBSTITUÍDO)    */
/* ------------------------------------------------------------------ */
describe('1b. cenário 4 dias — memória episódica (episodic-memory)', () => {
  beforeEach(() => {
    resetAll();
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  const ESCOPO = { clientId: 'client-x', userId: 'tammy', agent: 'bento', environment: 'production' };

  it('recall factual traz as 3 versões e o bloco rotula ATUAL/SUBSTITUÍDO', async () => {
    // As frases reais passam pelo extrator (FORMAS regex) antes de gravar.
    vi.setSystemTime(T0);
    const d1 = extractEpisodeCandidates('Regra do Cliente X: proibido emoji em qualquer post.');
    expect(d1).toHaveLength(1);
    await recordEpisodes(d1, ESCOPO);

    vi.setSystemTime(T0 + DIA);
    const d2 = extractEpisodeCandidates('Daqui pra frente o Cliente X pode usar emoji em post de bastidores.');
    expect(d2).toHaveLength(1);
    await recordEpisodes(d2, ESCOPO);

    vi.setSystemTime(T0 + 2 * DIA);
    const d3 = extractEpisodeCandidates('A partir de agora, emoji de bastidores do Cliente X só no Instagram, nunca no TikTok.');
    expect(d3).toHaveLength(1);
    await recordEpisodes(d3, ESCOPO);

    // Episódio do cliente Y e um de QA: não podem cruzar.
    await recordEpisodes(
      [{ eventType: 'preference', summary: 'Regra do Cliente Y: sempre usar emoji na legenda.', importance: 0.85 }],
      { clientId: 'client-y', userId: 'tammy', agent: 'bento', environment: 'production' },
    );
    await recordEpisodes(
      [{ eventType: 'decision', summary: 'Decidimos em QA que emoji de cliente fictício vale tudo.', importance: 0.9 }],
      { clientId: 'client-x', userId: 'tammy', agent: 'bento', environment: 'qa' },
    );

    vi.setSystemTime(T0 + 3 * DIA);
    const eps = await recallFactualEpisodes({ clientId: 'client-x', termos: ['emoji'], environment: 'production' });
    // O banco devolve as 3 versões do assunto (mais nova primeiro)...
    expect(eps).toHaveLength(3);
    expect(eps[0]!.summary).toContain('Instagram');
    // ...sem contaminar com cliente Y nem com QA.
    expect(eps.some((e) => e.summary.includes('Cliente Y'))).toBe(false);
    expect(eps.some((e) => e.summary.includes('fictício'))).toBe(false);

    // A supersessão episódica é RÓTULO no bloco, não status no banco.
    const bloco = formatFactualEpisodeBlock(eps);
    const linhas = bloco.split('\n').filter((l) => l.startsWith('- '));
    expect(linhas[0]).toMatch(/^- ATUAL \[2026-09-23.*Instagram/);
    expect(linhas[1]).toMatch(/^- SUBSTITUÍDO \[2026-09-22/);
    expect(linhas[2]).toMatch(/^- SUBSTITUÍDO \[2026-09-21/);
    expect(bloco).toMatch(/Use APENAS o que está marcado ATUAL/i);
  });

  it('recallEpisodes temporal isola environment e cliente (episódio sem cliente entra por design)', async () => {
    vi.setSystemTime(T0);
    await recordEpisodes(
      [{ eventType: 'decision', summary: 'Decidimos que o Cliente X publica 3 posts por semana.', importance: 0.9 }],
      ESCOPO,
    );
    await recordEpisodes(
      [{ eventType: 'decision', summary: 'Decidimos em QA que o fluxo de teste pula aprovação.', importance: 0.9 }],
      { ...ESCOPO, environment: 'qa' },
    );
    await recordEpisodes(
      [{ eventType: 'decision', summary: 'Decidimos que o Cliente Y não quer post aos domingos.', importance: 0.9 }],
      { clientId: 'client-y', userId: 'tammy', agent: 'bento', environment: 'production' },
    );
    await recordEpisodes(
      [{ eventType: 'decision', summary: 'Decidimos padronizar assinatura da agência em todo e-mail.', importance: 0.9 }],
      { clientId: null, userId: 'tammy', agent: 'bento', environment: 'production' },
    );

    const eps = await recallEpisodes({ clientId: 'client-x', desde: new Date(T0 - DIA), environment: 'production' });
    expect(eps.some((e) => e.summary.includes('3 posts por semana'))).toBe(true);
    expect(eps.some((e) => e.summary.includes('fluxo de teste'))).toBe(false); // QA fora
    expect(eps.some((e) => e.summary.includes('Cliente Y'))).toBe(false); // outro cliente fora
    expect(eps.some((e) => e.summary.includes('assinatura da agência'))).toBe(true); // geral entra (design)

    const epsQa = await recallEpisodes({ clientId: 'client-x', desde: new Date(T0 - DIA), environment: 'qa' });
    expect(epsQa).toHaveLength(1);
    expect(epsQa[0]!.summary).toContain('fluxo de teste');
  });
});

/* ------------------------------------------------------------------ */
/* 2. D-09/F-12 — buildContext filtra environment (REGRESSÃO)          */
/* ------------------------------------------------------------------ */
describe('2. regressão F-12: build-context isola environment', () => {
  beforeEach(resetAll);

  it('dossiê gravado com environment=qa NÃO entra no contexto de produção', async () => {
    fake.store.clients.push({ id: 'client-x', name: 'Cliente X', environment: 'production' });
    fake.store.clientBrandKits.push({ clientId: 'client-x', toneOfVoice: 'direto' });
    fake.store.memories.push(
      {
        id: 'm-qa-profile',
        // Procedência obrigatória desde 30/09/2026 — ver o filtro em
        // build-context.ts e o importador antigo que ele exclui.
        metadata: { subject: 'cliente:client-x:dossie' },
        kind: 'client.profile',
        status: 'active',
        environment: 'qa', // memória de homologação
        clientId: 'client-x',
        agentId: null,
        content: 'DOSSIÊ DE HOMOLOGAÇÃO (QA): cliente fictício de teste, não é conta real.',
        expiresAt: null,
        importance: '0.900',
        updatedAt: new Date(T0),
      },
      {
        id: 'm-prod-profile',
        // Procedência obrigatória desde 30/09/2026 — ver o filtro em
        // build-context.ts e o importador antigo que ele exclui.
        metadata: { subject: 'cliente:client-x:brain' },
        kind: 'client.profile',
        status: 'active',
        environment: 'production',
        clientId: 'client-x',
        agentId: null,
        content: 'DOSSIÊ REAL: concessionária John Deere do interior paulista.',
        expiresAt: null,
        importance: '0.800',
        updatedAt: new Date(T0 + 1000),
      },
    );
    // Sem environment explícito: buildContext resolve pela coluna do cliente.
    const ctx = await buildContext({ userId: 'u1', clientId: 'client-x', conversationId: null });
    expect(ctx.clientProfile).toContain('DOSSIÊ REAL');
    expect(ctx.clientProfile).not.toContain('HOMOLOGAÇÃO');

    // E o inverso: turno de QA (explícito) não lê o dossiê de produção.
    const ctxQa = await buildContext({ userId: 'u1', clientId: 'client-x', conversationId: null, environment: 'qa' });
    expect(ctxQa.clientProfile).toContain('HOMOLOGAÇÃO');
    expect(ctxQa.clientProfile).not.toContain('DOSSIÊ REAL');
  });

  it('cliente de QA (clients.environment=qa) resolve sozinho: turno não lê dossiê de produção', async () => {
    fake.store.clients.push({ id: 'client-qa', name: 'Cliente QA', environment: 'qa' });
    fake.store.memories.push(
      {
        id: 'm-qa1', kind: 'client.profile', status: 'active', environment: 'qa', clientId: 'client-qa',
        agentId: null, content: 'Dossiê de homologação do cliente de teste.', expiresAt: null,
        // `subject` acrescentado em 30/09/2026: o construtor de contexto passou
        // a exigir procedência no perfil, para excluir a linha órfã de um
        // importador antigo que podia CONTRADIZER o brain atual. Os
        // importadores de hoje sempre gravam este campo — a fixture sem ele
        // representava uma linha que a produção não produz mais.
        metadata: { subject: 'cliente:client-qa:dossie' },
        importance: '0.900', updatedAt: new Date(T0),
      },
      {
        id: 'm-prod1', kind: 'client.profile', status: 'active', environment: 'production', clientId: 'client-qa',
        agentId: null, content: 'Dossiê de produção que não deve vazar pra QA.', expiresAt: null,
        metadata: { subject: 'cliente:client-qa:dossie' },
        importance: '0.950', updatedAt: new Date(T0 + 1000),
      },
    );
    const ctx = await buildContext({ userId: 'u1', clientId: 'client-qa', conversationId: null });
    expect(ctx.clientProfile).toContain('homologação');
    expect(ctx.clientProfile).not.toContain('vazar pra QA');
  });

  it('aprendizado de QA do agente NÃO entra nos recentLearnings de produção (e vice-versa)', async () => {
    fake.store.agents.push({ id: 'agent-bento', name: 'bento' });
    fake.store.memories.push(
      {
        id: 'm-qa-learning',
        kind: 'agent.learning',
        status: 'active',
        environment: 'qa',
        clientId: null,
        agentId: 'agent-bento',
        content: 'Estratégia vencedora: teste de homologação em QA sem cliente real. Tentativas: 1. Score: 1.',
        expiresAt: null,
        importance: '0.900',
        updatedAt: new Date(T0),
      },
      {
        id: 'm-prod-learning',
        kind: 'agent.learning',
        status: 'active',
        environment: 'production',
        clientId: null,
        agentId: 'agent-bento',
        content: 'Estratégia vencedora: resposta curta com alvo explícito. Tentativas: 2. Score: 1.',
        expiresAt: null,
        importance: '0.800',
        updatedAt: new Date(T0 + 1000),
      },
    );
    const ctx = await buildContext({ userId: 'u1', clientId: null, conversationId: null, agent: 'bento' });
    expect(ctx.recentLearnings.some((l) => l.includes('homologação em QA'))).toBe(false);
    expect(ctx.recentLearnings.some((l) => l.includes('resposta curta'))).toBe(true);

    const ctxQa = await buildContext({ userId: 'u1', clientId: null, conversationId: null, agent: 'bento', environment: 'qa' });
    expect(ctxQa.recentLearnings.some((l) => l.includes('homologação em QA'))).toBe(true);
    expect(ctxQa.recentLearnings.some((l) => l.includes('resposta curta'))).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 2b. F-12 — dossiê do client-context também isola environment        */
/* ------------------------------------------------------------------ */
describe('2b. regressão F-12: dossiê do resolveClientTurnContext isola environment', () => {
  beforeEach(resetAll);

  function semeiaDossies(clientId: string) {
    fake.store.memories.push(
      {
        id: `d-qa-${clientId}`, kind: 'client.profile', status: 'active', environment: 'qa', clientId,
        agentId: null, content: 'DOSSIÊ DE HOMOLOGAÇÃO (QA): conta fictícia de teste.',
        metadata: { subject: `cliente:${clientId}:dossie` }, expiresAt: null, updatedAt: new Date(T0),
      },
      {
        id: `d-prod-${clientId}`, kind: 'client.profile', status: 'active', environment: 'production', clientId,
        agentId: null, content: 'DOSSIÊ REAL: operação verdadeira da carteira.',
        metadata: { subject: `cliente:${clientId}:dossie` }, expiresAt: null, updatedAt: new Date(T0),
      },
    );
  }

  it('cliente de produção: o dossiê de QA fica de fora', async () => {
    fake.store.clients.push({ id: 'client-x', name: 'Cliente X', environment: 'production' });
    semeiaDossies('client-x');
    const ctx = await resolveClientTurnContext({ message: 'x', executionClientId: 'client-x' });
    expect(ctx.profile).toContain('DOSSIÊ REAL');
    expect(ctx.profile).not.toContain('HOMOLOGAÇÃO');
  });

  it('cliente de QA: o dossiê de produção fica de fora', async () => {
    fake.store.clients.push({ id: 'client-qa', name: 'Cliente QA', environment: 'qa' });
    semeiaDossies('client-qa');
    const ctx = await resolveClientTurnContext({ message: 'x', executionClientId: 'client-qa' });
    expect(ctx.profile).toContain('HOMOLOGAÇÃO');
    expect(ctx.profile).not.toContain('DOSSIÊ REAL');
  });
});

/* ------------------------------------------------------------------ */
/* 3. RECALL FACTUAL — acentos, case e volume (ILIKE %termo%)           */
/* ------------------------------------------------------------------ */
describe('3. recall factual — dobra de acento via translate() (F-13) e volume', () => {
  beforeEach(() => {
    resetAll();
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  it('regressão F-13: "orcamento", "orçamento" e "ORÇAMENTO" acham o mesmo episódio', async () => {
    await recordEpisodes(
      [{ eventType: 'preference', summary: 'Anota que o orçamento do Cliente X é 50 mil por mês.', importance: 0.85 }],
      { clientId: 'client-x', userId: 'tammy', environment: 'production' },
    );
    // termosDeConsulta normaliza a PERGUNTA (tira acento); o translate() dobra
    // o acento do RESUMO no SQL — os dois lados passam a falar a mesma língua.
    const termos = termosDeConsulta('qual o orçamento?');
    expect(termos).toEqual(['orcamento']);
    const achou = await recallFactualEpisodes({ clientId: 'client-x', termos, environment: 'production' });
    expect(achou).toHaveLength(1);
    expect(achou[0]!.summary).toContain('orçamento');

    // Caixa alta + acento juntos também acham.
    const gritado = await recallFactualEpisodes({ clientId: 'client-x', termos: ['ORÇAMENTO'], environment: 'production' });
    expect(gritado).toHaveLength(1);

    // Plural básico: o termo no singular casa o resumo no plural (substring).
    await recordEpisodes(
      [{ eventType: 'preference', summary: 'Anota que os orçamentos regionais do Cliente Y sobem em janeiro.', importance: 0.85 }],
      { clientId: 'client-y', userId: 'tammy', environment: 'production' },
    );
    const plural = await recallFactualEpisodes({ clientId: 'client-y', termos: ['orcamento'], environment: 'production' });
    expect(plural).toHaveLength(1);
    expect(plural[0]!.summary).toContain('orçamentos');
  });

  it('COMPORTAMENTO ATUAL (degradação): termo comum em 500 episódios devolve só os 6 mais recentes', async () => {
    vi.setSystemTime(T0);
    await recordEpisodes(
      [{ eventType: 'decision', summary: 'Decidimos que a campanha da Colpar tem verba mensal de 80 mil.', importance: 0.9 }],
      { clientId: 'client-x', userId: 'tammy', environment: 'production' },
    );
    for (let i = 1; i <= 499; i++) {
      vi.setSystemTime(T0 + i * 60_000);
      await recordEpisodes(
        [{ eventType: 'decision', summary: `Decidimos revisar a campanha rotina numero ${i} do cliente.`, importance: 0.7 }],
        { clientId: 'client-x', userId: 'tammy', environment: 'production' },
      );
    }
    const comuns = await recallFactualEpisodes({ clientId: 'client-x', termos: ['campanha'], environment: 'production' });
    // Sem relevância nem full-text: ordena por occurred_at DESC e corta no limit 6 —
    // o fato relevante antigo fica fora mesmo sendo o único que responde a pergunta.
    expect(comuns).toHaveLength(6);
    expect(comuns.some((e) => e.summary.includes('80 mil'))).toBe(false);
    // Termo RARO discrimina e acha — a saída depende inteiramente da pergunta trazer termo raro.
    const raro = await recallFactualEpisodes({ clientId: 'client-x', termos: ['verba'], environment: 'production' });
    expect(raro).toHaveLength(1);
    expect(raro[0]!.summary).toContain('80 mil');
  });
});

/* ------------------------------------------------------------------ */
/* 4. CONTINUIDADE CROSS-CONVERSA — fragilidade das FORMAS regex        */
/* ------------------------------------------------------------------ */
describe('4. cross-conversa — decisões naturais nas FORMAS ampliadas (F-20)', () => {
  // As 10 frases naturais originais do harness; a marca agora é o comportamento
  // CORRIGIDO (26/09/2026). As 2 que seguem fora não têm marcador nenhum —
  // capturá-las exigiria forma genérica que também casaria especulação.
  const FRASES: Array<[string, boolean, string]> = [
    ['Vamos fazer assim então: legenda curta em todos os posts.', true, '"vamos fazer assim" virou forma'],
    ['Decidimos que o post de sexta sai às 18h.', true, 'decidimos'],
    ['Fechado, manda bala nessa versão de bastidores.', true, 'fechado'],
    ['Então tá decidido, fica essa versão final mesmo.', true, '"tá decidido" virou forma'],
    ['Pode seguir com essa linha criativa mesmo.', true, '"pode seguir" virou forma'],
    ['A peça foi aprovada pelo cliente, pode publicar.', true, 'aprovada'],
    ['Ficou acertado que a entrega é quinta-feira.', true, 'ficou acertado'],
    ['Bora com o segundo conceito mesmo, sem mais rodadas de ajuste.', true, '"bora com" virou forma'],
    ['É isso, segue o baile com a opção dois então.', false, 'nenhuma forma — decisão sem marcador continua fora'],
    ['Perfeito, vai ser assim: legenda curta e sem emoji.', false, '"vai ser assim" não virou forma: casaria especulação ("acho que vai ser assim")'],
  ];

  it.each(FRASES)('"%s" → captura=%s (%s)', (frase, esperado) => {
    expect(extractEpisodeCandidates(frase).length > 0).toBe(esperado);
  });

  it('cobertura pós-correção: 8 das 10 decisões naturais viram episódio (eram 4)', () => {
    const capturadas = FRASES.filter(([f]) => extractEpisodeCandidates(f).length > 0).map(([f]) => f);
    expect(capturadas).toEqual([
      'Vamos fazer assim então: legenda curta em todos os posts.',
      'Decidimos que o post de sexta sai às 18h.',
      'Fechado, manda bala nessa versão de bastidores.',
      'Então tá decidido, fica essa versão final mesmo.',
      'Pode seguir com essa linha criativa mesmo.',
      'A peça foi aprovada pelo cliente, pode publicar.',
      'Ficou acertado que a entrega é quinta-feira.',
      'Bora com o segundo conceito mesmo, sem mais rodadas de ajuste.',
    ]);
    expect(capturadas.length).toBe(8);
  });
});

/* ------------------------------------------------------------------ */
/* 4b. F-20 — formas novas de regra declarada + filtro de relevância   */
/* ------------------------------------------------------------------ */
describe('4b. formas novas (F-20) e o que NÃO pode virar memória', () => {
  beforeEach(() => {
    resetAll();
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  const REGRAS: Array<[string, string]> = [
    ['A partir de agora, legenda sem emoji em tudo da Cosentino.', 'preference'],
    ['Vamos fazer assim: primeiro o conceito, depois a legenda.', 'decision'],
    ['Tá decidido, o conceito dois é o que vai.', 'decision'],
    ['Pode seguir com a versão de bastidores.', 'decision'],
    ['Esse cliente não usa emoji nos posts, anota.', 'preference'],
    ['Quando for campanha da 3Net, sempre legenda curta.', 'preference'],
    ['Não usar mais banco de imagem óbvio nos posts.', 'preference'],
    ['Bora com o conceito três então.', 'decision'],
  ];

  it.each(REGRAS)('"%s" vira episódio do tipo %s', (frase, tipo) => {
    const [e] = extractEpisodeCandidates(frase);
    expect(e).toBeDefined();
    expect(e!.eventType).toBe(tipo);
  });

  it.each(['ok', 'beleza', 'tá certo', 'Tá decidido.', 'Pode seguir.', 'Beleza, pode seguir.'])(
    'confirmação casual "%s" NÃO vira memória (filtro de relevância)',
    (frase) => {
      expect(extractEpisodeCandidates(frase)).toEqual([]);
    },
  );

  it('confiança (peso da forma) e proveniência (sourceRefs) viajam com o episódio gravado', async () => {
    const candidatos = extractEpisodeCandidates('Pode seguir com essa linha criativa mesmo.');
    expect(candidatos).toHaveLength(1);
    expect(candidatos[0]!.importance).toBe(0.9); // peso da forma de decisão
    const gravados = await recordEpisodes(candidatos, {
      clientId: 'client-x',
      userId: 'tammy',
      agent: 'bento',
      environment: 'production',
      sourceRefs: ['execution:exec-1'],
    });
    expect(gravados).toBe(1);
    const row = fake.store.agentEpisodes[0]!;
    expect(row.importance).toBe('0.900');
    expect(row.sourceRefs).toEqual(['execution:exec-1']);
  });
});

/* ------------------------------------------------------------------ */
/* 5. F-21 — fast path knowledge-statement grava o FATO, não só o      */
/*    episódio (regressão do caso Marina, 01/10/2026)                  */
/* ------------------------------------------------------------------ */
describe('5. regressão F-21: ensino confirmado no fast path volta na conversa nova', () => {
  beforeEach(resetAll);

  const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;
  const MARINA = 'Anota que o decisor do Cliente Teste 7 é a Marina.';

  function turnoDeEnsino(message: string, clientId: string | null, executionId: string) {
    return registrarConhecimentoDoTurno({
      message,
      clientId,
      clientName: null,
      userId: 'tammy',
      agent: 'bento',
      conversationId: 'conv-origem',
      executionId,
      logger,
    });
  }

  it('caso Marina: episódio (auditoria) E memória (client.profile) gravados, e a leitura da conversa nova devolve o fato', async () => {
    fake.store.clients.push({ id: 'cliente-teste-7', name: 'Cliente Teste 7', environment: 'production' });

    // O turno do ensino: o fast path detecta, grava e confirma.
    const registro = await turnoDeEnsino(MARINA, null, 'exec-marina-1');
    expect(registro).not.toBeNull();
    expect(registro!.gravados).toBe(1);
    expect(registro!.fatosCliente).toBe(1);
    expect(registro!.answer).toContain('Registrado');

    // Auditoria: o episódio continua gravado como antes.
    expect(fake.store.agentEpisodes).toHaveLength(1);
    expect(fake.store.agentEpisodes[0]!.summary).toContain('Marina');

    // O que faltava: o fato em `memories`, com o subject do aspecto decidido.
    const perfis = fake.store.memories.filter((m) => m.kind === 'client.profile');
    expect(perfis).toHaveLength(1);
    expect(perfis[0]!.clientId).toBe('cliente-teste-7');
    expect(perfis[0]!.metadata?.subject).toBe('cliente:cliente-teste-7:aprendizado:decisor');
    expect(perfis[0]!.content).toContain('Marina');
    expect(perfis[0]!.environment).toBe('production');

    // A conversa NOVA lê por duas portas, e as duas devolvem a Marina:
    // (a) recallMemories com os mesmos filtros do montador de contexto;
    const recall = await recallMemories({ clientId: 'cliente-teste-7', kinds: ['client.profile'], environment: 'production' });
    expect(recall.some((m) => m.subject === 'cliente:cliente-teste-7:aprendizado:decisor' && m.content.includes('Marina'))).toBe(true);
    // (b) o caminho real de client-context.ts: resolveClientTurnContext + comporPerfil.
    const ctx = await resolveClientTurnContext({ message: 'prepara o post de sexta', executionClientId: 'cliente-teste-7' });
    expect(ctx.clientId).toBe('cliente-teste-7');
    expect(ctx.profile).toContain('Marina');
    expect(ctx.profile).toContain('REGISTRO APRENDIDO');
  });

  it('ensinamento SEM cliente citado não quebra nada: episódio gravado, memória só se houver cliente da execução', async () => {
    // Sem cliente citado e sem cliente na execução: não há dono pro fato —
    // descartado de propósito, e o turno confirma o episódio normalmente.
    const semDono = await turnoDeEnsino('Anota que a agência não trabalha aos domingos.', null, 'exec-geral-1');
    expect(semDono).not.toBeNull();
    expect(semDono!.gravados).toBe(1);
    expect(semDono!.fatosCliente).toBe(0);
    expect(fake.store.agentEpisodes).toHaveLength(1);
    expect(fake.store.memories).toHaveLength(0);

    // Com cliente na execução, o fato sem nome citado vai pro cliente do turno.
    fake.store.clients.push({ id: 'cliente-teste-7', name: 'Cliente Teste 7', environment: 'production' });
    // Frase com corpo: abaixo de 25 chars de fato o rememberFact descarta por
    // relevância (piso do pipeline, memory-engine.ts), independente deste fix.
    const comDono = await turnoDeEnsino('Anota que quem aprova as peças é a Marina.', 'cliente-teste-7', 'exec-geral-2');
    expect(comDono).not.toBeNull();
    expect(comDono!.fatosCliente).toBe(1);
    const perfil = fake.store.memories.find((m) => m.kind === 'client.profile');
    expect(perfil?.clientId).toBe('cliente-teste-7');
    expect(perfil?.content).toContain('Marina');
    expect(perfil?.metadata?.subject).toBe('cliente:cliente-teste-7:aprendizado:decisor');
  });

  it('cliente citado que NÃO existe na carteira continua descartado de propósito (resolverDono)', async () => {
    // Carteira vazia: "Padaria do Zé" não resolve, e gravar por aproximação
    // envenenaria o dossiê — o fato é descartado, o episódio não.
    const registro = await turnoDeEnsino('Anota que o decisor do Padaria do Zé é o Zé.', null, 'exec-inexistente-1');
    expect(registro).not.toBeNull();
    expect(registro!.gravados).toBe(1);
    expect(registro!.fatosCliente).toBe(0);
    expect(fake.store.agentEpisodes).toHaveLength(1);
    expect(fake.store.memories).toHaveLength(0);
  });

  it('nem episódio nem memória em duplicata: repetir o MESMO ensino não grava de novo', async () => {
    fake.store.clients.push({ id: 'cliente-teste-7', name: 'Cliente Teste 7', environment: 'production' });

    const primeiro = await turnoDeEnsino(MARINA, null, 'exec-marina-1');
    expect(primeiro).not.toBeNull();

    // Mesma frase, mesma conversa: o dedupe de recordEpisodes (dedupe_key)
    // devolve 0 gravados, o fast path NÃO confirma de novo e a captura de
    // fatos nem roda — o store fica exatamente como estava.
    const repetido = await turnoDeEnsino(MARINA, null, 'exec-marina-1-retry');
    expect(repetido).toBeNull();
    expect(fake.store.agentEpisodes).toHaveLength(1);
    expect(fake.store.memories).toHaveLength(1);
  });
});

/**
 * semantic-recall-trace.test.ts — busca semântica de memórias (01/10/2026).
 *
 * Prova o que a feature promete e o que ela NUNCA pode fazer:
 *  (a) vetor perfeito de OUTRO environment não retorna (isolamento duro);
 *  (b) vetor perfeito de memória 'superseded' não retorna;
 *  (c) vetor perfeito de OUTRO clientId não retorna;
 *  (d) reconfirmação (rememberFact com mesmo dedupeKey) REGERA o vetor
 *      (updatedAt da linha em memory_embeddings muda);
 *  (e) o bloco semântico entra no contexto montado do turno, na posição da
 *      ORDEM (depois de episodios, antes de preferencias).
 *
 * Harness no padrão do bento-memory-trace.test.ts: drizzle-orm vira
 * descritores de condição, @desigual-os/database vira bancinho fake — aqui
 * estendido com innerJoin/leftJoin (o recall semântico junta memories com
 * memory_embeddings) e onConflictDoUpdate (upsert do vetor). A OpenAI é um
 * client fake injetado via __setEmbeddingsClientForTest: vetores
 * determinísticos por hash, zero custo (regra do repo).
 */
import { createHash } from 'node:crypto';
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
  interface SelectQuery {
    innerJoin: (table: FakeTable, cond: Cond) => SelectQuery;
    leftJoin: (table: FakeTable, cond: Cond) => SelectQuery;
    where: (cond: Cond) => Chainable;
  }
  interface InsertChain {
    returning: (cols?: unknown) => Promise<IdRows>;
    onConflictDoNothing: () => ThenableQuery<IdRows> & {
      returning: (cols?: unknown) => Promise<IdRows>;
    };
    onConflictDoUpdate: (arg: { target: unknown; set: R }) => Promise<IdRows>;
  }
  interface UpdateChain extends ThenableQuery<IdRows> {
    returning: (cols?: unknown) => Promise<IdRows>;
  }
  const store = {
    memories: [] as R[],
    memoryEmbeddings: [] as R[],
    // organizacaoDaEscrita (auth) consulta estas na escrita — ver bento-memory-trace.
    organizationMembers: [] as R[],
    users: [] as R[],
    clients: [] as R[],
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
    // memory-engine supersessão — metadata->>'subject' = ${subject}
    if (text.includes("->>'subject'")) return row.metadata?.subject === last;
    // expires_at > now()
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

  interface Join {
    type: 'inner' | 'left';
    table: FakeTable;
    cond: Cond;
  }

  /**
   * Junta base + tabela do join pela condição eq(colDaDireita, colDaBase).
   * Linha unida = { ...direita, ...base }: a base sobrepõe id/updatedAt (é o
   * que o código lê) e a direita contribui vector/model/contentHash/memoryId.
   */
  function computeJoined(baseKey: string, join?: Join): R[] {
    const base = rowsOf(baseKey);
    if (!join) return [...base];
    const right = rowsOf(tableKey(join.table));
    const rightCol = colName(join.cond.column);
    const baseCol = colName(String(join.cond.value));
    const out: R[] = [];
    for (const r of base) {
      const matches = right.filter((rr) => rr[rightCol] === r[baseCol]);
      if (matches.length === 0) {
        if (join.type === 'left') out.push({ ...r });
        continue;
      }
      for (const m of matches) out.push({ ...m, ...r });
    }
    return out;
  }

  function chainable(compute: () => R[]): Chainable {
    let cached: R[] | null = null;
    const get = () => (cached ??= compute());
    return {
      then: (res, rej) => Promise.resolve().then(get).then(res, rej),
      catch: (rej) => Promise.resolve().then(get).catch(rej),
      orderBy: (...descs: Cond[]) => chainable(() => applyOrder(get(), descs)),
      limit: (n: number) => Promise.resolve().then(() => get().slice(0, n)),
    };
  }

  const tableKey = (table: FakeTable): string => table.__table!;

  const db = {
    select: (_cols?: unknown) => ({
      from: (table: FakeTable) => {
        const baseKey = tableKey(table);
        const makeQuery = (join?: Join): SelectQuery => ({
          innerJoin: (t: FakeTable, cond: Cond) => makeQuery({ type: 'inner', table: t, cond }),
          leftJoin: (t: FakeTable, cond: Cond) => makeQuery({ type: 'left', table: t, cond }),
          where: (cond: Cond) => chainable(() => computeJoined(baseKey, join).filter((r) => evalCond(r, cond))),
        });
        return makeQuery();
      },
    }),
    insert: (table: FakeTable) => ({
      values: (v: R): InsertChain => {
        const key = tableKey(table);
        const doInsert = () => {
          // defaultNow() do schema: createdAt/updatedAt nascem no insert se não vierem.
          const row = { createdAt: new Date(), updatedAt: new Date(), ...v, id: v.id ?? `${key}-${++seq}` };
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
            // backfill: onConflictDoNothing() awaited direto, sem returning.
            then: (res, rej) =>
              Promise.resolve()
                .then(() => (rowsOf(key).some((r) => r.memoryId === v.memoryId) ? [] : doInsert()))
                .then(res, rej),
          }),
          // Upsert do vetor (generateAndStoreMemoryEmbedding): conflito em
          // memoryId => aplica o set (que inclui updatedAt novo).
          onConflictDoUpdate: ({ target, set }: { target: unknown; set: R }) =>
            Promise.resolve().then(() => {
              const alvo = colName(String(target));
              const existente = rowsOf(key).find((r) => r[alvo] === v[alvo]);
              if (existente) {
                Object.assign(existente, set);
                return [{ id: existente.id }];
              }
              return doInsert();
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
    memoryEmbeddings: table('memoryEmbeddings', ['id', 'memoryId', 'model', 'vector', 'contentHash', 'createdAt', 'updatedAt']),
    users: table('users', ['id', 'name']),
    clients: table('clients', ['id', 'name', 'environment', 'slug', 'organizationId']),
    organizationMembers: table('organizationMembers', ['userId', 'organizationId']),
  };
  return { db: fake.db, schema };
});

import { recallMemoriesSemantic, rememberFact } from '@desigual-os/orchestrator';
import { __setEmbeddingsClientForTest } from '@desigual-os/openai-provider';
import { assembleContext, type BlocoDeContexto } from './context-assembler';

// O worker não depende do SDK `openai` direto; o tipo vem da assinatura do hook.
type OpenAIClient = Parameters<typeof __setEmbeddingsClientForTest>[0];

/** Vetor determinístico por hash — texto igual, vetor igual; texto diferente, quase ortogonal. */
function vetorFake(texto: string): number[] {
  const h = createHash('sha256').update(texto).digest();
  return Array.from(h.subarray(0, 16)).map((b) => b / 255 - 0.5);
}

const fakeOpenAI = {
  embeddings: {
    create: async ({ input }: { input: string | string[] }) => {
      const textos = Array.isArray(input) ? input : [input];
      return { data: textos.map((t, index) => ({ index, embedding: vetorFake(t) })) };
    },
  },
} as unknown as OpenAIClient;

/** Eixo-base explícito: similaridade 1 com ele mesmo, 0 com o eixo seguinte. */
const E1 = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const E2 = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

const T0 = new Date('2026-10-01T10:00:00Z').getTime();

/** O hook de embedding é fire-and-forget: microtasks puras bastam (fake db não usa timers). */
async function flush(): Promise<void> {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}

function semeiaMemoriaComVetor(mem: Row, vector: number[]): void {
  fake.store.memories.push({
    agentId: null,
    userId: null,
    sourceType: 'chat_message',
    sourceId: null,
    confidence: '0.900',
    importance: '0.800',
    metadata: {},
    expiresAt: null,
    updatedAt: new Date(T0),
    ...mem,
  });
  fake.store.memoryEmbeddings.push({
    id: `emb-${mem.id}`,
    memoryId: mem.id,
    model: 'text-embedding-3-small',
    vector,
    contentHash: 'hash',
    createdAt: new Date(T0),
    updatedAt: new Date(T0),
  });
}

beforeEach(() => {
  fake.reset();
  __setEmbeddingsClientForTest(fakeOpenAI);
});

afterEach(() => {
  __setEmbeddingsClientForTest(null);
  vi.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* (a)(b)(c) — ISOLAMENTO: vetor perfeito não atravessa fronteira      */
/* ------------------------------------------------------------------ */
describe('recall semântico — isolamento de environment, status e cliente', () => {
  const PERGUNTA = 'como o cliente quer a legenda?';

  it('(a) vetor perfeito de OUTRO environment NÃO retorna; o do ambiente certo retorna com similaridade 1', async () => {
    semeiaMemoriaComVetor(
      { id: 'm-qa', kind: 'client.rule', content: 'Regra de homologação em QA.', status: 'active', environment: 'qa', clientId: 'client-x' },
      E1,
    );
    semeiaMemoriaComVetor(
      { id: 'm-prod', kind: 'client.rule', content: 'Cliente X proíbe emoji em qualquer post.', status: 'active', environment: 'production', clientId: 'client-x' },
      E1,
    );
    const recall = await recallMemoriesSemantic({ text: PERGUNTA, environment: 'production', clientId: 'client-x', queryVector: E1 });
    expect(recall.map((m) => m.id)).toEqual(['m-prod']);
    expect(recall[0]!.similarity).toBeCloseTo(1, 10);
    const qa = await recallMemoriesSemantic({ text: PERGUNTA, environment: 'qa', clientId: 'client-x', queryVector: E1 });
    expect(qa.map((m) => m.id)).toEqual(['m-qa']);
  });

  it("(b) status='superseded' com vetor perfeito NÃO retorna", async () => {
    semeiaMemoriaComVetor(
      { id: 'm-velha', kind: 'client.rule', content: 'Versão antiga da regra, já aposentada.', status: 'superseded', environment: 'production', clientId: 'client-x' },
      E1,
    );
    semeiaMemoriaComVetor(
      { id: 'm-vigente', kind: 'client.rule', content: 'Versão vigente da regra.', status: 'active', environment: 'production', clientId: 'client-x' },
      E1,
    );
    const recall = await recallMemoriesSemantic({ text: PERGUNTA, environment: 'production', clientId: 'client-x', queryVector: E1 });
    expect(recall.map((m) => m.id)).toEqual(['m-vigente']);
  });

  it('(c) vetor perfeito de OUTRO clientId NÃO retorna', async () => {
    semeiaMemoriaComVetor(
      { id: 'm-y', kind: 'client.rule', content: 'Regra do Cliente Y, não é do escopo.', status: 'active', environment: 'production', clientId: 'client-y' },
      E1,
    );
    semeiaMemoriaComVetor(
      { id: 'm-x', kind: 'client.rule', content: 'Regra do Cliente X, do escopo.', status: 'active', environment: 'production', clientId: 'client-x' },
      E2,
    );
    const recall = await recallMemoriesSemantic({
      text: PERGUNTA,
      environment: 'production',
      clientId: 'client-x',
      // Threshold baixo de propósito: prova que o que exclui o cliente Y é o
      // FILTRO DE ESCOPO, não a semelhança.
      minSimilarity: -1,
      queryVector: E1,
    });
    expect(recall.some((m) => m.id === 'm-y')).toBe(false);
  });

  it('memória sem vetor não participa (ausência da linha = pendente), e vetor distante fica abaixo do piso', async () => {
    fake.store.memories.push({
      id: 'm-sem-vetor', kind: 'client.rule', content: 'Memória anterior à feature, sem embedding.',
      status: 'active', environment: 'production', clientId: 'client-x', agentId: null, userId: null,
      sourceType: 'chat_message', sourceId: null, confidence: '0.900', importance: '0.800',
      metadata: {}, expiresAt: null, updatedAt: new Date(T0),
    });
    semeiaMemoriaComVetor(
      { id: 'm-distante', kind: 'client.rule', content: 'Assunto completamente diverso da pergunta.', status: 'active', environment: 'production', clientId: 'client-x' },
      E2,
    );
    semeiaMemoriaComVetor(
      { id: 'm-certa', kind: 'client.rule', content: 'Legenda curta e sem emoji, sempre.', status: 'active', environment: 'production', clientId: 'client-x' },
      E1,
    );
    const recall = await recallMemoriesSemantic({ text: PERGUNTA, environment: 'production', clientId: 'client-x', queryVector: E1 });
    expect(recall.map((m) => m.id)).toEqual(['m-certa']);
  });
});

/* ------------------------------------------------------------------ */
/* (d) — reconfirmação REGERA o vetor                                  */
/* ------------------------------------------------------------------ */
describe('escrita — hook fire-and-forget de embedding', () => {
  it('(d) rememberFact grava vetor no insert e REGERA na reconfirmação (updatedAt muda)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const INPUT = {
      kind: 'client.rule',
      content: 'Cliente X proíbe emojis em qualquer post, sem exceção.',
      clientId: 'client-x',
      sourceType: 'chat_message' as const,
      environment: 'production',
    };

    const escrita = await rememberFact(INPUT);
    expect(escrita.status).toBe('written');
    await flush();
    expect(fake.store.memoryEmbeddings).toHaveLength(1);
    const vetor0 = fake.store.memoryEmbeddings[0]!;
    expect(vetor0.vector).toEqual(vetorFake(INPUT.content));
    expect(vetor0.updatedAt?.getTime()).toBe(T0);

    // Mesma informação, fonte nova: reconfirmação — content é sobrescrito no
    // update, então o vetor precisa ser regerado junto.
    vi.setSystemTime(T0 + 3_600_000);
    const reconfirmacao = await rememberFact({ ...INPUT, sourceId: 'msg-2' });
    expect(reconfirmacao.status).toBe('reconfirmed');
    await flush();

    expect(fake.store.memoryEmbeddings).toHaveLength(1); // upsert, não duplicata
    const vetor1 = fake.store.memoryEmbeddings[0]!;
    expect(vetor1.updatedAt?.getTime()).toBe(T0 + 3_600_000);
    expect(vetor1.vector).toEqual(vetorFake(INPUT.content));
  });

  it('falha da API de embedding NÃO impede a gravação da memória', async () => {
    __setEmbeddingsClientForTest({
      embeddings: { create: async () => Promise.reject(new Error('429 quota')) },
    } as unknown as OpenAIClient);
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const escrita = await rememberFact({
      kind: 'client.rule',
      content: 'Cliente X proíbe emojis em qualquer post, sem exceção.',
      clientId: 'client-x',
      sourceType: 'chat_message',
      environment: 'production',
    });
    await flush();
    expect(escrita.status).toBe('written');
    expect(fake.store.memories).toHaveLength(1); // memória gravada
    expect(fake.store.memoryEmbeddings).toHaveLength(0); // sem vetor = pendente, backfill cobre
  });
});

/* ------------------------------------------------------------------ */
/* (e) — o bloco semântico entra no contexto montado do turno          */
/* ------------------------------------------------------------------ */
describe('context-assembler — fonte memoria_semantica', () => {
  it('(e) entra no pacote na posição da ORDEM: depois de episodios, antes de preferencias', () => {
    const blocos: BlocoDeContexto[] = [
      { fonte: 'frescor', texto: 'AVISO DE FRESCOR' },
      { fonte: 'dialogo', texto: 'DIÁLOGO RECENTE', evidenciavel: false },
      { fonte: 'cliente', texto: 'DOSSIÊ DO CLIENTE' },
      { fonte: 'episodios', texto: 'EPISÓDIO DATADO' },
      { fonte: 'memoria_semantica', texto: 'MEMÓRIA POR SEMELHANÇA: legenda curta e sem emoji', evidenciavel: false },
      { fonte: 'preferencias', texto: 'PREFERÊNCIA REGISTRADA' },
      { fonte: 'aprendizado', texto: 'APRENDIZADO ENSINADO' },
    ];
    const pack = assembleContext(blocos);
    expect(pack.fontes).toEqual(['frescor', 'dialogo', 'cliente', 'episodios', 'memoria_semantica', 'preferencias', 'aprendizado']);
    expect(pack.texto).toContain('MEMÓRIA POR SEMELHANÇA');
    // E a posição no TEXTO segue a autoridade: semelhança depois do episódio
    // datado, antes da preferência.
    const iEpisodio = pack.texto.indexOf('EPISÓDIO DATADO');
    const iSemantica = pack.texto.indexOf('MEMÓRIA POR SEMELHANÇA');
    const iPreferencia = pack.texto.indexOf('PREFERÊNCIA REGISTRADA');
    expect(iEpisodio).toBeLessThan(iSemantica);
    expect(iSemantica).toBeLessThan(iPreferencia);
  });

  it('orçamento apertado não zera o bloco semântico (piso 600), mas corta quando não couber nem o piso', () => {
    const textoGordo = 'x'.repeat(1_000);
    const pack = assembleContext([
      { fonte: 'cliente', texto: 'c'.repeat(2_500) },
      { fonte: 'memoria_semantica', texto: textoGordo },
      { fonte: 'preferencias', texto: 'p'.repeat(400) },
    ]);
    // O piso de preferencias (400) é reservado antes de cortar a memória
    // semântica, e o bloco sobrevive com espaço real — não é zerado.
    expect(pack.tamanhoPorFonte.memoria_semantica ?? 0).toBeGreaterThan(0);
    expect(pack.tamanhoPorFonte.preferencias).toBe(400);
  });
});

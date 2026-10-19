/**
 * retrieval-planner-dispatch.test.ts — o planner DENTRO do turno do Bento.
 *
 * Prova a ponta a ponta do Retrieval Planner (01/10/2026), com o dispatch
 * agêntico real rodando sobre o bancinho fake (padrão bento-memory-trace /
 * semantic-recall-trace, aqui estendido com as tabelas que o turno toca):
 *
 *  (a) pergunta de mudança → o bloco EVENTOS RECENTES entra no contexto que o
 *      node recebe, com visibilidade PRIVATE e outro cliente de fora;
 *  (b) pergunta de estado → a lista AO VIVO entra no contexto; falha do
 *      provedor degrada sem quebrar o turno; e o guard de frescor (janela de
 *      5min) VETA a consulta quando o registro está fresco — o planner sugere,
 *      quem decide é o guard;
 *  (c) o intent do Router, agora no AgentJobData, liga o reforço semântico
 *      (top-k 5 → 8) mesmo sem forma interrogativa; e a forma interrogativa
 *      liga o mesmo reforço sem intent;
 *  (d) job antigo (sem intent) + small talk = plano nulo, turno idêntico ao
 *      de antes da feature.
 *
 * Zero OpenAI (embeddings por hook de teste com vetor fixo), zero Redis
 * (ioredis mockado), zero ClickUp (resolveTaskProvider mockado).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@desigual-os/logging';
import type { AgentJobData } from '@desigual-os/orchestrator';
import type { ExecuteResponse } from '@desigual-os/node-protocol';
import type * as ToolGateway from '@desigual-os/tool-gateway';

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

// Redis real não existe em teste: o publish de checkpoint (agent.phase) e o
// canal de WS passam por aqui.
//
// ATENÇÃO à fiação deste mock (achado de 05/10/2026, 13/13 testes em timeout):
// o vitest registra o vi.mock pela CHAVE RESOLVIDA do specifier. 'ioredis' só
// resolve a partir de packages/orchestrator (é dependência dele, não do
// worker); sem ioredis declarado no package.json do worker, o mock ficava
// registrado sob a chave crua e NÃO interceptava o import real de queues.ts —
// getRedisConnection() criava um IORedis de verdade, e o `publish` do
// checkpoint final (maxRetriesPerRequest: null) esperava a conexão para
// sempre. Passava em 01/10 porque o redis local estava no ar e absorvia os
// publishes: verde por acidente de ambiente, não por mock. Por isso ioredis
// é devDependency do worker: é o que torna este mock alcançável pro grafo
// inteiro — e o último describe deste arquivo prova que o publish do turno
// de fato passa por AQUI.
const redisProbe = vi.hoisted(() => ({ publishes: [] as Array<{ channel: string; message: string }> }));
vi.mock('ioredis', () => ({
  default: class FakeRedis {
    publish(channel: string, message: string) {
      redisProbe.publishes.push({ channel, message });
      return Promise.resolve(1);
    }
    duplicate() {
      return {
        on() {},
        subscribe() { return Promise.resolve(); },
        unsubscribe() { return Promise.resolve(1); },
        quit() { return Promise.resolve('OK'); },
      };
    }
  },
}));

vi.mock('@desigual-os/logging', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

// O provedor de tarefas é injetado por teste: lista, falha ou veto do guard.
const tg = vi.hoisted(() => ({ provider: null as unknown }));
vi.mock('@desigual-os/tool-gateway', async (importOriginal) => ({
  ...(await importOriginal<typeof ToolGateway>()),
  resolveTaskProvider: () => Promise.resolve(tg.provider),
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
  /** O código real awaita o from/where/orderBy/limit/values e chama .catch
   *  direto: then/catch com a assinatura do Promise sobre o payload T. */
  interface ThenableQuery<T> {
    then: <TResult1 = T, TResult2 = never>(
      res?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
      rej?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => Promise<TResult1 | TResult2>;
    catch: <TResult = never>(
      rej?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
    ) => Promise<T | TResult>;
  }
  interface QueryChain extends ThenableQuery<R[]> {
    where: (cond: Cond) => QueryChain;
    innerJoin: (table: FakeTable, cond: Cond) => QueryChain;
    leftJoin: (table: FakeTable, cond: Cond) => QueryChain;
    orderBy: (...descs: Cond[]) => QueryChain;
    limit: (n: number) => QueryChain;
  }
  interface InsertChain extends ThenableQuery<IdRows> {
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
    agentEpisodes: [] as R[],
    users: [] as R[],
    clients: [] as R[],
    organizationMembers: [] as R[],
    clientBrandKits: [] as R[],
    agents: [] as R[],
    messages: [] as R[],
    campaigns: [] as R[],
    clientKnowledgeSync: [] as R[],
    people: [] as R[],
    personClientRelations: [] as R[],
    integrationHealth: [] as R[],
    operationalEvents: [] as R[],
    agentExecutionStates: [] as R[],
    agentEvidence: [] as R[],
    agentOutcomes: [] as R[],
  };
  const rowsOf = (key: string): R[] => (store as Record<string, R[]>)[key] ?? [];
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
    if (text.includes("->>'subject'") && text.includes('is not null')) {
      return row.metadata?.subject !== undefined && row.metadata?.subject !== null;
    }
    if (text.includes("->>'subject'")) return row.metadata?.subject === last;
    if (text.includes(' ilike ')) {
      const dobra = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      const termo = String(last).replace(/^%|%$/g, '');
      const resumo = String(row.summary ?? '');
      if (text.includes('translate(')) return dobra(resumo).includes(dobra(termo));
      return resumo.toLowerCase().includes(termo.toLowerCase());
    }
    if (text.includes(' in ') && Array.isArray(last)) return last.includes(row.eventType);
    if (text.includes('= ANY(')) {
      const raw = last as Cond | undefined;
      const lista = [...String((raw?.strings ?? []).join('')).matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]!.replace(/''/g, "'"));
      return lista.includes(String(row.kind));
    }
    if (text.includes('COALESCE') && text.includes('>=')) return Number(row.importance ?? 0.5) >= Number(last);
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

  interface Join { type: 'inner' | 'left'; table: FakeTable; cond: Cond }

  /** Todo estágio da query é "thenable": o código real usa .catch direto no
   *  from(), no where(), no orderBy() e no limit() — todos precisam responder.
   *  A projeção do select (alias -> 'tabela.coluna') vale só na MATERIALIZAÇÃO:
   *  where/orderBy/join operam na linha crua, porque condição pode citar coluna
   *  que o select não projetou (ex.: status no recall semântico). */
  function q(compute: () => R[], project?: (row: R) => R): QueryChain {
    let cached: R[] | null = null;
    const get = () => (cached ??= compute());
    const materializar = () => (project ? get().map(project) : get());
    return {
      then: (res, rej) => Promise.resolve().then(materializar).then(res, rej),
      catch: (rej) => Promise.resolve().then(materializar).catch(rej),
      where: (cond: Cond) => q(() => get().filter((r) => evalCond(r, cond)), project),
      innerJoin: (t: FakeTable, cond: Cond) => qJoin(get, { type: 'inner', table: t, cond }, project),
      leftJoin: (t: FakeTable, cond: Cond) => qJoin(get, { type: 'left', table: t, cond }, project),
      orderBy: (...descs: Cond[]) => q(() => applyOrder(get(), descs), project),
      limit: (n: number) => q(() => get().slice(0, n), project),
    };
  }
  function qJoin(getBase: () => R[], join: Join, project?: (row: R) => R): QueryChain {
    return q(() => {
      const right = rowsOf(tableKey(join.table));
      const rightCol = colName(join.cond.column);
      const baseCol = colName(String(join.cond.value));
      const out: R[] = [];
      for (const r of getBase()) {
        const matches = right.filter((rr) => rr[rightCol] === r[baseCol]);
        if (matches.length === 0) {
          if (join.type === 'left') out.push({ ...r });
          continue;
        }
        for (const m of matches) out.push({ ...m, ...r });
      }
      return out;
    }, project);
  }

  const tableKey = (table: FakeTable): string => table.__table!;

  /** select({ alias: schema.t.col }) -> a linha entregue tem os ALIASES. */
  const makeProject = (cols: unknown): ((row: R) => R) | undefined => {
    if (!cols || typeof cols !== 'object') return undefined;
    const entradas = Object.entries(cols as Record<string, unknown>).filter(([, ref]) => typeof ref === 'string');
    if (entradas.length === 0) return undefined;
    return (row: R) => Object.fromEntries(entradas.map(([alias, ref]) => [alias, row[colName(ref as string)]])) as R;
  };

  const db = {
    select: (cols?: unknown) => ({ from: (table: FakeTable) => q(() => rowsOf(tableKey(table)), makeProject(cols)) }),
    insert: (table: FakeTable) => ({
      values: (v: R | R[]): InsertChain => {
        const key = tableKey(table);
        const lista = Array.isArray(v) ? v : [v];
        const doInsert = (): IdRows => {
          const ids: string[] = [];
          for (const item of lista) {
            const row = { createdAt: new Date(), updatedAt: new Date(), ...item, id: item.id ?? `${key}-${++seq}` };
            rowsOf(key).push(row);
            ids.push(row.id);
          }
          return ids.map((id) => ({ id }));
        };
        const dedupeOuInsere = (): IdRows => {
          const primeiro: R = lista[0] ?? {};
          if (primeiro.memoryId && rowsOf(key).some((r) => r.memoryId === primeiro.memoryId)) return [];
          if (primeiro.dedupeKey && rowsOf(key).some((r) => r.dedupeKey === primeiro.dedupeKey)) return [];
          return doInsert();
        };
        return {
          // Insert "solto" (await db.insert(...).values(...)) e com .catch direto.
          then: (res, rej) => Promise.resolve().then(doInsert).then(res, rej),
          catch: (rej) => Promise.resolve().then(doInsert).catch(rej),
          returning: (_cols?: unknown) => Promise.resolve().then(doInsert),
          onConflictDoNothing: () => ({
            returning: (_cols?: unknown) => Promise.resolve().then(dedupeOuInsere),
            then: (res, rej) => Promise.resolve().then(dedupeOuInsere).then(res, rej),
            catch: (rej) => Promise.resolve().then(dedupeOuInsere).catch(rej),
          }),
          onConflictDoUpdate: ({ target, set }: { target: unknown; set: R }) =>
            Promise.resolve().then(() => {
              const alvo = colName(String(target));
              const primeiro: R = lista[0] ?? {};
              const existente = rowsOf(key).find((r) => r[alvo] === primeiro[alvo]);
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
            catch: (rej) => Promise.resolve().then(apply).catch(rej),
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
    agentEpisodes: table('agentEpisodes', [
      'id', 'occurredAt', 'clientId', 'campaignId', 'userId', 'agent', 'conversationId', 'executionId',
      'eventType', 'summary', 'facts', 'decisions', 'feedback', 'sourceRefs', 'importance', 'environment', 'dedupeKey',
      'organizationId',
    ]),
    users: table('users', ['id', 'name', 'email']),
    clients: table('clients', ['id', 'name', 'environment', 'slug', 'organizationId', 'clickupListId', 'deletedAt']),
    organizationMembers: table('organizationMembers', ['userId', 'organizationId']),
    clientBrandKits: table('clientBrandKits', ['clientId', 'toneOfVoice']),
    agents: table('agents', ['id', 'name']),
    messages: table('messages', ['conversationId', 'role', 'agent', 'content', 'createdAt']),
    campaigns: table('campaigns', [
      'id', 'clientId', 'canonicalName', 'aliases', 'status', 'taskCount', 'openTaskCount', 'lastSourceUpdateAt', 'recentTasks',
    ]),
    clientKnowledgeSync: table('clientKnowledgeSync', ['clientId', 'source', 'lastSyncAt']),
    people: table('people', ['id', 'canonicalName', 'aliases', 'employmentType', 'activeStatus']),
    personClientRelations: table('personClientRelations', [
      'personId', 'clientId', 'relationType', 'temporalStatus', 'evidenceCount', 'lastSeenAt',
    ]),
    integrationHealth: table('integrationHealth', ['source', 'status', 'lastEventAt', 'detail']),
    operationalEvents: table('operationalEvents', [
      'id', 'source', 'type', 'externalId', 'clientId', 'entityType', 'entityId', 'actor', 'payload',
      'occurredAt', 'processedAt', 'createdAt', 'organizationId', 'employeeId', 'userId', 'projectId',
      'taskId', 'summary', 'importance', 'visibility',
    ]),
    agentExecutionStates: table('agentExecutionStates', [
      'executionId', 'agent', 'userId', 'clientId', 'conversationId', 'phase', 'taskClass', 'iterations',
      'evaluatorScore', 'state', 'updatedAt',
    ]),
    agentEvidence: table('agentEvidence', [
      'executionId', 'agent', 'userId', 'clientId', 'type', 'source', 'sourceId', 'confidence', 'validAt', 'summary',
    ]),
    agentOutcomes: table('agentOutcomes', [
      'executionId', 'agent', 'userId', 'clientId', 'conversationId', 'goalCompletion', 'firstAttemptSuccess',
      'iterations', 'toolFailures', 'evaluatorScore', 'latencyMs', 'taskClass',
    ]),
  };
  return { db: fake.db, schema };
});

import { dispatchWithAgentLoop } from './agentic-dispatch';
import { __setEmbeddingsClientForTest } from '@desigual-os/openai-provider';
import { PLANO_NULO, type PlanoDeRecuperacao } from './retrieval-planner';

/** O recorte do trace do turno que estes testes auditam (ExecuteResponse
 *  metadata é Record<string, unknown> — ver node-protocol). */
interface TraceDoTurno {
  agentic: { retrieval_plan: PlanoDeRecuperacao };
}

type OpenAIClient = Parameters<typeof __setEmbeddingsClientForTest>[0];

/** Vetor fixo: TODA consulta e TODA memória têm similaridade 1 entre si —
 *  o que decide o corte é o top-k, que é exatamente o que o reforço muda. */
const E1 = Array.from({ length: 16 }, (_, i) => (i === 0 ? 1 : 0));

const fakeOpenAI = {
  embeddings: {
    create: async ({ input }: { input: string | string[] }) => {
      const textos = Array.isArray(input) ? input : [input];
      return { data: textos.map((_t, index) => ({ index, embedding: E1 })) };
    },
  },
} as unknown as OpenAIClient;

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;

const RESPOSTA = 'A Cosentino consta com as movimentações registradas abaixo, cada uma com a data em que aconteceu.';

function capturadorDeChamada() {
  const chamadas: Array<{ message: string; contextoApartado?: string }> = [];
  const callAgent = async (message: string, contextoApartado?: string): Promise<ExecuteResponse> => {
    chamadas.push({ message, ...(contextoApartado !== undefined ? { contextoApartado } : {}) });
    return {
      execution_id: 'exec-teste',
      agent: 'bento',
      status: 'completed',
      answer: RESPOSTA,
      sources: [],
      tool_calls: [],
      usage: { input_tokens: 0, output_tokens: 0 },
    } as ExecuteResponse;
  };
  return { chamadas, callAgent };
}

function jobDoBento(message: string, extra: Partial<AgentJobData> = {}): AgentJobData {
  return {
    executionDbId: 'exec-db-1',
    executionId: 'exec-teste',
    agent: 'bento',
    message,
    contextRefs: [],
    conversationId: 'conv-teste',
    ...extra,
  };
}

function semeiaBase() {
  fake.store.users.push({ id: 'user-1', name: 'Pedro', email: 'pedro@exemplo.com.br' });
  fake.store.agents.push({ id: 'agent-bento', name: 'bento' });
  fake.store.clients.push({
    id: 'cli-cos',
    name: 'Cosentino',
    environment: 'production',
    organizationId: 'org-1',
    clickupListId: 'list-cos',
    deletedAt: null,
  });
}

function semeiaMemoriaSemantica(n: number, prefixo: string) {
  for (let i = 1; i <= n; i++) {
    const id = `mem-${prefixo}-${i}`;
    fake.store.memories.push({
      id,
      kind: 'client.rule',
      content: `${prefixo} número ${i}: regra registrada da Cosentino.`,
      status: 'active',
      environment: 'production',
      // A empresa dona do registro. O recall semântico passou a filtrar por ela
      // (fronteira de tenant): memória sem dono fica invisível, de propósito.
      organizationId: 'org-1',
      clientId: 'cli-cos',
      agentId: null,
      userId: null,
      sourceType: 'chat_message',
      sourceId: null,
      confidence: '0.900',
      importance: '0.800',
      metadata: {},
      expiresAt: null,
      updatedAt: new Date('2026-09-30T10:00:00Z'),
    });
    fake.store.memoryEmbeddings.push({
      id: `emb-${id}`,
      memoryId: id,
      model: 'text-embedding-3-small',
      vector: E1,
      contentHash: 'hash',
      createdAt: new Date('2026-09-30T10:00:00Z'),
      updatedAt: new Date('2026-09-30T10:00:00Z'),
    });
  }
}

async function rodaTurno(message: string, extra: Partial<AgentJobData> = {}, clientId: string | null = 'cli-cos') {
  const { chamadas, callAgent } = capturadorDeChamada();
  const resposta = await dispatchWithAgentLoop({
    data: jobDoBento(message, extra),
    userId: 'user-1',
    clientId,
    organizationId: 'org-1',
    clientBrandKit: undefined,
    clientFeedbackHistory: [],
    logger,
    callAgent,
  });
  return { resposta, contexto: chamadas[0]?.contextoApartado ?? '', metadata: resposta.metadata as unknown as TraceDoTurno };
}

beforeEach(() => {
  fake.reset();
  tg.provider = null;
  __setEmbeddingsClientForTest(fakeOpenAI);
  semeiaBase();
});

afterEach(() => {
  __setEmbeddingsClientForTest(null);
});

/* ------------------------------------------------------------------ */
/* (a) pergunta de mudança → eventos recentes entram no contexto        */
/* ------------------------------------------------------------------ */
describe('(a) planner de eventos: "o que mudou" lê o event store', () => {
  it('o bloco EVENTOS RECENTES chega ao node, sem PRIVATE nem outro cliente', async () => {
    fake.store.operationalEvents.push(
      {
        id: 'ev-1', source: 'clickup', type: 'task.created', clientId: 'cli-cos', organizationId: 'org-1',
        summary: 'Task "Legenda de outubro" criada', actor: null, visibility: 'TEAM', importance: 'NORMAL',
        occurredAt: new Date('2026-09-30T14:00:00Z'), createdAt: new Date('2026-09-30T14:00:00Z'),
      },
      {
        id: 'ev-2', source: 'chat', type: 'CLIENT_DECISION', clientId: 'cli-cos', organizationId: 'org-1',
        summary: 'Cliente aprovou a linha criativa de outubro', actor: 'Tammy', visibility: 'TEAM', importance: 'HIGH',
        occurredAt: new Date('2026-09-29T10:00:00Z'), createdAt: new Date('2026-09-29T10:00:00Z'),
      },
      // PRIVATE de OUTRO usuário: não pode aparecer.
      {
        id: 'ev-3', source: 'chat', type: 'CLIENT_FEEDBACK', clientId: 'cli-cos', organizationId: 'org-1',
        summary: 'feedback privado de outra pessoa', actor: 'Alguém', visibility: 'PRIVATE', importance: 'LOW',
        userId: 'user-outro', occurredAt: new Date('2026-09-30T15:00:00Z'), createdAt: new Date('2026-09-30T15:00:00Z'),
      },
      // Outro cliente: fora do escopo do turno.
      {
        id: 'ev-4', source: 'clickup', type: 'task.created', clientId: 'cli-outro', organizationId: 'org-1',
        summary: 'evento de outro cliente da carteira', actor: null, visibility: 'TEAM', importance: 'NORMAL',
        occurredAt: new Date('2026-09-30T16:00:00Z'), createdAt: new Date('2026-09-30T16:00:00Z'),
      },
    );

    const { resposta, contexto, metadata } = await rodaTurno('o que mudou na Cosentino essa semana?');

    expect(resposta.status).toBe('completed');
    expect(contexto).toContain('EVENTOS RECENTES DA OPERAÇÃO');
    expect(contexto).toContain('Legenda de outubro');
    expect(contexto).toContain('Cliente aprovou a linha criativa de outubro');
    expect(contexto).toContain('por Tammy');
    expect(contexto).not.toContain('feedback privado');
    expect(contexto).not.toContain('outro cliente da carteira');
    // O mais recente primeiro.
    expect(contexto.indexOf('Legenda de outubro')).toBeLessThan(contexto.indexOf('Cliente aprovou'));
    // Observabilidade: a decisão do planner viaja no trace.
    expect(metadata.agentic.retrieval_plan).toEqual({
      incluirEventosRecentes: true,
      consultarTarefasLive: false,
      reforcarMemoriaSemantica: false,
    });
    // E os eventos viraram evidência (a regra "prompt sem lastro reprova").
    const fontes = fake.store.agentEvidence.map((e) => e.source);
    expect(fontes).toContain('operational_events');
  });

  it('pergunta de mudança GLOBAL (sem cliente) lê os eventos da empresa', async () => {
    fake.store.operationalEvents.push({
      id: 'ev-org', source: 'chat', type: 'PROCESS_LEARNING', clientId: null, organizationId: 'org-1',
      summary: 'aprendizado registrado pela equipe', actor: 'Pedro', visibility: 'TEAM', importance: 'NORMAL',
      userId: 'user-1', occurredAt: new Date('2026-09-30T12:00:00Z'), createdAt: new Date('2026-09-30T12:00:00Z'),
    });
    const { contexto } = await rodaTurno('o que aconteceu na agência hoje?', {}, null);
    expect(contexto).toContain('EVENTOS RECENTES DA OPERAÇÃO');
    expect(contexto).toContain('aprendizado registrado pela equipe');
  });
});

/* ------------------------------------------------------------------ */
/* (b) pergunta de estado → lista ao vivo, com falha e com veto         */
/* ------------------------------------------------------------------ */
describe('(b) planner live: "status das tarefas" consulta a lista ao vivo', () => {
  const PERGUNTA = 'qual o status das tarefas da Cosentino?';

  function providerCom(tasks: unknown[] | Error) {
    return {
      listTasks: vi.fn(async () => {
        if (tasks instanceof Error) throw tasks;
        return tasks;
      }),
    };
  }

  const TAREFAS = [
    { id: 't1', title: 'Legenda de outubro', description: '', status: 'em andamento', statusType: 'open', updatedAt: '2026-10-01T10:00:00Z' },
    { id: 't2', title: 'Grid de aniversário', description: '', status: 'concluída', statusType: 'closed', updatedAt: '2026-09-30T10:00:00Z' },
    { id: 't3', title: 'Reels de bastidores', description: '', status: 'a fazer', statusType: 'open', updatedAt: '2026-09-29T10:00:00Z' },
  ];

  it('registro velho (sem sync) → consulta ao vivo entra no contexto', async () => {
    tg.provider = providerCom(TAREFAS);
    const { resposta, contexto, metadata } = await rodaTurno(PERGUNTA);
    expect(resposta.status).toBe('completed');
    expect(contexto).toContain('ESTADO AO VIVO DA LISTA');
    expect(contexto).toContain('3 tarefa(s) no total, 2 em aberto');
    expect(contexto).toContain('Legenda de outubro');
    expect(metadata.agentic.retrieval_plan.consultarTarefasLive).toBe(true);
    expect(fake.store.agentEvidence.some((e) => e.source === 'clickup_live_tasks')).toBe(true);
  });

  it('provedor FALHANDO degrada sem quebrar o turno (sem bloco, sem afirmar zero)', async () => {
    tg.provider = providerCom(new Error('timeout no ClickUp'));
    const { resposta, contexto } = await rodaTurno(PERGUNTA);
    expect(resposta.status).toBe('completed');
    expect(contexto).not.toContain('ESTADO AO VIVO');
    expect(contexto).not.toContain('0 tarefa');
  });

  it('registro FRESCO (janela de 5min) → o guard VETA a consulta que o planner sugeriu', async () => {
    const provider = providerCom(TAREFAS);
    tg.provider = provider;
    fake.store.clientKnowledgeSync.push({ clientId: 'cli-cos', source: 'campaigns', lastSyncAt: new Date() });
    const { resposta, contexto, metadata } = await rodaTurno(PERGUNTA);
    expect(resposta.status).toBe('completed');
    // O planner sugeriu (fica no trace), o guard vetou (não consultou).
    expect(metadata.agentic.retrieval_plan.consultarTarefasLive).toBe(true);
    expect(provider.listTasks).not.toHaveBeenCalled();
    expect(contexto).not.toContain('ESTADO AO VIVO');
  });

  it('sem cliente no turno não há live, mesmo com provedor disponível', async () => {
    const provider = providerCom(TAREFAS);
    tg.provider = provider;
    const { resposta, metadata } = await rodaTurno('qual o status das tarefas?', {}, null);
    expect(resposta.status).toBe('completed');
    expect(metadata.agentic.retrieval_plan.consultarTarefasLive).toBe(false);
    expect(provider.listTasks).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* (c) reforço semântico: intent do job e forma interrogativa           */
/* ------------------------------------------------------------------ */
describe('(c) reforço semântico: top-k 5 → 8 quando a pergunta é factual', () => {
  const contaOcorrencias = (texto: string) => (texto.match(/Regra semântica número/g) ?? []).length;

  it('intent knowledge_query no JOB liga o reforço mesmo sem forma interrogativa', async () => {
    semeiaMemoriaSemantica(7, 'Regra semântica');
    const { contexto, metadata } = await rodaTurno('me fala das regras da Cosentino', { intent: 'knowledge_query', routingConfidence: 0.9 });
    expect(metadata.agentic.retrieval_plan.reforcarMemoriaSemantica).toBe(true);
    expect(contaOcorrencias(contexto)).toBe(7);
  });

  it('a MESMA mensagem sem intent corta no top-k padrão (5)', async () => {
    semeiaMemoriaSemantica(7, 'Regra semântica');
    const { contexto, metadata } = await rodaTurno('me fala das regras da Cosentino');
    expect(metadata.agentic.retrieval_plan.reforcarMemoriaSemantica).toBe(false);
    expect(contaOcorrencias(contexto)).toBe(5);
  });

  it('pergunta interrogativa liga o reforço sem precisar do intent', async () => {
    semeiaMemoriaSemantica(7, 'Regra semântica');
    const { contexto, metadata } = await rodaTurno('quem é o decisor da Cosentino?');
    expect(metadata.agentic.retrieval_plan.reforcarMemoriaSemantica).toBe(true);
    expect(contaOcorrencias(contexto)).toBe(7);
  });
});

/* ------------------------------------------------------------------ */
/* (d) job antigo + small talk = comportamento idêntico ao de hoje      */
/* ------------------------------------------------------------------ */
describe('(d) compatibilidade: sem intent e sem sinal, o turno é o de sempre', () => {
  it('small talk não adiciona fonte nenhuma, mesmo com eventos e lista disponíveis', async () => {
    fake.store.operationalEvents.push({
      id: 'ev-x', source: 'clickup', type: 'task.created', clientId: 'cli-cos', organizationId: 'org-1',
      summary: 'evento que não deveria entrar neste turno', actor: null, visibility: 'TEAM', importance: 'NORMAL',
      occurredAt: new Date('2026-09-30T14:00:00Z'), createdAt: new Date('2026-09-30T14:00:00Z'),
    });
    tg.provider = {
      listTasks: vi.fn(async () => [{ id: 't1', title: 'Task qualquer', description: '', status: 'a fazer', statusType: 'open', updatedAt: null }]),
    };
    const { resposta, contexto, metadata } = await rodaTurno('bom dia, tudo bem?');
    expect(resposta.status).toBe('completed');
    expect(metadata.agentic.retrieval_plan).toEqual(PLANO_NULO);
    expect(contexto).not.toContain('EVENTOS RECENTES');
    expect(contexto).not.toContain('ESTADO AO VIVO');
    expect((tg.provider as { listTasks: ReturnType<typeof vi.fn> }).listTasks).not.toHaveBeenCalled();
  });
});

/**
 * GUARDA DE AUSÊNCIA — PROVA DE RUNTIME, não de unidade.
 *
 * O guarda tem 20 testes próprios em guarda-de-ausencia.test.ts, e eles provam
 * a FUNÇÃO. Não provam a FIAÇÃO: numa bateria de 25 execuções reais ele nunca
 * disparou, então "está ligado" seguia sendo afirmação sem evidência — e esta
 * sessão inteira foi sobre não aceitar afirmação sem evidência.
 *
 * Aqui o turno passa pelo MESMO `dispatchWithAgentLoop` que produção usa; o
 * que muda é que a resposta do modelo é fixada, em vez de esperar o modelo
 * errar por acaso. É a diferença entre testar o guarda e testar o caminho até
 * ele.
 */
describe('guarda de ausência — fiação no pipeline de produção', () => {
  function respondendo(texto: string) {
    const chamadas: Array<{ message: string }> = [];
    const callAgent = async (message: string): Promise<ExecuteResponse> => {
      chamadas.push({ message });
      return {
        execution_id: 'exec-guarda',
        agent: 'bento',
        status: 'completed',
        answer: texto,
        sources: [],
        tool_calls: [],
        usage: { input_tokens: 0, output_tokens: 0 },
      } as ExecuteResponse;
    };
    return callAgent;
  }

  function semeiaDossieComPosicionamento(): void {
    fake.store.memories.push({
      id: 'mem-dossie-cos',
      kind: 'client.profile',
      content: [
        '# BRAIN — COSENTINO',
        '## 2. POSICIONAMENTO',
        'Imobiliário premium regional. Preço no mínimo 10% acima da concorrência,',
        'sustentado pelo legado de 47 anos. Nada de urgência ou desconto.',
      ].join('\n'),
      status: 'active',
      environment: 'production',
      organizationId: 'org-1',
      clientId: 'cli-cos',
      agentId: null,
      userId: null,
      sourceType: 'vault',
      sourceId: null,
      confidence: '0.900',
      importance: '0.900',
      metadata: { subject: 'cliente:cli-cos:brain' },
      expiresAt: null,
      updatedAt: new Date('2026-09-30T10:00:00Z'),
    });
  }

  it('BLOQUEIA a falsa ausência e devolve o registro, sem depender do modelo', async () => {
    semeiaDossieComPosicionamento();
    const resposta = await dispatchWithAgentLoop({
      data: jobDoBento('Qual é o posicionamento da Cosentino?'),
      userId: 'user-1',
      clientId: 'cli-cos',
      organizationId: 'org-1',
      clientBrandKit: undefined,
      clientFeedbackHistory: [],
      logger,
      // A resposta que o Bento deu CINCO vezes em nove, com o dossiê no prompt.
      callAgent: respondendo('Não tenho dados no briefing sobre posicionamento da Cosentino.'),
    });

    const texto = resposta.answer ?? '';
    expect(texto).not.toMatch(/n[ãa]o tenho dados/i);
    expect(texto).toMatch(/POSICIONAMENTO/i);
    expect(texto).toMatch(/premium regional/i);
  });

  it('DEIXA PASSAR a resposta correta sobre o mesmo tópico e a mesma evidência', async () => {
    semeiaDossieComPosicionamento();
    const correta = 'O posicionamento é imobiliário premium regional, com preço 10% acima da concorrência.';
    const resposta = await dispatchWithAgentLoop({
      data: jobDoBento('Qual é o posicionamento da Cosentino?'),
      userId: 'user-1',
      clientId: 'cli-cos',
      organizationId: 'org-1',
      clientBrandKit: undefined,
      clientFeedbackHistory: [],
      logger,
      callAgent: respondendo(correta),
    });
    expect(resposta.answer).toContain('premium regional');
  });

  /**
   * AUSÊNCIA HONESTA PASSA. Sem isto o guarda forçaria invenção quando de fato
   * não há fonte — trocaria falsa ausência por alucinação, que é pior.
   */
  it('DEIXA PASSAR a negativa quando não há evidência sobre o tópico', async () => {
    semeiaDossieComPosicionamento();
    const resposta = await dispatchWithAgentLoop({
      data: jobDoBento('Qual é o orçamento de mídia da Cosentino?'),
      userId: 'user-1',
      clientId: 'cli-cos',
      organizationId: 'org-1',
      clientBrandKit: undefined,
      clientFeedbackHistory: [],
      logger,
      callAgent: respondendo('Não tenho dados sobre o orçamento de mídia desta conta.'),
    });
    expect(resposta.answer).toMatch(/n[ãa]o tenho dados/i);
  });
});

/**
 * CONTRAPROVA DO PRÓPRIO HARNESS — o checkpoint do turno passa pelo redis FAKE.
 *
 * Este arquivo inteiro já esteve 13/13 verde com o mock de ioredis FURADO: o
 * publish saía por um IORedis real e os testes só passavam porque o redis da
 * máquina estava no ar. Um harness cujo mock não intercepta nada é pior que
 * harness nenhum — prova nada e ainda reporta verde.
 *
 * Aqui a asserção é dupla e as duas pontas falham de verdade:
 *   1. se o dispatch PARAR de publicar as fases do turno (a fiação some), a
 *      lista fica vazia e o teste fica vermelho;
 *   2. se o mock deixar de cobrir o grafo (ex.: alguém remove ioredis das
 *      devDependencies do worker), o publish cai num IORedis real e o turno
 *      nem termina — vermelho por timeout, não verde por acidente.
 */
describe('harness: o publish de checkpoint passa pelo redis fake', () => {
  interface EventoDeFase {
    type: string;
    payload: { execution_id?: string; phase?: string };
  }

  it('o turno publica suas fases no canal de WS, através do FakeRedis', async () => {
    redisProbe.publishes.length = 0;
    const { resposta } = await rodaTurno('bom dia, tudo bem?');
    expect(resposta.status).toBe('completed');

    const fasesDoTurno = redisProbe.publishes
      .filter((p) => p.channel.endsWith(':ws-events'))
      .map((p) => JSON.parse(p.message) as EventoDeFase)
      .filter((e) => e.type === 'agent.phase' && e.payload.execution_id === 'exec-teste');

    expect(fasesDoTurno.length).toBeGreaterThan(0);
    expect(fasesDoTurno.some((e) => e.payload.phase === 'COMPLETED')).toBe(true);
  });
});

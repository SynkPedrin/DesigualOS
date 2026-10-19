import { beforeEach, describe, expect, it, vi } from 'vitest';
import { montarPrincipal, type AtorDoPrincipal, type McpEventType } from '@desigual-os/mcp-domain';

/**
 * promocao-de-conhecimento.test.ts — evento rico vira memória (Entrega 2).
 *
 * O padrão de mock é o consolidado do repo (bento-memory-trace.test.ts):
 * drizzle-orm vira descritores de condição e @desigual-os/database vira um
 * bancinho em memória com a semântica que os caminhos sob teste usam — eq,
 * ilike, isNull, and/or, o IS DISTINCT FROM da visibilidade e o conflito de
 * (source, external_id) / dedupe_key.
 *
 * ZERO OpenAI: a promoção escreve direto (mesmo padrão de save_client_feedback)
 * e este app nem declara @desigual-os/openai-provider como dependência — se
 * qualquer caminho tentasse gerar embedding, este arquivo quebrava na
 * resolução do módulo, não numa asserção. O architecture.test.ts trava isso
 * estaticamente para todo arquivo não-teste do app.
 */

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
    ilike: bin('ilike'),
    isNull: un('isNull'),
    and: (...conditions: Array<Cond | undefined>): Cond => ({ op: 'and', conditions: conditions.filter(Boolean) as Cond[] }),
    or: (...conditions: Array<Cond | undefined>): Cond => ({ op: 'or', conditions: conditions.filter(Boolean) as Cond[] }),
    desc: (column: unknown): Cond => ({ op: 'desc', column: String(column) }),
    sql: Object.assign(sqlTag, { raw: (s: string): Cond => ({ op: 'sql', strings: [s], values: [] }) }),
  };
});

vi.mock('../audit.js', () => ({ registrarAuditoria: vi.fn(async () => undefined) }));

type Row = Record<string, unknown> & { metadata?: Record<string, unknown> };

const fake = vi.hoisted(() => {
  type R = Record<string, unknown> & { metadata?: Record<string, unknown> };
  /** Callbacks de thenable fake: quem consome é sempre `await`, nunca `.then` direto. */
  type OnOk = ((v: unknown) => unknown) | undefined;
  type OnErr = ((e: unknown) => unknown) | undefined;
  const store = {
    memories: [] as R[],
    operationalEvents: [] as R[],
    clients: [{ id: 'cliente-1', name: 'Cliente Um', clickupListId: null, organizationId: 'org1', deletedAt: null }] as R[],
  };
  const rowsOf = (key: string): R[] => (store as Record<string, R[]>)[key]!;
  let seq = 0;

  const colName = (c?: string): string => (c ? c.split('.').pop()! : '');

  function evalSql(row: R, cond: Cond): boolean {
    const text = (cond.strings ?? []).join('');
    // visibilidade-de-memoria.ts — anotação privada de outra pessoa não sai.
    if (text.includes("IS DISTINCT FROM 'USER_PRIVATE'")) return row.metadata?.mcp_scope !== 'USER_PRIVATE';
    return true;
  }

  function evalCond(row: R, cond: Cond): boolean {
    switch (cond.op) {
      case 'eq': return row[colName(cond.column)] === cond.value;
      case 'ilike': {
        const termo = String(cond.value).replace(/^%|%$/g, '');
        return String(row[colName(cond.column)] ?? '').toLowerCase().includes(termo.toLowerCase());
      }
      case 'isNull': return row[colName(cond.column)] === null || row[colName(cond.column)] === undefined;
      case 'and': return (cond.conditions ?? []).every((c) => evalCond(row, c));
      case 'or': return (cond.conditions ?? []).some((c) => evalCond(row, c));
      case 'sql': return evalSql(row, cond);
      default: return true;
    }
  }

  function chainable(compute: () => R[]) {
    let cached: R[] | null = null;
    const get = () => (cached ??= compute());
    return {
      then: (res?: OnOk, rej?: OnErr) => Promise.resolve().then(get).then(res, rej),
      catch: (rej?: OnErr) => Promise.resolve().then(get).catch(rej),
      orderBy: (..._descs: Cond[]) => chainable(() => get()),
      limit: (n: number) => Promise.resolve().then(() => get().slice(0, n)),
    };
  }

  const tableKey = (table: { __table: string }): string => table.__table;

  /**
   * Idempotência fiel à tabela real: operational_events é único por
   * (source, external_id); memories é único por dedupe_key. Conflito = [].
   */
  function conflita(key: string, v: R): boolean {
    if (key === 'operationalEvents') {
      return Boolean(v.externalId) && rowsOf(key).some((r) => r.source === v.source && r.externalId === v.externalId);
    }
    if (key === 'memories') {
      return Boolean(v.dedupeKey) && rowsOf(key).some((r) => r.dedupeKey === v.dedupeKey);
    }
    return false;
  }

  const db = {
    select: (_cols?: unknown) => ({
      from: (table: { __table: string }) => ({
        where: (cond: Cond) => chainable(() => rowsOf(tableKey(table)).filter((r) => evalCond(r, cond))),
      }),
    }),
    insert: (table: { __table: string }) => ({
      values: (v: R) => {
        const key = tableKey(table);
        const doInsert = (respeitarConflito: boolean) => () => {
          if (respeitarConflito && conflita(key, v)) return [];
          const row = { ...v, id: v.id ?? `${key}-${++seq}` };
          rowsOf(key).push(row);
          return [{ id: row.id }];
        };
        return {
          // telemetria.ts e os inserts sem .returning() caem aqui.
          then: (res?: OnOk, rej?: OnErr) => Promise.resolve().then(doInsert(false)).then(res, rej),
          returning: (_cols?: unknown) => Promise.resolve().then(doInsert(false)),
          onConflictDoNothing: () => ({
            then: (res?: OnOk, rej?: OnErr) => Promise.resolve().then(doInsert(true)).then(res, rej),
            returning: (_cols?: unknown) => Promise.resolve().then(doInsert(true)),
          }),
        };
      },
    }),
    update: (table: { __table: string }) => ({
      set: (patch: R) => ({
        where: (cond: Cond) => {
          const apply = () => {
            const matched = rowsOf(tableKey(table)).filter((r) => evalCond(r, cond));
            for (const r of matched) Object.assign(r, patch);
            return matched.map((r) => ({ id: r.id }));
          };
          return {
            then: (res?: OnOk, rej?: OnErr) => Promise.resolve().then(apply).then(res, rej),
            returning: (_cols?: unknown) => Promise.resolve().then(apply),
          };
        },
      }),
    }),
  };

  function reset(): void {
    store.memories.length = 0;
    store.operationalEvents.length = 0;
    seq = 0;
  }

  return { store, db, reset };
});

vi.mock('@desigual-os/database', () => {
  const table = (name: string, fields: string[]) =>
    Object.fromEntries([['__table', name], ...fields.map((f) => [f, `${name}.${f}`])]) as Record<string, string>;
  const schema = {
    memories: table('memories', [
      'id', 'kind', 'content', 'status', 'confidence', 'importance', 'clientId', 'userId', 'organizationId',
      'sourceType', 'metadata', 'updatedAt', 'dedupeKey', 'expiresAt', 'lastVerifiedAt', 'environment',
    ]),
    operationalEvents: table('operationalEvents', [
      'id', 'source', 'type', 'externalId', 'organizationId', 'userId', 'employeeId', 'clientId', 'taskId',
      'entityType', 'entityId', 'actor', 'summary', 'importance', 'visibility', 'payload', 'occurredAt', 'processedAt',
    ]),
    clients: table('clients', ['id', 'name', 'clickupListId', 'organizationId', 'deletedAt']),
  };
  return { db: fake.db, schema };
});

import { registrarToolsDeMemoriaEEventos } from './memory-events';
import type { ContextoDaTool } from './kit';

function servidorFalso() {
  const registradas = new Map<string, { handler: (args: Record<string, unknown>) => Promise<unknown> }>();
  return {
    registradas,
    registerTool: (nome: string, _config: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => {
      registradas.set(nome, { handler });
    },
  };
}

function loggerFalso() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

let seqReq = 0;
function contexto(logger: ReturnType<typeof loggerFalso>, ator: AtorDoPrincipal | null = null): ContextoDaTool {
  return {
    principal: montarPrincipal(
      { userId: 'u1', organizationId: 'org1', employeeId: 'e1', email: 'a@b.com', name: 'Alguém', role: 'MANAGER' },
      ['memory.read', 'memory.write', 'desigual.read'],
      'sessao-1',
      { organizationIds: ['org1'], ehProvider: false },
      ator,
    ),
    providers: {} as never,
    logger: logger as never,
    // requestId único por chamada, como na vida real — senão a telemetria
    // (externalId = mcp:tool:<requestId>) deduparia as chamadas do teste.
    requestId: `req-${++seqReq}`,
  };
}

function montar(logger: ReturnType<typeof loggerFalso>, ator: AtorDoPrincipal | null = null) {
  const server = servidorFalso();
  registrarToolsDeMemoriaEEventos({ server: server as never, contextoDaChamada: () => contexto(logger, ator) });
  // O kit embrulha toda resposta no envelope JSON ({ content: [{ text }] }) —
  // quem chama a tool de verdade recebe isso, então o teste desembrulha aqui.
  return (nome: string) => {
    const handler = server.registradas.get(nome)!.handler;
    return async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const resposta = (await handler(args)) as { content: Array<{ text: string }> };
      return JSON.parse(resposta.content[0]!.text);
    };
  };
}

async function flushTelemetria(): Promise<void> {
  // Telemetria é fire-and-forget (`void` no kit); a promoção, em contraste, é
  // awaitada dentro da tool — quando o handler resolve, a memória já existe.
  await vi.waitFor(() => {
    /* drena microtasks até a telemetria assentar */
    if (!fake.store.operationalEvents.some((e) => e.type === 'MCP_TOOL_CALLED')) throw new Error('ainda não');
  }).catch(() => undefined);
}

const SUMARIO_DECISAO = 'Cliente aprovou o novo tom de voz da campanha de verão, sem mais ajustes.';

beforeEach(() => {
  fake.reset();
});

describe('log_operational_event — promoção de tipo rico para memória', () => {
  it('CLIENT_DECISION grava o evento E a memória client.decision, com ator/org/confiança e link de volta', async () => {
    const chamar = montar(loggerFalso());
    const resposta = (await chamar('log_operational_event')({
      event_type: 'CLIENT_DECISION', summary: SUMARIO_DECISAO, client_id: 'cliente-1',
    })) as Record<string, unknown>;

    expect(resposta.status).toBe('RECORDED');
    expect(resposta.promoted_to_memory).toBe(true);

    // O evento continua gravado como antes — nada do comportamento atual muda.
    const evento = fake.store.operationalEvents.find((e) => e.type === 'CLIENT_DECISION');
    expect(evento).toBeDefined();
    expect(evento!.processedAt).toBeUndefined(); // segue sinal proativo

    const memoria = fake.store.memories.find((m) => m.kind === 'client.decision');
    expect(memoria).toBeDefined();
    expect(memoria!.content).toBe(SUMARIO_DECISAO);
    expect(memoria!.organizationId).toBe('org1');
    expect(memoria!.clientId).toBe('cliente-1');
    expect(memoria!.userId).toBe('u1');
    expect(memoria!.sourceType).toBe('claude');
    expect(Number(memoria!.confidence)).toBeCloseTo(0.5, 3);
    expect(memoria!.status).toBe('active');
    // Filtros de produção do recallMemories: status active, sem expiresAt,
    // environment ausente (= default 'production' da coluna). É o contrato
    // que faz a memória promovida ser encontrada pela leitura do Bento.
    expect(memoria!.expiresAt).toBeUndefined();
    expect(memoria!.environment).toBeUndefined();
    // O link de volta à procedência.
    expect(memoria!.metadata!.event_id).toBe(evento!.id);
    expect(memoria!.metadata!.event_type).toBe('CLIENT_DECISION');
    expect(memoria!.metadata!.source_refs).toEqual([`operational_events:${evento!.id}`]);
    expect(memoria!.metadata!.mcp_status).toBe('OBSERVED');
    expect(memoria!.dedupeKey).toBeTruthy();
  });

  it('tipo operacional puro (TASK_CREATED) grava SÓ o evento — nenhuma memória', async () => {
    const chamar = montar(loggerFalso());
    const resposta = (await chamar('log_operational_event')({
      event_type: 'TASK_CREATED', summary: 'Task de revisão do criativo de outubro criada no ClickUp.', task_id: 'task-1',
    })) as Record<string, unknown>;

    expect(resposta.status).toBe('RECORDED');
    expect(resposta.promoted_to_memory).toBeUndefined();
    expect(fake.store.operationalEvents.some((e) => e.type === 'TASK_CREATED')).toBe(true);
    expect(fake.store.memories).toHaveLength(0);
  });

  it('o MESMO fato registrado de novo reconfirma a memória em vez de duplicá-la', async () => {
    const chamar = montar(loggerFalso());
    const args = { event_type: 'CLIENT_DECISION' as McpEventType, summary: SUMARIO_DECISAO, client_id: 'cliente-1' };
    await chamar('log_operational_event')({ ...args, idempotency_key: 'k1' });
    await chamar('log_operational_event')({ ...args, idempotency_key: 'k2' });

    const memorias = fake.store.memories.filter((m) => m.kind === 'client.decision');
    expect(memorias).toHaveLength(1);
    expect(memorias[0]!.lastVerifiedAt).toBeInstanceOf(Date);
    expect(fake.store.operationalEvents.filter((e) => e.type === 'CLIENT_DECISION')).toHaveLength(2);
  });

  it('telemetria e evento de negócio COEXISTEM na mesma chamada — camadas diferentes', async () => {
    const logger = loggerFalso();
    const chamar = montar(logger);
    await chamar('log_operational_event')({ event_type: 'CLIENT_DECISION', summary: SUMARIO_DECISAO, client_id: 'cliente-1' });
    await flushTelemetria();

    const tipos = fake.store.operationalEvents.map((e) => e.type);
    expect(tipos).toContain('CLIENT_DECISION'); // o que mudou
    expect(tipos).toContain('MCP_TOOL_CALLED'); // que a tool foi chamada
    const telemetria = fake.store.operationalEvents.find((e) => e.type === 'MCP_TOOL_CALLED')!;
    expect(telemetria.processedAt).toBeInstanceOf(Date); // telemetria nunca é sinal proativo
    expect((telemetria.payload as Row).resultado).toBe('ok');
  });
});

describe('save_learning — agora grava memória E evento (simetria com save_client_feedback)', () => {
  it('aprendizado vira process.learning e PROCESS_LEARNING com link para a memória', async () => {
    const chamar = montar(loggerFalso());
    const resposta = (await chamar('save_learning')({
      learning: 'Reunião de kickoff sem o comercial presente sempre gera retrabalho de briefing.', client_id: 'cliente-1',
    })) as Record<string, unknown>;

    expect(resposta.status).toBe('SAVED');
    const memoria = fake.store.memories.find((m) => m.kind === 'process.learning');
    expect(memoria).toBeDefined();
    const evento = fake.store.operationalEvents.find((e) => e.type === 'PROCESS_LEARNING');
    expect(evento).toBeDefined();
    expect(evento!.entityId).toBe(memoria!.id);
    expect(evento!.externalId).toBe(`mcp:learning:${memoria!.id}`);
    expect(evento!.processedAt).toBeUndefined(); // vira sinal proativo, como o feedback
  });
});

describe('prova ponta a ponta — o que se grava, a leitura encontra', () => {
  it('feedback salvo via save_client_feedback é encontrado por search_memory (a leitura do MCP)', async () => {
    const chamar = montar(loggerFalso());
    const feedback = 'Não querem mais comunicação promocional agressiva nos criativos de fim de ano.';
    const salvo = (await chamar('save_client_feedback')({ client_id: 'cliente-1', feedback })) as Record<string, unknown>;
    expect(salvo.status).toBe('SAVED');

    const busca = (await chamar('search_memory')({ query: 'promocional agressiva', client_id: 'cliente-1' })) as {
      results: Array<{ kind: string; content: string; status: string }>;
      count: number;
    };
    expect(busca.count).toBeGreaterThanOrEqual(1);
    const achado = busca.results.find((r) => r.content.includes('promocional agressiva'));
    expect(achado).toBeDefined();
    expect(achado!.kind).toBe('client.feedback');
    expect(achado!.status).toBe('OBSERVED'); // relato não confirmado, com ressalva — §11
  });

  it('decisão promovida de log_operational_event também é encontrada por search_memory', async () => {
    const chamar = montar(loggerFalso());
    await chamar('log_operational_event')({ event_type: 'CLIENT_DECISION', summary: SUMARIO_DECISAO, client_id: 'cliente-1' });

    const busca = (await chamar('search_memory')({ query: 'tom de voz', client_id: 'cliente-1' })) as {
      results: Array<{ kind: string }>;
    };
    expect(busca.results.some((r) => r.kind === 'client.decision')).toBe(true);
  });
});

/**
 * AUTORIA — quem AGE × quem autorizou (credencial de conexão).
 *
 * O bug que estes testes trancam: `recorded_by: principal.name` gravava o nome
 * do dono do LOGIN. Com credencial de conta compartilhada, o conhecimento da
 * Equipe Atendimento saía atribuído ao master — autoria errada, pior que
 * ausente. A regra inegociável: shared_account NUNCA grava nome de pessoa.
 */
const ATOR_COMPARTILHADO: AtorDoPrincipal = {
  identityId: 'ident-atendimento',
  displayName: 'Equipe Atendimento',
  actorType: 'shared_account',
  personId: null,
};
const ATOR_PESSOA: AtorDoPrincipal = {
  identityId: 'ident-pedro-claude',
  displayName: 'Pedro Claude',
  actorType: 'person',
  personId: 'pessoa-pedro',
};

describe('autoria — save_client_feedback com identidade operacional', () => {
  it('conta compartilhada: memória E evento saem em nome da EQUIPE, sem nome de pessoa em lugar nenhum', async () => {
    const chamar = montar(loggerFalso(), ATOR_COMPARTILHADO);
    await chamar('save_client_feedback')({
      client_id: 'cliente-1',
      feedback: 'Não querem mais comunicação promocional agressiva nos criativos de fim de ano.',
    });

    const memoria = fake.store.memories.find((m) => m.kind === 'client.feedback')!;
    expect(memoria.metadata!.recorded_by).toBe('Equipe Atendimento');
    expect(memoria.metadata!.actor_identity_id).toBe('ident-atendimento');
    expect(memoria.metadata!.actor_type).toBe('shared_account');
    expect(memoria.metadata!.authorized_by).toBe('Alguém'); // quem autorizou continua visível
    // A REGRA: nenhum nome de pessoa — nem o do master como AUTOR do registro.
    expect(memoria.metadata!.recorded_by).not.toBe('Alguém');

    const evento = fake.store.operationalEvents.find((e) => e.type === 'CLIENT_FEEDBACK')!;
    expect(evento.actor).toBe('Equipe Atendimento');
    const payload = evento.payload as Row;
    expect(payload.actor_identity_id).toBe('ident-atendimento');
    expect(payload.actor).toBe('Equipe Atendimento');
    expect(payload.actor_type).toBe('shared_account');
    expect(payload.authorized_by_user_id).toBe('u1');
  });

  it('identidade person: recorded_by é o nome da IDENTIDADE ("Pedro Claude"), não o do login', async () => {
    const chamar = montar(loggerFalso(), ATOR_PESSOA);
    await chamar('save_client_feedback')({
      client_id: 'cliente-1',
      feedback: 'Preferem reuniões curtas na sexta-feira pela manhã, sempre com pauta.',
    });

    const memoria = fake.store.memories.find((m) => m.kind === 'client.feedback')!;
    expect(memoria.metadata!.recorded_by).toBe('Pedro Claude');
    expect(memoria.metadata!.actor_type).toBe('person');
    expect(memoria.metadata!.actor_identity_id).toBe('ident-pedro-claude');
  });

  it('LEGADO sem ator: recorded_by é principal.name e NENHUM campo de ator aparece — comportamento atual preservado', async () => {
    const chamar = montar(loggerFalso());
    await chamar('save_client_feedback')({
      client_id: 'cliente-1',
      feedback: 'Pediram para evitar jargão técnico nas peças de fim de ano.',
    });

    const memoria = fake.store.memories.find((m) => m.kind === 'client.feedback')!;
    expect(memoria.metadata!.recorded_by).toBe('Alguém');
    expect(memoria.metadata!.actor_identity_id).toBeUndefined();
    expect(memoria.metadata!.actor_type).toBeUndefined();
    expect(memoria.metadata!.authorized_by).toBeUndefined();

    const evento = fake.store.operationalEvents.find((e) => e.type === 'CLIENT_FEEDBACK')!;
    expect(evento.actor).toBe('Alguém');
    expect(evento.payload).toEqual({});
  });
});

describe('autoria — log_operational_event e a promoção carregam a mesma identidade', () => {
  it('evento ganha ator no payload E a memória promovida sai em nome da equipe', async () => {
    const chamar = montar(loggerFalso(), ATOR_COMPARTILHADO);
    await chamar('log_operational_event')({
      event_type: 'CLIENT_DECISION', summary: SUMARIO_DECISAO, client_id: 'cliente-1',
    });

    const evento = fake.store.operationalEvents.find((e) => e.type === 'CLIENT_DECISION')!;
    expect(evento.actor).toBe('Equipe Atendimento');
    const payload = evento.payload as Row;
    expect(payload.actor_identity_id).toBe('ident-atendimento');
    expect(payload.actor_type).toBe('shared_account');
    expect(payload.authorized_by_user_id).toBe('u1');

    // A promoção (a linha que gravava o nome errado) agora grava a identidade.
    const memoria = fake.store.memories.find((m) => m.kind === 'client.decision')!;
    expect(memoria.metadata!.recorded_by).toBe('Equipe Atendimento');
    expect(memoria.metadata!.actor_type).toBe('shared_account');
    expect(memoria.metadata!.authorized_by).toBe('Alguém');
  });

  it('log_work com ator: evento em nome da identidade', async () => {
    const chamar = montar(loggerFalso(), ATOR_PESSOA);
    await chamar('log_work')({ summary: 'Finalizei os três criativos de outubro da Envu, revisados.', client_id: 'cliente-1' });

    const evento = fake.store.operationalEvents.find((e) => e.type === 'WORK_LOGGED')!;
    expect(evento.actor).toBe('Pedro Claude');
    expect((evento.payload as Row).actor_identity_id).toBe('ident-pedro-claude');
  });

  it('save_learning com conta compartilhada: aprendizado em nome da equipe, sem pessoa', async () => {
    const chamar = montar(loggerFalso(), ATOR_COMPARTILHADO);
    await chamar('save_learning')({
      learning: 'Reunião de kickoff sem o comercial presente sempre gera retrabalho de briefing.', client_id: 'cliente-1',
    });

    const memoria = fake.store.memories.find((m) => m.kind === 'process.learning')!;
    expect(memoria.metadata!.recorded_by).toBe('Equipe Atendimento');
    expect(memoria.metadata!.actor_type).toBe('shared_account');
    const evento = fake.store.operationalEvents.find((e) => e.type === 'PROCESS_LEARNING')!;
    expect(evento.actor).toBe('Equipe Atendimento');
    expect((evento.payload as Row).actor_type).toBe('shared_account');
  });
});

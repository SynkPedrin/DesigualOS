import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@desigual-os/logging';

/**
 * FASE B.12 — MAPA DE DEGRADAÇÃO DA MONTAGEM DE CONTEXTO DO OTTO.
 *
 * Executa o processSingleAgentJob REAL (caminho direto, AGENT_LOOP_V2 off — o
 * que roda em produção) com I/O mockado e derruba CADA fonte de contexto, uma
 * de cada vez, medindo o que chega ao payload do node (capturado no fetch) e
 * se algum sinal visível (logger.warn/error) é emitido.
 *
 * Hipótese sob auditoria: os fallbacks silenciosos `.catch(() => null/[])` da
 * montagem de contexto são a causa principal da copy genérica do Otto. Este
 * arquivo mede o ELO 1 da cadeia (contexto que sai do worker); o elo 2 (o que
 * o node monta com isso) é coberto pela análise estática do relatório B.12.
 */

// ---------------------------------------------------------------------------
// Estado mutável do harness (hoisted: os vi.mock abaixo são içados pro topo).
// ---------------------------------------------------------------------------
const H = vi.hoisted(() => {
  const CLIENT_ID = '11111111-1111-1111-1111-111111111111';
  const USER_ID = '22222222-2222-2222-2222-222222222222';

  const CLIENTES = [
    { id: CLIENT_ID, name: 'Acme Construtora', slug: 'acme-construtora' },
    { id: 'c2', name: 'Top Tennis Club', slug: 'top-tennis-club' },
    { id: 'c3', name: 'Colpar', slug: 'colpar' },
  ];

  const HISTORICO = [
    { role: 'assistant', agent: 'otto', content: 'A Acme Construtora atua com incorporação residencial em Birigui.' },
    { role: 'user', agent: null, content: 'Me conta o que a Acme faz.' },
  ];

  const PERFIL = [
    {
      content: 'Posicionamento: construtora familiar de Birigui. Tom de voz: direto, técnico, sem clichê de mercado imobiliário. Público: casais 30-45 buscando o primeiro apartamento.',
      metadata: { subject: `cliente:${CLIENT_ID}:brain` },
    },
    {
      content: 'Retainer mensal. Lista ClickUp 901411700001. Em campanha: aniversário de 10 anos da empresa.',
      metadata: { subject: `cliente:${CLIENT_ID}:dossie` },
    },
  ];

  const KIT = {
    clientId: CLIENT_ID,
    colors: ['#1B2A4A', '#E8B33D'],
    fonts: ['Sora', 'Inter'],
    toneOfVoice: 'direto e técnico, sem superlativos',
    logoUrl: null,
  };

  const FEEDBACKS = [
    { kind: 'otto.feedback', content: 'aprovado', metadata: { verdict: 'approved', reason: 'headline curta com número concreto' } },
    { kind: 'otto.feedback', content: 'rejeitado', metadata: { verdict: 'rejected', reason: 'usou "sonho realizado", proibido' } },
  ];

  const APRENDIZADOS = [
    { kind: 'otto.approval_reason', content: 'CTA sempre com verbo de ação', confidence: 0.9, metadata: { otto_learning: { stage: 'validated' } } },
  ];

  return {
    CLIENT_ID,
    USER_ID,
    CLIENTES,
    HISTORICO,
    PERFIL,
    KIT,
    FEEDBACKS,
    APRENDIZADOS,
    falhas: new Set<string>(),
    fetchBodies: [] as Array<Record<string, unknown>>,
    recallMemoriesImpl: null as null | ((q: { kinds?: string[] }) => Promise<unknown[]>),
  };
});

/** Assinatura estável de uma query: tabela + colunas do select + presença de where. */
interface QueryInfo {
  table: string | null;
  selectKeys: string[];
  hasWhere: boolean;
}

function fonteDaQuery(q: QueryInfo): string {
  if (q.table === 'messages' && q.selectKeys.includes('content')) return 'historico';
  if (q.table === 'memories') return 'perfil';
  if (q.table === 'clientBrandKits') return 'brandKit';
  if (q.table === 'clients' && q.hasWhere && q.selectKeys.includes('name') && q.selectKeys.includes('id')) return 'clienteNome';
  if (q.table === 'clients' && !q.hasWhere && q.selectKeys.length === 1 && q.selectKeys[0] === 'id') return 'contagemClientes';
  return q.table ?? 'desconhecida';
}

function linhasDaQuery(q: QueryInfo): unknown {
  switch (q.table) {
    case 'executions':
      // update().returning() no início e no fechamento da execução.
      return [{ id: 'exec-db-1', userId: H.USER_ID, clientId: H.CLIENT_ID, agent: 'otto', executionId: 'exec-1' }];
    case 'users':
      return [{ id: H.USER_ID, name: 'Pedro', email: 'pedro@desigual.com', clickupEmail: null, active: true, deletedAt: null }];
    case 'clients': {
      const fonte = fonteDaQuery(q);
      if (fonte === 'clienteNome') return [{ id: H.CLIENT_ID, name: 'Acme Construtora' }];
      if (fonte === 'contagemClientes') return H.CLIENTES.map((c) => ({ id: c.id }));
      if (q.selectKeys.includes('slug')) return H.CLIENTES; // resolveClientsFromText lê a carteira inteira
      if (q.selectKeys.includes('clickupListId')) return []; // lista "agencia-desigual" (guard do Bento)
      if (q.selectKeys.includes('name')) return [{ name: 'Acme Construtora' }]; // clienteDaExecucao
      return [];
    }
    case 'messages':
      return q.selectKeys.includes('content') ? H.HISTORICO : [];
    case 'memories':
      return H.PERFIL;
    case 'clientBrandKits':
      return H.falhas.has('brandKitAusente') ? [] : [H.KIT];
    case 'conversations':
      return [];
    case 'organizationMembers':
      return [];
    default:
      return [];
  }
}

function makeThenableQuery(info: QueryInfo): Promise<unknown> {
  const fonte = fonteDaQuery(info);
  if (H.falhas.has(fonte)) return Promise.reject(new Error(`falha injetada pelo teste: ${fonte}`));
  return Promise.resolve(linhasDaQuery(info));
}

function makeBuilder(info: QueryInfo): unknown {
  const builder: Record<string, unknown> = {};
  const chain = (mutate?: (...args: unknown[]) => void) => (...args: unknown[]) => {
    mutate?.(...args);
    return builder;
  };
  builder.from = chain((t?: unknown) => {
    info.table = (t as { __table?: string } | undefined)?.__table ?? String(t);
  }) as never;
  builder.where = chain(() => {
    info.hasWhere = true;
  });
  builder.orderBy = chain();
  builder.limit = chain();
  builder.set = chain();
  builder.values = chain();
  builder.returning = chain();
  builder.onConflictDoUpdate = chain();
  builder.onConflictDoNothing = chain();
  builder.groupBy = chain();
  builder.having = chain();
  builder.innerJoin = chain();
  builder.leftJoin = chain();
  builder.then = ((onF?: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
    makeThenableQuery(info).then(onF, onR)) as never;
  builder.catch = ((onR?: (e: unknown) => unknown) => makeThenableQuery(info).catch(onR)) as never;
  builder.finally = ((onF?: () => void) => makeThenableQuery(info).finally(onF)) as never;
  return builder;
}

const dbMock = {
  select: (cols?: Record<string, unknown>) =>
    makeBuilder({ table: null, selectKeys: cols ? Object.keys(cols) : [], hasWhere: false }),
  update: (t: unknown) =>
    makeBuilder({ table: (t as { __table?: string })?.__table ?? null, selectKeys: [], hasWhere: false }),
  insert: (t: unknown) =>
    makeBuilder({ table: (t as { __table?: string })?.__table ?? null, selectKeys: [], hasWhere: false }),
  delete: (t: unknown) =>
    makeBuilder({ table: (t as { __table?: string })?.__table ?? null, selectKeys: [], hasWhere: false }),
  execute: () => makeBuilder({ table: '(raw)', selectKeys: [], hasWhere: false }),
};

// Schema: cada tabela é identificável por __table; colunas são marcadores
// inertes (os filtros drizzle são mockados abaixo, então nunca são lidos).
const schemaMock = new Proxy(
  {},
  {
    get: (_alvo, tabela) =>
      new Proxy(
        { __table: String(tabela) },
        {
          get: (t, coluna) => (coluna === '__table' ? t.__table : { __col: `${t.__table}.${String(coluna)}` }),
        },
      ),
  },
);

vi.mock('@desigual-os/database', () => ({ db: dbMock, schema: schemaMock }));

// Os operadores drizzle só montariam SQL real; com o db mockado eles são
// ruído. Viram constantes inertes — o comportamento sob teste é o do worker,
// não o do ORM.
vi.mock('drizzle-orm', () => {
  const tag = () => ({ __sql: true });
  return {
    eq: () => null,
    and: () => null,
    or: () => null,
    desc: () => null,
    asc: () => null,
    inArray: () => null,
    notInArray: () => null,
    isNull: () => null,
    isNotNull: () => null,
    gte: () => null,
    lte: () => null,
    lt: () => null,
    gt: () => null,
    ne: () => null,
    sql: Object.assign(tag, { raw: () => ({ __raw: true }) }),
  };
});

vi.mock('@desigual-os/orchestrator', () => ({
  AGENT_TIMEOUT_MS: { bento: 120_000, jarbas: 180_000, suzy: 180_000, studio: 900_000, otto: 300_000 },
  AGENT_MAX_ATTEMPTS: { bento: 2, jarbas: 1, suzy: 1, studio: 2, otto: 2 },
  PRIORITY_VALUE: { P0: 1, P1: 2, P2: 3, P3: 4 },
  findHealthyNodeForAgent: vi.fn(async () => ({ privateHost: '127.0.0.1:4999' })),
  finalizeExecutionCost: vi.fn(async () => undefined),
  generateStudioJobId: vi.fn(() => 'STU-TESTE'),
  getAgentQueue: vi.fn(),
  getStudioJobQueue: vi.fn(),
  publishWsEvent: vi.fn(async () => undefined),
  recordCostEvent: vi.fn(async () => undefined),
  recordLearning: vi.fn(async () => undefined),
  recallMemories: vi.fn((q: { kinds?: string[] }) => {
    if (H.falhas.has('feedback')) return Promise.reject(new Error('falha injetada pelo teste: feedback'));
    if (H.recallMemoriesImpl) return H.recallMemoriesImpl(q);
    return Promise.resolve([]);
  }),
  // Exportações usadas pelo grafo do agentic-dispatch (módulo importado, loop off).
  recallEpisodes: vi.fn(async () => []),
  recallFactualEpisodes: vi.fn(async () => []),
  recordEpisodes: vi.fn(async () => undefined),
  rememberFact: vi.fn(async () => 'created'),
  extractEpisodeCandidates: vi.fn(() => []),
  janelaDoTexto: vi.fn(() => null),
  termosDeConsulta: vi.fn(() => []),
}));

// resolveClientsFromText é o único ponto de falha possível dentro de
// resolveClientTurnContext que o catch (execute-job.ts:1510) cobre de fora:
// aqui ele rejeita de verdade quando o cenário pede.
vi.mock('@desigual-os/context-engine', async (importOriginal) => {
  const original = await importOriginal<typeof import('@desigual-os/context-engine')>();
  return {
    ...original,
    resolveClientsFromText: (message: string) =>
      H.falhas.has('resolucaoTexto')
        ? Promise.reject(new Error('falha injetada pelo teste: resolucaoTexto'))
        : original.resolveClientsFromText(message),
  };
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
const MENSAGEM = 'Me dá 3 títulos pro post de aniversário de 10 anos da Acme Construtora.';
const IMPORT_A_FRIO_MS = 30_000;

function fakeLogger(): Logger & { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> } {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;
}

interface Medicao {
  charsMensagem: number;
  temDialogo: boolean;
  temBlocoCliente: boolean;
  tipoBlocoCliente: 'dossie' | 'sem-dossie' | 'nao-identificado' | 'ausente';
  temClientRef: boolean;
  temBrandKit: boolean;
  feedbacks: number;
  warns: number;
  errors: number;
  dispatchAconteceu: boolean;
  erroLancado: string | null;
}

function tipoDoBloco(mensagem: string): Medicao['tipoBlocoCliente'] {
  if (!mensagem.includes('CLIENTE DO TURNO')) return 'ausente';
  if (mensagem.includes('NÃO IDENTIFICADO')) return 'nao-identificado';
  if (mensagem.includes('DOSSIÊ REAL DESTE CLIENTE')) return 'dossie';
  return 'sem-dossie';
}

async function rodarTurno(falhas: string[]): Promise<Medicao> {
  H.falhas.clear();
  for (const f of falhas) H.falhas.add(f);
  H.fetchBodies.length = 0;
  H.recallMemoriesImpl = async (q) => {
    if (q.kinds?.includes('otto.feedback')) return H.FEEDBACKS;
    if (q.kinds?.includes('otto.approval_reason')) return H.APRENDIZADOS;
    return [];
  };

  const logger = fakeLogger();
  const { processAgentJob } = await import('./execute-job.js');

  const job = {
    data: {
      executionDbId: 'exec-db-1',
      executionId: 'exec-1',
      agent: 'otto',
      message: MENSAGEM,
      contextRefs: [],
      conversationId: 'conv-1',
      attachments: [],
      operationalContext: undefined,
    },
  };

  let erroLancado: string | null = null;
  try {
    await processAgentJob(job as never, logger);
  } catch (error) {
    erroLancado = error instanceof Error ? error.message : String(error);
  }

  const body = H.fetchBodies[0] as
    | { message?: string; context_refs?: string[]; client_brand_kit?: unknown; client_feedback_history?: unknown[] }
    | undefined;
  const mensagem = body?.message ?? '';
  if (process.env.DEG_DEBUG) {
    console.log('PAYLOAD>>>', JSON.stringify({ mensagem, refs: body?.context_refs, kit: body?.client_brand_kit !== undefined, fb: (body?.client_feedback_history as unknown[])?.length, erro: erroLancado }));
  }
  return {
    charsMensagem: mensagem.length,
    temDialogo: mensagem.includes('CONVERSA RECENTE'),
    temBlocoCliente: mensagem.includes('CLIENTE DO TURNO'),
    tipoBlocoCliente: tipoDoBloco(mensagem),
    temClientRef: (body?.context_refs ?? []).some((r) => r.startsWith('client:')),
    temBrandKit: body?.client_brand_kit !== undefined,
    feedbacks: body?.client_feedback_history?.length ?? 0,
    warns: logger.warn.mock.calls.length,
    errors: logger.error.mock.calls.length,
    dispatchAconteceu: H.fetchBodies.length > 0,
    erroLancado,
  };
}

beforeEach(() => {
  vi.stubEnv('NODE_SECRET', 'segredo-teste');
  vi.stubGlobal('fetch', async (_url: unknown, init?: { body?: string }) => {
    H.fetchBodies.push(JSON.parse(init?.body ?? '{}'));
    return {
      ok: true,
      json: async () => ({
        execution_id: 'exec-1',
        agent: 'otto',
        status: 'completed',
        answer: 'Título um. Título dois. Título três.',
        sources: [],
        tool_calls: [],
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    } as unknown as Response;
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  H.falhas.clear();
});

// ---------------------------------------------------------------------------
// S0 — BASELINE SAUDÁVEL
// ---------------------------------------------------------------------------
describe('S0: baseline saudável (todas as fontes respondendo)', () => {
  it(
    'entrega diálogo + dossiê + brand kit + feedbacks no payload do node',
    async () => {
      const m = await rodarTurno([]);
      expect(m.dispatchAconteceu).toBe(true);
      expect(m.temDialogo).toBe(true);
      expect(m.tipoBlocoCliente).toBe('dossie');
      expect(m.temClientRef).toBe(true);
      expect(m.temBrandKit).toBe(true);
      expect(m.feedbacks).toBe(3); // 2 feedbacks + 1 aprendizado validado
      expect(m.charsMensagem).toBeGreaterThan(MENSAGEM.length + 400);
      // Saudável também é silencioso: nada pra avisar.
      expect(m.warns).toBe(0);
      expect(m.errors).toBe(0);
      expect(m.erroLancado).toBeNull();
    },
    IMPORT_A_FRIO_MS,
  );
});

// ---------------------------------------------------------------------------
// Fontes derrubadas UMA por vez — mede payload + sinal visível
// ---------------------------------------------------------------------------
describe('fontes de contexto derrubadas uma a uma', () => {
  it(
    'S1: histórico falha (execute-job.ts:1430 catch→[]) — diálogo some, zero sinal',
    async () => {
      const m = await rodarTurno(['historico']);
      expect(m.dispatchAconteceu).toBe(true);
      expect(m.temDialogo).toBe(false);
      expect(m.tipoBlocoCliente).toBe('dossie'); // o resto intacto
      expect(m.warns).toBe(0);
      expect(m.errors).toBe(0);
      expect(m.erroLancado).toBeNull();
    },
    IMPORT_A_FRIO_MS,
  );

  it(
    'S2: nome do cliente falha (client-context.ts:167 catch→[]) — identidade cai pra NÃO IDENTIFICADO, sem ref, zero sinal',
    async () => {
      const m = await rodarTurno(['clienteNome']);
      expect(m.dispatchAconteceu).toBe(true);
      expect(m.tipoBlocoCliente).toBe('nao-identificado');
      expect(m.temClientRef).toBe(false); // node não recebe client:<id> — cerca do vault não fecha
      expect(m.warns).toBe(0);
      expect(m.errors).toBe(0);
      expect(m.erroLancado).toBeNull();
    },
    IMPORT_A_FRIO_MS,
  );

  it(
    'S3: dossiê falha (client-context.ts:184 catch→[]) — cliente vira "existe mas sem dossiê", zero sinal',
    async () => {
      const m = await rodarTurno(['perfil']);
      expect(m.dispatchAconteceu).toBe(true);
      expect(m.tipoBlocoCliente).toBe('sem-dossie');
      expect(m.temClientRef).toBe(true); // ref ainda vai — mas o node não tem FATO nenhum do cliente
      expect(m.warns).toBe(0);
      expect(m.errors).toBe(0);
      expect(m.erroLancado).toBeNull();
    },
    IMPORT_A_FRIO_MS,
  );

  it(
    'S4: contagem de clientes falha (client-context.ts:273 catch→0) — bloco afirma carteira de 0 clientes, zero sinal',
    async () => {
      const m = await rodarTurno(['contagemClientes']);
      expect(m.dispatchAconteceu).toBe(true);
      expect(m.tipoBlocoCliente).toBe('dossie'); // com dossiê o número nem aparece; o 0 é invisível
      expect(m.warns).toBe(0);
      expect(m.errors).toBe(0);
      expect(m.erroLancado).toBeNull();
    },
    IMPORT_A_FRIO_MS,
  );

  it(
    'S5a: resolução textual falha (client-context.ts:146 catch→null) COM cliente no seletor — redundância salva o bloco, zero sinal',
    async () => {
      const m = await rodarTurno(['resolucaoTexto']);
      expect(m.dispatchAconteceu).toBe(true);
      expect(m.tipoBlocoCliente).toBe('dossie'); // executionClientId cobriu
      expect(m.warns).toBe(0);
      expect(m.errors).toBe(0);
    },
    IMPORT_A_FRIO_MS,
  );

  it(
    'S6: brand kit AUSENTE (sem linha na tabela) — campo omitido do payload (execute-job.ts:561), DNA nasce null no node, zero sinal',
    async () => {
      const m = await rodarTurno(['brandKitAusente']);
      expect(m.dispatchAconteceu).toBe(true);
      expect(m.temBrandKit).toBe(false);
      expect(m.tipoBlocoCliente).toBe('dossie'); // o resto segue — o turno "criativo mas sem identidade visual"
      expect(m.warns).toBe(0);
      expect(m.errors).toBe(0);
      expect(m.erroLancado).toBeNull();
    },
    IMPORT_A_FRIO_MS,
  );

  it(
    'S7: feedback AUSENTE (recallMemories devolve []) — client_feedback_history omitido (execute-job.ts:565), zero sinal',
    async () => {
      const m = await rodarTurno([]);
      H.recallMemoriesImpl = async () => [];
      // re-executa com recall vazio: sem derrubar nada, só sem dados
      H.fetchBodies.length = 0;
      const logger = fakeLogger();
      const { processAgentJob } = await import('./execute-job.js');
      await processAgentJob(
        {
          data: {
            executionDbId: 'exec-db-1',
            executionId: 'exec-1',
            agent: 'otto',
            message: MENSAGEM,
            contextRefs: [],
            conversationId: 'conv-1',
            attachments: [],
          },
        } as never,
        logger,
      );
      const body = H.fetchBodies[0] as { client_feedback_history?: unknown[] } | undefined;
      expect(body?.client_feedback_history).toBeUndefined();
      expect(logger.warn.mock.calls.length).toBe(0);
      expect(logger.error.mock.calls.length).toBe(0);
      void m;
    },
    IMPORT_A_FRIO_MS,
  );

  it(
    'S8: brand kit REJEITA (execute-job.ts:1293-1296, SEM catch) — o turno INTEIRO morre antes do dispatch',
    async () => {
      const m = await rodarTurno(['brandKit']);
      // Não é fallback silencioso: é crash. O node nunca é chamado.
      expect(m.dispatchAconteceu).toBe(false);
      expect(m.erroLancado).toContain('brandKit');
    },
    IMPORT_A_FRIO_MS,
  );

  it(
    'S9: recall de feedback REJEITA (execute-job.ts:1311, SEM catch) — idem: crash antes do dispatch, não degradação',
    async () => {
      const m = await rodarTurno(['feedback']);
      expect(m.dispatchAconteceu).toBe(false);
      expect(m.erroLancado).toContain('feedback');
    },
    IMPORT_A_FRIO_MS,
  );
});

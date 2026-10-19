import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * bento-resource-continuity.test.ts — FASE B.7 da auditoria forense: teste
 * explícito do ConversationResourceState do Bento.
 *
 * O que é REAL aqui (não mockado):
 *   - loadResourceState / persistResourceState / applyExecutionToState /
 *     parseResourceState (apps/worker/src/processors/bento-resource-state.ts)
 *   - resolveTargetResourceId / validateBentoAction (packages/bento-core/src/policy.ts)
 *
 * O que é mockado: SÓ a I/O — drizzle-orm (eq/desc) e @desigual-os/database
 * (db/schema), substituídos por um store append-only em memória que replica
 * fielmente a query real: filtra SÓ por conversationId (a query não filtra
 * contextType — ver teste "linha de outro contextType"), ordena por
 * createdAt desc e limita a 1 linha.
 *
 * Os testes documentam o comportamento REAL do código hoje (25/09/2026).
 * Onde o comportamento provado é ruim, o teste continua VERDE e marcado
 * "COMPORTAMENTO ATUAL (bug)" — a asserção trava o comportamento atual para
 * a auditoria, não o desejado.
 */

const store = vi.hoisted(() => {
  const rows: Array<{ conversationId: string; contextType: string; payload: Record<string, unknown>; createdAt: number }> = [];
  return { rows, tick: { n: 0 } };
});

vi.mock('drizzle-orm', () => ({
  eq: (col: { __col: string }, val: unknown) => ({ __op: 'eq', col: col.__col, val }),
  and: (...conds: Array<{ __op: 'eq'; col: string; val: unknown }>) => ({ __op: 'and', conds }),
  desc: (col: { __col: string }) => ({ __desc: col.__col }),
}));

vi.mock('@desigual-os/database', () => ({
  db: {
    select: () => ({
      from: () => ({
        // Fiel a bento-resource-state.ts:52-54 (pós F-09): filtra por
        // conversationId E contextType via and(eq, eq).
        where: (cond: { __op: 'eq' | 'and'; col?: string; val?: unknown; conds?: Array<{ col: string; val: unknown }> }) => ({
          orderBy: () => ({
            limit: (n: number) => {
              const conds = cond.__op === 'and' ? (cond.conds ?? []) : [{ col: cond.col!, val: cond.val }];
              const matches = (r: { conversationId: string; contextType: string }) =>
                conds.every((c) => (c.col === 'conversationId' ? r.conversationId === c.val : c.col === 'contextType' ? r.contextType === c.val : true));
              return Promise.resolve(
                store.rows
                  .filter(matches)
                  .sort((a, b) => b.createdAt - a.createdAt)
                  .slice(0, n)
                  .map((r) => ({ payload: r.payload })),
              );
            },
          }),
        }),
      }),
    }),
    insert: () => ({
      values: (v: { conversationId: string; contextType: string; payload: Record<string, unknown> }) => {
        store.rows.push({ ...v, createdAt: ++store.tick.n });
        return Promise.resolve();
      },
    }),
  },
  schema: {
    conversationContext: {
      conversationId: { __col: 'conversationId' },
      contextType: { __col: 'contextType' },
      payload: { __col: 'payload' },
      createdAt: { __col: 'createdAt' },
    },
  },
}));

import { loadResourceState, persistResourceState, applyExecutionToState, parseResourceState, clearResourceFocusIfDeleted } from './bento-resource-state.js';
import {
  resolveTargetResourceId,
  validateBentoAction,
  type ConversationResourceState,
  type PolicyContext,
  type StructuredAction,
} from '@desigual-os/bento-core';

const CONV = 'conv-principal';

function ref(resourceId: string, title: string | null = null) {
  return { resourceType: 'CLICKUP_TASK' as const, resourceId, title };
}

function acao(intent: StructuredAction['intent'], resourceId: string | null = null): StructuredAction {
  return {
    intent,
    target: { resourceType: 'CLICKUP_TASK', resourceId },
    changes: null,
    requestedCardinality: 1,
    reasoning: 'teste B.7',
  };
}

const CTX_GRAVADOR: PolicyContext = {
  actorHasClickUpWrite: true,
  agentHasClickUpWrite: true,
  mutationsThisExecution: 0,
  maxMutationsPerExecution: 10,
  explicitMultiActionConfirmed: false,
};

/**
 * Réplica exata do que bento-openai-core.ts faz após um write verificado
 * (linhas 207-214, 239-240, 261-262, 291-292): carrega o estado, aplica a
 * execução, persiste. É o ÚNICO ponto do sistema que evolui o estado.
 */
async function turnoDeEscrita(
  conversationId: string,
  update: { operation: string; resourceIds: string[]; verified: boolean; created: boolean; title?: string | null },
): Promise<ConversationResourceState> {
  const estado = await loadResourceState(conversationId);
  const novo = applyExecutionToState(estado, update);
  await persistResourceState(conversationId, novo);
  return novo;
}

/** Turno sem nenhum recurso: o loop novo não chama applyExecution nem persist. */
async function turnoSemRecursos(conversationId: string): Promise<ConversationResourceState> {
  return loadResourceState(conversationId);
}

beforeEach(() => {
  store.rows.length = 0;
  store.tick.n = 0;
});

describe('CENÁRIO PRINCIPAL — cria A, cria B, "volta pra A", altera A, "essa task", off-topic, ordinal', () => {
  it('PASSO 1: criar Task A registra em recentCreatedResources e foca A; sobrevive a reload', async () => {
    const estado = await turnoDeEscrita(CONV, { operation: 'create_task', resourceIds: ['task-a'], verified: true, created: true, title: 'Task A' });
    expect(estado.focusedResource?.resourceId).toBe('task-a');
    expect(estado.recentCreatedResources.map((r) => r.resourceId)).toEqual(['task-a']);

    // "reload": nova chamada loadResourceState lê o que foi persistido.
    const relido = await loadResourceState(CONV);
    expect(relido.focusedResource?.resourceId).toBe('task-a');
    expect(relido.lastExecution?.operation).toBe('create_task');
  });

  it('PASSO 2: criar Task B move o foco pra B; A permanece em recentCreated (mais recente primeiro)', async () => {
    await turnoDeEscrita(CONV, { operation: 'create_task', resourceIds: ['task-a'], verified: true, created: true, title: 'Task A' });
    const estado = await turnoDeEscrita(CONV, { operation: 'create_task', resourceIds: ['task-b'], verified: true, created: true, title: 'Task B' });

    expect(estado.focusedResource?.resourceId).toBe('task-b');
    expect(estado.recentCreatedResources.map((r) => r.resourceId)).toEqual(['task-b', 'task-a']);
  });

  it('PASSO 3 (COMPORTAMENTO ATUAL — bug): "voltar para a Task A" NÃO move o foco — não existe mecanismo de re-foco por referência', async () => {
    await turnoDeEscrita(CONV, { operation: 'create_task', resourceIds: ['task-a'], verified: true, created: true, title: 'Task A' });
    await turnoDeEscrita(CONV, { operation: 'create_task', resourceIds: ['task-b'], verified: true, created: true, title: 'Task B' });

    // Turno "voltar para a primeira task" não é um write: nada chama
    // applyExecutionToState. O único mutador do estado
    // (bento-resource-state.ts:68-85) só move foco junto de uma escrita.
    const depois = await turnoSemRecursos(CONV);
    expect(depois.focusedResource?.resourceId).toBe('task-b');

    // E a policy resolve "essa task" pelo foco atual (policy.ts:36): o alvo
    // da PRÓXIMA alteração seria B, não A — silenciosamente.
    expect(resolveTargetResourceId(acao('update_task'), depois)).toBe('task-b');

    // A ÚNICA forma do foco voltar pra A é o planner (LLM) trazer o id
    // explícito no target — aí a policy usa o id sem consultar o estado
    // (policy.ts:34). Se o modelo errar o id, nada no estado novo corrige:
    // resolveTargetResourceId nunca casa por título, ordinal ou recência.
  });

  it('PASSO 4: alterar A (com id explícito do planner) registra em recentUpdatedResources e RE-FOCA A', async () => {
    await turnoDeEscrita(CONV, { operation: 'create_task', resourceIds: ['task-a'], verified: true, created: true, title: 'Task A' });
    await turnoDeEscrita(CONV, { operation: 'create_task', resourceIds: ['task-b'], verified: true, created: true, title: 'Task B' });

    // Planner resolveu o id explícito — policy deixa passar (policy.ts:34)
    // e o write verificado re-foca o recurso alterado (bento-resource-state.ts:79).
    const estado = await turnoDeEscrita(CONV, { operation: 'update_task', resourceIds: ['task-a'], verified: true, created: false });
    expect(estado.focusedResource?.resourceId).toBe('task-a');
    expect(estado.recentUpdatedResources.map((r) => r.resourceId)).toEqual(['task-a']);
    // recentCreated continua intacto — update não apaga o histórico de criação.
    expect(estado.recentCreatedResources.map((r) => r.resourceId)).toEqual(['task-b', 'task-a']);
  });

  it('PASSO 5: "essa task" resolve pro foco atual (quem foi escrito por último)', async () => {
    await turnoDeEscrita(CONV, { operation: 'create_task', resourceIds: ['task-a'], verified: true, created: true, title: 'Task A' });
    await turnoDeEscrita(CONV, { operation: 'create_task', resourceIds: ['task-b'], verified: true, created: true, title: 'Task B' });
    await turnoDeEscrita(CONV, { operation: 'update_task', resourceIds: ['task-a'], verified: true, created: false });

    const estado = await loadResourceState(CONV);
    // NOTA pós-correção D.12/F-18 (bento-core policy): update_task sem campo
    // concreto em changes agora é bloqueado (content_missing → esclarecimento).
    // O foco deste passo é resolução de alvo, então a ação carrega uma mudança
    // material (dueDate) — a asserção de foco é idêntica à original.
    const acaoComMudanca = { ...acao('update_task'), changes: { dueDate: '2026-09-28' } };
    expect(resolveTargetResourceId(acaoComMudanca, estado)).toBe('task-a');
    const decision = validateBentoAction(acaoComMudanca, estado, CTX_GRAVADOR);
    expect(decision.allowed).toBe(true);
    expect(decision.resolvedResourceId).toBe('task-a');
  });

  it('PASSO 6: turno fora de assunto NÃO decai o foco — ele persiste indefinidamente (sem TTL, sem decay)', async () => {
    await turnoDeEscrita(CONV, { operation: 'create_task', resourceIds: ['task-a'], verified: true, created: true, title: 'Task A' });

    // Quantos turnos sem recurso passarem, o estado volta idêntico: nada no
    // load (bento-resource-state.ts:48-57) olha updatedAt nem descarta foco velho.
    for (let i = 0; i < 10; i++) await turnoSemRecursos(CONV);
    const estado = await loadResourceState(CONV);
    expect(estado.focusedResource?.resourceId).toBe('task-a');
    // Risco documentado: numa conversa longa, "essa task" dita dias depois
    // ainda resolve pra task-a. Hoje isso é uma propriedade do design, não um
    // acidente — mas nenhum turno de leitura/off-topic reseta a referência.
  });

  it('PASSO 7 (COMPORTAMENTO ATUAL — bug): "naquela primeira coloca sexta" resolve pra FOCADA (B), nunca pra primeira criada (A)', async () => {
    await turnoDeEscrita(CONV, { operation: 'create_task', resourceIds: ['task-a'], verified: true, created: true, title: 'Task A' });
    await turnoDeEscrita(CONV, { operation: 'create_task', resourceIds: ['task-b'], verified: true, created: true, title: 'Task B' });
    const estado = await loadResourceState(CONV);

    // Esperado pelo usuário: "a primeira" = task-a (primeira criada), ou um
    // pedido de esclarecimento. Real provado: resolveTargetResourceId
    // (policy.ts:33-40) lê APENAS focusedResource/selectedResources/
    // lastExecution — recentCreatedResources, que tem A e B com títulos e
    // ordem, nunca é consultado. Ganha o foco: task-b.
    expect(estado.recentCreatedResources.map((r) => r.resourceId)).toEqual(['task-b', 'task-a']);
    expect(resolveTargetResourceId(acao('update_task'), estado)).toBe('task-b');

    // E a ponte legada (única que entende ordinal, bento-legacy-selection-bridge.ts)
    // NÃO dispara aqui: bento-openai-core.ts:118-122 só a chama quando
    // focusedResource é null E selectedResources está vazio. Com foco presente,
    // o ordinal é ignorado silenciosamente — sem esclarecimento, sem log.
  });

  it('PASSO 7b: sem foco, o ordinal sobre recentCreated vira target_unresolved (recusa honesta, mas o dado estava lá)', async () => {
    // Estado com histórico de criação mas sem foco/seleção/lastExecution.
    const estado: ConversationResourceState = {
      ...(parseResourceState(null) as ConversationResourceState),
      recentCreatedResources: [ref('task-b', 'Task B'), ref('task-a', 'Task A')],
    };
    expect(resolveTargetResourceId(acao('update_task'), estado)).toBeNull();
    const decision = validateBentoAction(acao('update_task'), estado, CTX_GRAVADOR);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/^target_unresolved/);
    // Melhor que escolher arbitrário — mas "a primeira" tinha resposta
    // determinística disponível em recentCreatedResources[1] e ninguém lê.
  });
});

describe('persistência — reload e restart de worker', () => {
  it('reload: segunda chamada loadResourceState devolve exatamente o estado persistido', async () => {
    await turnoDeEscrita(CONV, { operation: 'create_task', resourceIds: ['task-a'], verified: true, created: true, title: 'Task A' });
    const a = await loadResourceState(CONV);
    const b = await loadResourceState(CONV);
    expect(b.focusedResource).toEqual(a.focusedResource);
    expect(b.recentCreatedResources).toEqual(a.recentCreatedResources);
    expect(b.lastExecution?.operation).toBe('create_task');
  });

  it('restart de worker: o módulo não tem cache em memória — o store é a única memória, então restart é equivalente a um load novo', async () => {
    await turnoDeEscrita(CONV, { operation: 'create_task', resourceIds: ['task-a'], verified: true, created: true, title: 'Task A' });
    // Não existe variável module-level em bento-resource-state.ts além da
    // constante CONTEXT_TYPE: todo load bate no banco. "Restart" aqui é
    // simplesmente provar que o estado não depende de nada em processo.
    const estado = await loadResourceState(CONV);
    expect(estado.focusedResource?.resourceId).toBe('task-a');
    expect(estado.recentCreatedResources).toHaveLength(1);
  });

  it('payload corrompido/estrangeiro: parse defensivo cai pro estado vazio, nunca lança', async () => {
    store.rows.push({ conversationId: CONV, contextType: 'bento_resource_state', payload: { focusedResource: 'lixo', selectedResources: 'lixo' }, createdAt: ++store.tick.n });
    const estado = await loadResourceState(CONV);
    expect(estado.focusedResource).toBeNull();
    expect(estado.selectedResources).toEqual([]);
    expect(estado.version).toBe(1);
  });
});

describe('isolamento', () => {
  it('conversations diferentes não vazam estado entre si', async () => {
    await turnoDeEscrita('conv-1', { operation: 'create_task', resourceIds: ['task-a'], verified: true, created: true, title: 'Task A' });
    await turnoDeEscrita('conv-2', { operation: 'create_task', resourceIds: ['task-x'], verified: true, created: true, title: 'Task X' });

    expect((await loadResourceState('conv-1')).focusedResource?.resourceId).toBe('task-a');
    expect((await loadResourceState('conv-2')).focusedResource?.resourceId).toBe('task-x');
    expect((await loadResourceState('conv-3')).focusedResource).toBeNull();
  });

  it('usuários na mesma conversa (COMPORTAMENTO ATUAL — risco): o estado é POR CONVERSA, não por usuário — dois usuários compartilham foco', async () => {
    // Prova executável da forma da API: as funções nem aceitam userId.
    expect(loadResourceState.length).toBe(1); // (conversationId) apenas
    expect(persistResourceState.length).toBe(2); // (conversationId, state) apenas

    // "Usuário 1" foca a task-a; "usuário 2" entra na mesma conversa e o
    // estado que ele recebe é o mesmo — indistinguível por identidade.
    await turnoDeEscrita(CONV, { operation: 'create_task', resourceIds: ['task-a'], verified: true, created: true, title: 'Task A' });
    const estadoDoUsuario2 = await loadResourceState(CONV);
    expect(estadoDoUsuario2.focusedResource?.resourceId).toBe('task-a');
    // Consequência: "essa task" dita pelo usuário 2 altera a task que o
    // usuário 1 focou. Em conversa compartilhada isso é cross-user targeting.
  });
});

describe('ambiguidade — "[QA] Carrossel Outubro" vs "[QA] Carrossel Novembro"', () => {
  const OUT = ref('task-out', '[QA] Carrossel Outubro');
  const NOV = ref('task-nov', '[QA] Carrossel Novembro');

  it('sem foco: referência parcial "o carrossel" é RECUSADA (target_unresolved) — nunca escolha arbitrária', async () => {
    const estado: ConversationResourceState = {
      ...(parseResourceState(null) as ConversationResourceState),
      recentCreatedResources: [NOV, OUT],
    };
    const decision = validateBentoAction(acao('update_task'), estado, CTX_GRAVADOR);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/^target_unresolved/);
    expect(decision.resolvedResourceId).toBeNull();
  });

  it('COM FOCO (COMPORTAMENTO ATUAL — bug): a mesma referência ambígua cai no foco sem nenhuma checagem de título', async () => {
    const estado: ConversationResourceState = {
      ...(parseResourceState(null) as ConversationResourceState),
      focusedResource: NOV,
      recentCreatedResources: [NOV, OUT],
    };
    // "muda o carrossel pra sexta" — o usuário pode estar falando de Outubro;
    // a policy não compara o texto da mensagem com o título do foco
    // (policy.ts:36 é cega a conteúdo). Resolve Novembro, silenciosamente.
    // NOTA pós-correção D.12/F-18 (bento-core policy): update_task sem campo
    // concreto agora é bloqueado (content_missing), então a ação carrega a
    // mudança material que a frase implica (dueDate "sexta"). O comportamento
    // documentado aqui — referência ambígua caindo no foco sem checagem de
    // título — permanece ATIVO: a policy continua cega a título.
    const acaoComMudanca = { ...acao('update_task'), changes: { dueDate: '2026-09-25' } };
    expect(resolveTargetResourceId(acaoComMudanca, estado)).toBe('task-nov');
    expect(validateBentoAction(acaoComMudanca, estado, CTX_GRAVADOR).allowed).toBe(true);
  });

  it('fallback lastExecution: sem foco nem seleção, uma execução anterior de UM recurso ainda resolve a referência', async () => {
    const estado: ConversationResourceState = {
      ...(parseResourceState(null) as ConversationResourceState),
      lastExecution: { operation: 'update_task', resourceIds: ['task-out'], verified: true, at: new Date().toISOString() },
    };
    expect(resolveTargetResourceId(acao('comment_task'), estado)).toBe('task-out');
    // Execução anterior de DOIS recursos não resolve (policy.ts:38 exige length===1).
    const estadoMulti: ConversationResourceState = {
      ...estado,
      lastExecution: { operation: 'update_task', resourceIds: ['task-out', 'task-nov'], verified: true, at: new Date().toISOString() },
    };
    expect(resolveTargetResourceId(acao('comment_task'), estadoMulti)).toBeNull();
  });
});

describe('limites do append-only (conversation_context)', () => {
  it('cada write persiste UMA linha nova; a tabela cresce sem bound e não há compactação nem cleanup', async () => {
    for (let i = 0; i < 50; i++) {
      await turnoDeEscrita(CONV, { operation: 'update_task', resourceIds: ['task-a'], verified: true, created: false });
    }
    // 50 turnos de escrita = 50 linhas. Nenhum DELETE/UPDATE em
    // bento-resource-state.ts e nenhum job de compactação referenciando
    // conversation_context no repositório (verificado por grep em 25/09/2026).
    expect(store.rows.filter((r) => r.conversationId === CONV)).toHaveLength(50);
    // A leitura não degrada por turno: sempre a mais recente (limit 1).
    const estado = await loadResourceState(CONV);
    expect(estado.focusedResource?.resourceId).toBe('task-a');
    // COMPORTAMENTO ATUAL (menor): recentUpdatedResources NÃO deduplica —
    // 50 updates na mesma task viram 20 entradas idênticas de 'task-a'
    // (prepend + slice(0,20) em bento-resource-state.ts:81, sem checar se o
    // id já está na lista). O cap segura o tamanho, mas o histórico infla
    // com repetições e expulsa outros recursos reais.
    expect(estado.recentUpdatedResources).toHaveLength(20);
    expect(new Set(estado.recentUpdatedResources.map((r) => r.resourceId))).toEqual(new Set(['task-a']));
  });

  it('os arrays do estado TÊM cap: recentCreated/recentUpdated truncam em 20 (bento-resource-state.ts:80-81)', async () => {
    for (let i = 0; i < 25; i++) {
      await turnoDeEscrita(CONV, { operation: 'create_task', resourceIds: [`task-${i}`], verified: true, created: true });
    }
    const estado = await loadResourceState(CONV);
    expect(estado.recentCreatedResources).toHaveLength(20);
    // Os 5 mais antigos (task-0..task-4) rolaram pra fora: "a primeira task
    // que criamos" deixa de existir no estado depois de 20 criações.
    expect(estado.recentCreatedResources.some((r) => r.resourceId === 'task-0')).toBe(false);
    expect(estado.recentCreatedResources[0]?.resourceId).toBe('task-24');
  });

  it('(F-09 corrigido) uma linha de OUTRO contextType na mesma conversa NÃO afeta o estado na leitura', async () => {
    await turnoDeEscrita(CONV, { operation: 'create_task', resourceIds: ['task-a'], verified: true, created: true, title: 'Task A' });

    // A tabela conversation_context é compartilhada com o Context Engine
    // ("recortes de contexto", packages/database/src/schema/conversation.ts:94-97).
    // Um outro escritor grava uma linha mais nova pra mesma conversa…
    store.rows.push({
      conversationId: CONV,
      contextType: 'context_engine_recorte',
      payload: { trechos: ['qualquer coisa'] },
      createdAt: ++store.tick.n,
    });

    // …mas o load agora filtra por conversationId E contextType
    // (bento-resource-state.ts:52, and(eq, eq)), então o estado do Bento
    // continua íntegro mesmo com outros escritores na mesma tabela.
    const estado = await loadResourceState(CONV);
    expect(estado.focusedResource?.resourceId).toBe('task-a');
    expect(estado.recentCreatedResources.map((r) => r.resourceId)).toEqual(['task-a']);
    expect(estado.lastExecution?.resourceIds).toEqual(['task-a']);
  });
});

describe('onde o task_id se perde — caminho MCP com resourceId null', () => {
  it('(COMPORTAMENTO ATUAL — bug) create via MCP sem id extraível: estado NÃO registra a task criada — sem foco, sem recentCreated, sem fallback', async () => {
    // bento-mcp-executor.ts:137-162: o id sai do output livre da tool MCP;
    // se não achar e não houver resolvedResourceId (create nunca tem), o
    // envelope volta success:true com resourceIds: [] — e bento-openai-core.ts:
    // 206-214 persiste mesmo assim.
    const estado = await turnoDeEscrita(CONV, { operation: 'create_task', resourceIds: [], verified: true, created: true, title: 'Task criada via MCP' });

    expect(estado.focusedResource).toBeNull(); // refs[0] undefined → foco não se move (bento-resource-state.ts:79)
    expect(estado.recentCreatedResources).toEqual([]); // refs vazio → nada entra no histórico (:80)
    expect(estado.lastExecution?.resourceIds).toEqual([]); // lastExecution sem id (:82)

    // Próximo turno "essa task": sem foco, sem seleção, lastExecution com
    // length !== 1 → target_unresolved. A task existe no ClickUp mas é
    // invisível pra continuidade da conversa.
    const relido = await loadResourceState(CONV);
    const decision = validateBentoAction(acao('update_task'), relido, CTX_GRAVADOR);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/^target_unresolved/);
  });

  it('caminho LEGACY_GATEWAY preserva o id (createVerifiedSeniorTask devolve resourceId) — a perda é específica do MCP', async () => {
    const estado = await turnoDeEscrita(CONV, { operation: 'create_task', resourceIds: ['2m8xkz9'], verified: true, created: true, title: 'Task via gateway' });
    expect(estado.focusedResource?.resourceId).toBe('2m8xkz9');
    expect(resolveTargetResourceId(acao('update_task'), estado)).toBe('2m8xkz9');
  });
});

describe('INV-10 — clearResourceFocusIfDeleted (delete via guard legado limpa o foco do core novo)', () => {
  it('foco apontando pra task deletada é limpo', async () => {
    await turnoDeEscrita(CONV, { operation: 'create_task', resourceIds: ['task-a'], verified: true, created: true, title: 'Task A' });
    await clearResourceFocusIfDeleted(CONV, 'task-a');
    const estado = await loadResourceState(CONV);
    expect(estado.focusedResource).toBeNull();
    expect(estado.lastExecution?.operation).toBe('delete_task');
  });

  it('deletar uma task que NÃO é a focada não mexe no foco de outra', async () => {
    await turnoDeEscrita(CONV, { operation: 'create_task', resourceIds: ['task-a'], verified: true, created: true, title: 'Task A' });
    await turnoDeEscrita(CONV, { operation: 'create_task', resourceIds: ['task-b'], verified: true, created: true, title: 'Task B' });
    await clearResourceFocusIfDeleted(CONV, 'task-a');
    const estado = await loadResourceState(CONV);
    expect(estado.focusedResource?.resourceId).toBe('task-b');
  });

  it('idempotente: chamar duas vezes pro mesmo id já limpo não regrava nem quebra', async () => {
    await turnoDeEscrita(CONV, { operation: 'create_task', resourceIds: ['task-a'], verified: true, created: true, title: 'Task A' });
    await clearResourceFocusIfDeleted(CONV, 'task-a');
    await clearResourceFocusIfDeleted(CONV, 'task-a');
    const estado = await loadResourceState(CONV);
    expect(estado.focusedResource).toBeNull();
  });
});

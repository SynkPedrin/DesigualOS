import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildContext, formatContextForPrompt } from './build-context';

/**
 * buildContext é a superfície de maior risco de vazamento entre clientes do
 * sistema (seção 6.4): se alguma query aqui esquecer de filtrar por
 * clientId/projectId/agentId, o contexto de um cliente vaza pro prompt de
 * outro. Não dá pra testar isso mockando `db.select().from().where()` pra
 * sempre devolver a mesma linha fixa (isso não pegaria um bug de "esqueci o
 * filtro" ou "troquei o id errado") - então o mock abaixo é um bancinho fake
 * de verdade: guarda linhas de vários clientes/projetos/agentes ao mesmo
 * tempo e só devolve as que batem com a condição passada pro `.where()`.
 *
 * Pra isso, `eq`/`and`/`ne`/`isNotNull` do drizzle-orm também são mockados
 * (só pra virar objetos descritores simples que o filtro abaixo consegue
 * ler) - o `desc()` usado no `.orderBy()` não precisa de mock funcional,
 * ordenação por data é feita à mão no fake db, imitando o que o Postgres
 * faria com `orderBy(desc(createdAt)).limit(n)`.
 *
 * A tabela `memories` é consultada duas vezes com propósitos diferentes
 * (dossiê do cliente vs. aprendizados do agente) - o discriminador entre as
 * duas, no mock, é o `and(eq(...), eq(...))` (dossiê: segunda condição é
 * igualdade de kind) vs `and(eq(...), ne(...))` (aprendizados: segunda
 * condição é diferença de kind), que é exatamente a diferença real entre as
 * duas queries em build-context.ts.
 */

interface MockCondition {
  op: 'eq' | 'ne' | 'isNotNull' | 'and' | 'or' | 'isNull' | 'sql';
  value?: unknown;
  conditions?: MockCondition[];
}

vi.mock('drizzle-orm', () => ({
  eq: (_column: unknown, value: unknown): MockCondition => ({ op: 'eq', value }),
  ne: (_column: unknown, value: unknown): MockCondition => ({ op: 'ne', value }),
  isNotNull: (_column: unknown): MockCondition => ({ op: 'isNotNull' }),
  and: (...conditions: MockCondition[]): MockCondition => ({ op: 'and', conditions }),
  or: (...conditions: MockCondition[]): MockCondition => ({ op: 'or', conditions }),
  isNull: (_column: unknown): MockCondition => ({ op: 'isNull' }),
  desc: (_column: unknown) => ({ op: 'desc' as const }),
  // `sql` é usado pelos filtros de expiração/importância; no mock só precisa existir e
  // devolver algo inerte, porque o fake de `db` decide o resultado pelas condições `eq`.
  sql: Object.assign(
    (..._parts: unknown[]): MockCondition => ({ op: 'sql' }),
    { raw: (_s: string): MockCondition => ({ op: 'sql' }) },
  ),
}));

interface FakeUser {
  id: string;
  name: string;
}
interface FakeClient {
  id: string;
  name: string;
}
interface FakeBrandKit {
  clientId: string;
  toneOfVoice: string;
}
interface FakeAgent {
  id: string;
  name: string;
}
interface FakeMessage {
  conversationId: string;
  role: string;
  agent: string | null;
  content: string;
  attachmentUrl: string | null;
  attachmentFilename: string | null;
  attachmentType: string | null;
  createdAt: Date;
}
interface FakeMemory {
  clientId: string | null;
  agentId: string | null;
  kind: string;
  content: string;
  updatedAt: Date;
}
interface FakeProjectFile {
  projectId: string;
  filename: string;
  kind: string;
  textContent: string | null;
}

const mockDb = {
  users: [] as FakeUser[],
  clients: [] as FakeClient[],
  brandKits: [] as FakeBrandKit[],
  agents: [] as FakeAgent[],
  messages: [] as FakeMessage[],
  memories: [] as FakeMemory[],
  projectFiles: [] as FakeProjectFile[],
};

function mockReset(): void {
  mockDb.users = [];
  mockDb.clients = [];
  mockDb.brandKits = [];
  mockDb.agents = [];
  mockDb.messages = [];
  mockDb.memories = [];
  mockDb.projectFiles = [];
}

function eqValue(condition: MockCondition): unknown {
  return condition.op === 'eq' ? condition.value : undefined;
}

vi.mock('@desigual-os/database', () => {
  // Tabelas são objetos únicos: sua identidade (===) é o que o `.from()`
  // fabricado abaixo usa pra saber qual query está rodando. O conteúdo dos
  // campos não importa (eq/ne/isNotNull mockados ignoram a coluna).
  const schema = {
    users: { id: 'id', name: 'name' },
    clients: { id: 'id', name: 'name' },
    clientBrandKits: { clientId: 'clientId', toneOfVoice: 'toneOfVoice' },
    agents: { id: 'id', name: 'name' },
    messages: {
      conversationId: 'conversationId',
      role: 'role',
      agent: 'agent',
      content: 'content',
      attachmentUrl: 'attachmentUrl',
      attachmentFilename: 'attachmentFilename',
      attachmentType: 'attachmentType',
      createdAt: 'createdAt',
    },
    memories: {
      clientId: 'clientId',
      agentId: 'agentId',
      kind: 'kind',
      content: 'content',
      updatedAt: 'updatedAt',
    },
    projectFiles: {
      projectId: 'projectId',
      filename: 'filename',
      kind: 'kind',
      textContent: 'textContent',
    },
  };

  const db = {
    select: (_columns?: unknown) => ({
      from: (table: unknown) => {
        if (table === schema.users) {
          return { where: (cond: MockCondition) => Promise.resolve(mockFilterUsers(cond)) };
        }
        if (table === schema.clients) {
          return { where: (cond: MockCondition) => Promise.resolve(mockFilterClients(cond)) };
        }
        if (table === schema.clientBrandKits) {
          return { where: (cond: MockCondition) => Promise.resolve(mockFilterBrandKits(cond)) };
        }
        if (table === schema.agents) {
          return { where: (cond: MockCondition) => Promise.resolve(mockFilterAgents(cond)) };
        }
        if (table === schema.messages) {
          return {
            where: (cond: MockCondition) => ({
              orderBy: () => ({
                limit: (n: number) => Promise.resolve(mockFilterMessages(cond, n)),
              }),
            }),
          };
        }
        if (table === schema.memories) {
          return {
            where: (cond: MockCondition) => ({
              orderBy: () => ({
                limit: (n: number) => Promise.resolve(mockFilterMemories(cond, n)),
              }),
            }),
          };
        }
        if (table === schema.projectFiles) {
          return {
            where: (cond: MockCondition) => ({
              limit: (n: number) => Promise.resolve(mockFilterProjectFiles(cond, n)),
            }),
          };
        }
        throw new Error('mock @desigual-os/database: unexpected table passed to db.select().from()');
      },
    }),
  };

  return { db, schema };
});

function mockFilterUsers(cond: MockCondition) {
  const id = eqValue(cond);
  return mockDb.users.filter((u) => u.id === id).map((u) => ({ name: u.name }));
}

function mockFilterClients(cond: MockCondition) {
  const id = eqValue(cond);
  return mockDb.clients.filter((c) => c.id === id).map((c) => ({ name: c.name }));
}

function mockFilterBrandKits(cond: MockCondition) {
  const clientId = eqValue(cond);
  return mockDb.brandKits.filter((b) => b.clientId === clientId).map((b) => ({ toneOfVoice: b.toneOfVoice }));
}

function mockFilterAgents(cond: MockCondition) {
  const name = eqValue(cond);
  return mockDb.agents.filter((a) => a.name === name).map((a) => ({ id: a.id }));
}

function mockFilterMessages(cond: MockCondition, limit: number) {
  const conversationId = eqValue(cond);
  const matches = mockDb.messages.filter((m) => m.conversationId === conversationId);
  const sorted = [...matches].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return sorted.slice(0, limit).map((m) => ({
    role: m.role,
    agent: m.agent,
    content: m.content,
    attachmentUrl: m.attachmentUrl,
    attachmentFilename: m.attachmentFilename,
    attachmentType: m.attachmentType,
  }));
}

function mockFilterMemories(cond: MockCondition, limit: number) {
  if (cond.op !== 'and' || !cond.conditions) return [];
  const [first, second] = cond.conditions;
  if (!first || !second) return [];

  let matches: FakeMemory[];
  if (second.op === 'eq') {
    // Dossiê do cliente: clientId eq + kind eq 'client.profile'.
    const clientId = eqValue(first);
    const kind = second.value;
    matches = mockDb.memories.filter((m) => m.clientId === clientId && m.kind === kind);
  } else if (second.op === 'ne') {
    // Aprendizados do agente: agentId eq + kind ne 'client.profile'.
    const agentId = eqValue(first);
    const excludedKind = second.value;
    matches = mockDb.memories.filter((m) => m.agentId === agentId && m.kind !== excludedKind);
  } else {
    matches = [];
  }

  const sorted = [...matches].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return sorted.slice(0, limit).map((m) => ({ content: m.content }));
}

function mockFilterProjectFiles(cond: MockCondition, limit: number) {
  if (cond.op !== 'and' || !cond.conditions) return [];
  const [first] = cond.conditions;
  const projectId = first ? eqValue(first) : undefined;
  const matches = mockDb.projectFiles.filter((f) => f.projectId === projectId && f.textContent !== null);
  return matches.slice(0, limit).map((f) => ({ filename: f.filename, kind: f.kind, textContent: f.textContent }));
}

beforeEach(() => {
  mockReset();
});

describe('buildContext - isolamento entre clientes', () => {
  it('nunca traz clientProfile, nome ou tom de voz de outro cliente', async () => {
    mockDb.clients.push({ id: 'client-a', name: 'Cliente A' }, { id: 'client-b', name: 'Cliente B' });
    mockDb.brandKits.push(
      { clientId: 'client-a', toneOfVoice: 'Tom de A' },
      { clientId: 'client-b', toneOfVoice: 'Tom de B' },
    );
    mockDb.memories.push(
      { clientId: 'client-a', agentId: null, kind: 'client.profile', content: 'Dossiê do Cliente A', updatedAt: new Date('2026-01-01') },
      { clientId: 'client-b', agentId: null, kind: 'client.profile', content: 'Dossiê do Cliente B', updatedAt: new Date('2026-01-01') },
    );

    const context = await buildContext({ userId: 'user-1', clientId: 'client-a', conversationId: null });

    expect(context.clientName).toBe('Cliente A');
    expect(context.clientToneOfVoice).toBe('Tom de A');
    expect(context.clientProfile).toBe('Dossiê do Cliente A');
    expect(context.clientName).not.toBe('Cliente B');
    expect(context.clientProfile).not.toContain('Cliente B');
    expect(context.clientToneOfVoice).not.toBe('Tom de B');
  });

  it('nunca traz arquivos de outro projeto (project_files é escopado por projectId)', async () => {
    mockDb.projectFiles.push(
      { projectId: 'project-a', filename: 'briefing-a.txt', kind: 'brief', textContent: 'Conteúdo do projeto A' },
      { projectId: 'project-b', filename: 'briefing-b.txt', kind: 'brief', textContent: 'Conteúdo do projeto B' },
    );

    const context = await buildContext({
      userId: 'user-1',
      clientId: null,
      conversationId: null,
      projectId: 'project-a',
    });

    expect(context.projectFiles).toHaveLength(1);
    expect(context.projectFiles[0]?.filename).toBe('briefing-a.txt');
    expect(context.projectFiles.some((f) => f.filename === 'briefing-b.txt')).toBe(false);
  });

  it('clientId null: não quebra e não traz perfil de cliente nenhum', async () => {
    mockDb.clients.push({ id: 'client-a', name: 'Cliente A' });
    mockDb.memories.push({ clientId: 'client-a', agentId: null, kind: 'client.profile', content: 'Dossiê A', updatedAt: new Date() });

    const context = await buildContext({ userId: 'user-1', clientId: null, conversationId: null });

    expect(context.clientName).toBeNull();
    expect(context.clientToneOfVoice).toBeNull();
    expect(context.clientProfile).toBeNull();
    expect(context.projectFiles).toEqual([]);
  });
});

describe('buildContext - últimas mensagens', () => {
  it('respeita o limite de 5 mensagens e devolve em ordem cronológica (mais antiga primeiro)', async () => {
    const base = new Date('2026-09-08T10:00:00Z').getTime();
    for (let i = 1; i <= 7; i++) {
      mockDb.messages.push({
        conversationId: 'conv-1',
        role: 'user',
        agent: null,
        content: `mensagem ${i}`,
        attachmentUrl: null,
        attachmentFilename: null,
        attachmentType: null,
        createdAt: new Date(base + i * 1000),
      });
    }

    const context = await buildContext({ userId: 'user-1', clientId: null, conversationId: 'conv-1' });

    // As 5 mais recentes são as mensagens 3 a 7; ordem cronológica esperada:
    // 3, 4, 5, 6, 7 (mais antiga primeiro). Se o `.reverse()` em
    // build-context.ts for removido no futuro, a ordem vira 7..3 e este
    // assert pega a regressão.
    expect(context.recentMessages).toHaveLength(5);
    expect(context.recentMessages.map((m) => m.content)).toEqual([
      'mensagem 3',
      'mensagem 4',
      'mensagem 5',
      'mensagem 6',
      'mensagem 7',
    ]);
  });
});

describe('buildContext - anexos no histórico', () => {
  it('mensagem com anexo aparece formatada com a referência ao arquivo; mensagem sem anexo não', async () => {
    mockDb.messages.push(
      {
        conversationId: 'conv-1',
        role: 'user',
        agent: null,
        content: 'olha esse arquivo',
        attachmentUrl: 'https://storage.example.com/f/relatorio.pdf',
        attachmentFilename: 'relatorio.pdf',
        attachmentType: 'application/pdf',
        createdAt: new Date('2026-09-08T10:00:00Z'),
      },
      {
        conversationId: 'conv-1',
        role: 'user',
        agent: null,
        content: 'sem anexo nenhum',
        attachmentUrl: null,
        attachmentFilename: null,
        attachmentType: null,
        createdAt: new Date('2026-09-08T10:00:01Z'),
      },
    );

    const context = await buildContext({ userId: 'user-1', clientId: null, conversationId: 'conv-1' });
    const formatted = formatContextForPrompt(context);

    expect(formatted).toContain('- Usuário: olha esse arquivo [anexo: relatorio.pdf (application/pdf) - https://storage.example.com/f/relatorio.pdf]');
    expect(formatted).toContain('- Usuário: sem anexo nenhum');
    expect(formatted).not.toContain('sem anexo nenhum [anexo:');
  });
});

describe('buildContext - aprendizados recentes do agente', () => {
  it('só traz memórias do agente certo, e nunca kind client.profile', async () => {
    mockDb.agents.push({ id: 'agent-jarbas', name: 'jarbas' }, { id: 'agent-suzy', name: 'suzy' });
    mockDb.memories.push(
      { clientId: null, agentId: 'agent-jarbas', kind: 'campaign.insight', content: 'Aprendizado 1 do jarbas', updatedAt: new Date('2026-09-01') },
      { clientId: null, agentId: 'agent-jarbas', kind: 'campaign.insight', content: 'Aprendizado 2 do jarbas', updatedAt: new Date('2026-09-02') },
      { clientId: null, agentId: 'agent-suzy', kind: 'campaign.insight', content: 'Aprendizado da suzy (não é do jarbas)', updatedAt: new Date('2026-09-03') },
      // kind client.profile pro mesmo agente: tratado à parte, nunca deve entrar em recentLearnings.
      { clientId: 'client-x', agentId: 'agent-jarbas', kind: 'client.profile', content: 'Isso é um dossiê de cliente, não um aprendizado', updatedAt: new Date('2026-09-04') },
    );

    const context = await buildContext({ userId: 'user-1', clientId: null, conversationId: null, agent: 'jarbas' });

    expect(context.recentLearnings).toContain('Aprendizado 1 do jarbas');
    expect(context.recentLearnings).toContain('Aprendizado 2 do jarbas');
    expect(context.recentLearnings.some((l) => l.includes('suzy'))).toBe(false);
    expect(context.recentLearnings.some((l) => l.includes('dossiê de cliente'))).toBe(false);
  });

  it('sem agente decidido (agent ausente), não busca aprendizado nenhum', async () => {
    mockDb.agents.push({ id: 'agent-jarbas', name: 'jarbas' });
    mockDb.memories.push({ clientId: null, agentId: 'agent-jarbas', kind: 'campaign.insight', content: 'Aprendizado do jarbas', updatedAt: new Date() });

    const context = await buildContext({ userId: 'user-1', clientId: null, conversationId: null });

    expect(context.recentLearnings).toEqual([]);
  });
});

describe('formatContextForPrompt', () => {
  it('contexto totalmente vazio devolve string vazia, sem quebrar', () => {
    const formatted = formatContextForPrompt({
      userName: null,
      clientName: null,
      clientToneOfVoice: null,
      clientProfile: null,
      projectFiles: [],
      recentMessages: [],
      recentLearnings: [],
    });

    expect(formatted).toBe('');
  });
});

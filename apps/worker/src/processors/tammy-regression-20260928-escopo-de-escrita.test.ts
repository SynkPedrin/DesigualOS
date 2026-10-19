import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * 28/09/2026, achado com a Tammy no frontend: qualquer alteração de task real
 * voltava "Escrita BLOQUEADA: a task X está na lista Y, fora do escopo de teste".
 *
 * A cerca de QA (`write-scope.ts`, ligada por CLICKUP_TEST_LIST_ID) tem uma
 * válvula de escape prevista pra produção — `writeScope.authorizedForProduction`
 * — que o guard legado monta em duas chamadas. O caminho ATIVO
 * (bento-openai-core, com BENTO_OPENAI_CORE_ENABLED=true) montava o config CRU,
 * sem `writeScope`, então toda escrita dele era tratada como se viesse do bot de
 * QA. A cerca de teste virou cerca de produção.
 *
 * Estes testes travam os dois lados: a pessoa da operação escreve na operação,
 * e o bot de QA continua trancado no cliente de QA.
 */

vi.mock('@desigual-os/bento-core', async () => {
  const actual = await vi.importActual<typeof import('@desigual-os/bento-core')>('@desigual-os/bento-core');
  return { ...actual, proposeBentoAction: vi.fn() };
});
vi.mock('@desigual-os/tool-gateway', async () => {
  const actual = await vi.importActual<typeof import('@desigual-os/tool-gateway')>('@desigual-os/tool-gateway');
  return {
    ...actual,
    createVerifiedSeniorTask: vi.fn(),
    createTaskComment: vi.fn(async () => ({ id: 'c1' })),
    getTaskComments: vi.fn(async () => []),
    uploadTaskAttachment: vi.fn(async () => ({ id: 'a1' })),
    // O membro do ClickUp cujo e-mail está cadastrado no usuário do Desigual OS.
    findMemberByEmail: vi.fn(async (_c: unknown, email: string) =>
      email === 'pedro@institutoalmada.org' ? { id: 1, email, username: 'Pedro Gabriel', profilePicture: null, initials: null, color: null } : null,
    ),
  };
});
vi.mock('./bento-resource-state', () => ({
  loadResourceState: vi.fn(async () => ({
    version: 1, focusedResource: null, selectedResources: [], recentCreatedResources: [],
    recentUpdatedResources: [], lastExecution: null, client: null, assignee: null, dueDate: null,
    sources: [], updatedAt: 'now',
  })),
  persistResourceState: vi.fn(async () => undefined),
  applyExecutionToState: vi.fn((state) => state),
}));
vi.mock('./execution-record', () => ({ loadLatestExecutionState: vi.fn(async () => null), sameExecutionAlreadyDone: vi.fn(() => false) }));
vi.mock('./write-target', () => ({
  resolveWriteTarget: vi.fn(async () => ({ status: 'resolved', clientId: 'c1', clientName: 'Colormaq', listId: 'L1', candidates: [], reason: 'ok' })),
}));
vi.mock('./bento-update-executor', () => ({ executeTaskUpdate: vi.fn() }));
vi.mock('./bento-mcp-executor', () => ({
  selectWriteProvider: vi.fn(async () => ({ provider: 'LEGACY_GATEWAY' })),
  executeViaMcp: vi.fn(),
  parseDueDateMs: () => null,
}));
vi.mock('./briefing-retrieval', () => ({
  retrieveBriefingContext: vi.fn(async () => ({ facts: [], references: [], sourcesConsulted: [] })),
}));

import { proposeBentoAction, type StructuredAction } from '@desigual-os/bento-core';
import { createTaskComment } from '@desigual-os/tool-gateway';
import { executeTaskUpdate } from './bento-update-executor.js';
import { runBentoOpenAiCore } from './bento-openai-core.js';

const fakeLogger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as import('@desigual-os/logging').Logger;
const seniorCtx = { executionId: 'e1', userId: 'u1', organizationId: 'org1', agent: 'bento' as const, permissions: [{ resource: 'clickup', action: 'write' }] };

const UPDATE: StructuredAction = {
  intent: 'update_task',
  target: { resourceType: 'CLICKUP_TASK', resourceId: '86bbz4mc3' },
  changes: { dueDate: '2026-10-02' },
  requestedCardinality: 0,
  reasoning: 'regressão',
};

function rodar(userEmail: string | null, clientName: string) {
  return runBentoOpenAiCore({
    message: 'muda o prazo dessa task pra sexta',
    conversationId: 'conv1', organizationId: 'org1', clientId: 'c1',
    clientName, userEmail, userName: 'quem pediu',
    seniorToolContext: seniorCtx, logger: fakeLogger,
  });
}

describe('tammy-regression-20260928: a cerca de QA não pode trancar a operação', () => {
  beforeEach(() => {
    vi.mocked(proposeBentoAction).mockReset().mockResolvedValue(UPDATE);
    vi.mocked(executeTaskUpdate).mockReset().mockResolvedValue({
      execution_id: '', agent: 'bento', status: 'completed', answer: 'ok',
      sources: [], tool_calls: [], usage: { input_tokens: 0, output_tokens: 0 },
    });
    process.env.BENTO_OPENAI_CORE_ENABLED = 'true';
    process.env.CLICKUP_API_KEY = 'k';
    process.env.CLICKUP_TEAM_ID = 't';
    // A cerca LIGADA é a condição do bug: sem ela o teste não prova nada.
    process.env.CLICKUP_TEST_LIST_ID = '901421333717';
  });

  it('pessoa da operação escreve em task de cliente real — o config carrega a válvula de produção', async () => {
    await rodar('tammy@institutoalmada.org', 'Colormaq');
    expect(vi.mocked(executeTaskUpdate).mock.calls[0]?.[0].config.writeScope).toEqual({ authorizedForProduction: true });
  });

  it('bot de QA continua trancado: sem válvula, a cerca de lista vale pra ele', async () => {
    await rodar('qa-bot@institutoalmada.org', 'Cliente Teste 7');
    expect(vi.mocked(executeTaskUpdate).mock.calls[0]?.[0].config.writeScope).toEqual({ authorizedForProduction: false });
  });

  it('bot de QA em cliente real nem chega a escrever', async () => {
    const r = await rodar('qa-bot@institutoalmada.org', 'Colormaq');
    expect(executeTaskUpdate).not.toHaveBeenCalled();
    expect(r?.status).toBe('failed');
  });
});

describe('auto-atribuição no core: e-mail do ClickUp manda sobre o nome de exibição', () => {
  beforeEach(() => {
    vi.mocked(proposeBentoAction).mockReset().mockResolvedValue({
      ...UPDATE,
      changes: { assignee: 'D. Carvalho' },
    });
    vi.mocked(executeTaskUpdate).mockReset().mockResolvedValue({
      execution_id: '', agent: 'bento', status: 'completed', answer: 'ok',
      sources: [], tool_calls: [], usage: { input_tokens: 0, output_tokens: 0 },
    });
    process.env.BENTO_OPENAI_CORE_ENABLED = 'true';
    process.env.CLICKUP_API_KEY = 'k';
    process.env.CLICKUP_TEAM_ID = 't';
    delete process.env.CLICKUP_TEST_LIST_ID;
  });

  async function pedirAutoAtribuicao(requesterName: string | null, requesterClickUpEmail: string | null) {
    await runBentoOpenAiCore({
      message: 'Agora me coloque também como responsável nessa tarefa',
      conversationId: 'conv1', organizationId: 'org1', clientId: 'c1',
      clientName: 'D. Carvalho', userEmail: 'quem@institutoalmada.org', userName: 'quem pediu',
      requesterName, requesterClickUpEmail,
      seniorToolContext: seniorCtx, logger: fakeLogger,
    });
    return vi.mocked(executeTaskUpdate).mock.calls[0]?.[0].fields.personName;
  }

  it('sem e-mail cadastrado, vale o nome — o caso da Tammy', async () => {
    expect(await pedirAutoAtribuicao('tammy', null)).toBe('tammy');
  });

  it('com e-mail cadastrado, vale o username do ClickUp — a conta "super" é "Pedro Gabriel" lá', async () => {
    expect(await pedirAutoAtribuicao('super', 'pedro@institutoalmada.org')).toBe('Pedro Gabriel');
  });

  it('o nome do cliente NUNCA chega ao ClickUp como responsável', async () => {
    expect(await pedirAutoAtribuicao('tammy', null)).not.toBe('D. Carvalho');
  });
});

describe('identidade e procedência da escrita (relato da Tammy, 28/09/2026)', () => {
  beforeEach(() => {
    vi.mocked(createTaskComment).mockClear();
    vi.mocked(executeTaskUpdate).mockReset().mockResolvedValue({
      execution_id: '', agent: 'bento', status: 'completed', answer: 'ok',
      sources: [], tool_calls: [], usage: { input_tokens: 0, output_tokens: 0 },
      metadata: { verified: true },
    });
    process.env.BENTO_OPENAI_CORE_ENABLED = 'true';
    process.env.CLICKUP_API_KEY = 'chave-da-agencia';
    process.env.CLICKUP_TEAM_ID = 't';
    delete process.env.CLICKUP_TEST_LIST_ID;
    delete process.env.CLICKUP_BOT_API_KEY;
  });

  it('sem CLICKUP_BOT_API_KEY nada muda — segue a chave da agência', async () => {
    vi.mocked(proposeBentoAction).mockReset().mockResolvedValue({ ...UPDATE, changes: { assignee: 'Tammy' } });
    await rodar('tammy@institutoalmada.org', 'D. Carvalho');
    expect(vi.mocked(executeTaskUpdate).mock.calls[0]?.[0].config.apiKey).toBe('chave-da-agencia');
  });

  it('com CLICKUP_BOT_API_KEY, a escrita sai com a identidade do Bento', async () => {
    process.env.CLICKUP_BOT_API_KEY = 'chave-do-bento';
    vi.mocked(proposeBentoAction).mockReset().mockResolvedValue({ ...UPDATE, changes: { assignee: 'Tammy' } });
    await rodar('tammy@institutoalmada.org', 'D. Carvalho');
    expect(vi.mocked(executeTaskUpdate).mock.calls[0]?.[0].config.apiKey).toBe('chave-do-bento');
  });

  it('mudança de responsável deixa rastro de quem pediu na própria task', async () => {
    vi.mocked(proposeBentoAction).mockReset().mockResolvedValue({ ...UPDATE, changes: { assignee: 'Tammy' } });
    await rodar('tammy@institutoalmada.org', 'D. Carvalho');
    const comentario = vi.mocked(createTaskComment).mock.calls[0]?.[2] ?? '';
    expect(comentario).toContain('Responsável');
    expect(comentario).toContain('Tammy');
    expect(comentario).toContain('Bento');
  });
});

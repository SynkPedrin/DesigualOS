import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * tammy-regression-20260928-briefing-vault-anexo — a queixa da operação:
 * "o Bento não está fazendo o básico". A causa era estrutural, não de
 * prompt: com `BENTO_OPENAI_CORE_ENABLED=true`, o caminho ATIVO
 * (bento-openai-core) criava task com a linha curta do planner e
 * `clientName: null` — sem briefing, sem dossiê do cliente (vault) e sem
 * anexar o material que veio no pedido. Toda essa cadeia existia, mas só no
 * caminho legado.
 *
 * Estes testes travam o contrato novo do core:
 *   1. o nome do cliente chega ao planner (é o que dá acesso ao dossiê);
 *   2. a descrição da task é o BRIEFING montado, não a linha do planner;
 *   3. o material do pedido é anexado na task criada;
 *   4. "fecha essa task" vira status de verdade + procedência de quem pediu.
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
  };
});
vi.mock('./bento-action-guard', () => ({
  getClickUpConfigOrNull: vi.fn(() => ({ apiKey: 'k', teamId: 't' })),
  loadSelectionSnapshot: vi.fn(async () => null),
  mapStatusHintToRealStatus: (hint: string, statuses: string[]) =>
    /(pront|conclu|feito|encerr)/i.test(hint)
      ? statuses.find((s: string) => /(pront|conclu|feito|encerr|complet|done|closed)/i.test(s))
      : undefined,
}));
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
  parseDueDateMs: (raw: string) => {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
    return iso ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12).getTime() : null;
  },
}));
// O briefing lê contexto real (dossiê/memória do cliente). Aqui o retrieval é
// mockado pra provar o WIRING — que o core chama a cadeia e usa o resultado —
// sem depender de banco. A cadeia em si tem cobertura própria.
vi.mock('./briefing-retrieval', () => ({
  retrieveBriefingContext: vi.fn(async () => ({
    facts: [
      { field: 'publico', value: 'donas de lavanderia industrial', source: 'dossiê do cliente' },
      { field: 'objetivo', value: 'gerar orçamento no WhatsApp', source: 'dossiê do cliente' },
      { field: 'entregaveis', value: '1 carrossel de 5 slides', source: 'pedido do usuário' },
      { field: 'aprovacao', value: 'peça pronta para publicar', source: 'dossiê do cliente' },
      { field: 'cta', value: 'chamar no WhatsApp', source: 'dossiê do cliente' },
      { field: 'tom', value: 'técnico e direto', source: 'dossiê do cliente' },
      { field: 'mensagem', value: 'manutenção preventiva evita parada', source: 'dossiê do cliente' },
      { field: 'produto', value: 'linha industrial', source: 'dossiê do cliente' },
      { field: 'canal', value: 'Instagram', source: 'dossiê do cliente' },
    ],
    references: [],
    sourcesConsulted: ['pedido do usuário', 'dossiê do cliente'],
  })),
}));

import { proposeBentoAction, type StructuredAction } from '@desigual-os/bento-core';
import { createVerifiedSeniorTask, createTaskComment, uploadTaskAttachment } from '@desigual-os/tool-gateway';
import { executeTaskUpdate } from './bento-update-executor.js';
import { runBentoOpenAiCore } from './bento-openai-core.js';

const fakeLogger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as import('@desigual-os/logging').Logger;
const seniorCtx = { executionId: 'e1', userId: 'u1', organizationId: 'org1', agent: 'bento' as const, permissions: [{ resource: 'clickup', action: 'write' }] };

function act(intent: StructuredAction['intent'], over: Partial<StructuredAction> = {}): StructuredAction {
  return { intent, target: null, changes: null, requestedCardinality: intent === 'create_task' ? 1 : 0, reasoning: 'regressão', ...over };
}

describe('tammy-regression-20260928: o core cria task como a operação precisa', () => {
  beforeEach(() => {
    vi.mocked(proposeBentoAction).mockReset();
    vi.mocked(createVerifiedSeniorTask).mockReset();
    vi.mocked(uploadTaskAttachment).mockClear();
    vi.mocked(createTaskComment).mockClear();
    vi.mocked(createVerifiedSeniorTask).mockResolvedValue({
      success: true, resourceId: 'T1', resourceUrl: 'https://app.clickup.com/t/T1',
      verified: true, data: {} as never, assignedTo: null, wasExisting: false,
    });
    process.env.BENTO_OPENAI_CORE_ENABLED = 'true';
  });

  it('o nome do cliente chega ao planner — era `null` fixo, e sem ele não há dossiê pra consultar', async () => {
    vi.mocked(proposeBentoAction).mockResolvedValue(act('create_task', { changes: { title: 'Carrossel manutenção' } }));

    await runBentoOpenAiCore({
      message: 'cria um carrossel sobre manutenção preventiva',
      conversationId: 'conv1', organizationId: 'org1', clientId: 'c1',
      clientName: 'Colormaq', userName: 'Tammy',
      seniorToolContext: seniorCtx, logger: fakeLogger,
    });

    expect(vi.mocked(proposeBentoAction).mock.calls[0]?.[0].clientName).toBe('Colormaq');
  });

  it('a descrição da task é o BRIEFING estruturado, não a linha curta do planner', async () => {
    vi.mocked(proposeBentoAction).mockResolvedValue(
      act('create_task', { changes: { title: 'Carrossel manutenção', description: 'fazer carrossel' } }),
    );

    await runBentoOpenAiCore({
      message: 'cria um carrossel sobre manutenção preventiva pra Colormaq',
      conversationId: 'conv1', organizationId: 'org1', clientId: 'c1',
      clientName: 'Colormaq', userName: 'Tammy',
      seniorToolContext: seniorCtx, logger: fakeLogger,
    });

    const descricao = vi.mocked(createVerifiedSeniorTask).mock.calls[0]?.[2].description ?? '';
    expect(descricao).not.toBe('fazer carrossel');
    expect(descricao).toContain('# Briefing:');
    // Campos vindos do dossiê do cliente chegam ao executor, que é o ponto:
    // quem for executar recebe objetivo/público, não só o título.
    expect(descricao).toContain('donas de lavanderia industrial');
    expect(descricao).toContain('gerar orçamento no WhatsApp');
  });

  it('o material que veio no pedido é anexado na task criada', async () => {
    vi.mocked(proposeBentoAction).mockResolvedValue(act('create_task', { changes: { title: 'Peça com o print' } }));

    const result = await runBentoOpenAiCore({
      message: 'cria a task com esse print',
      conversationId: 'conv1', organizationId: 'org1', clientId: 'c1',
      clientName: 'Colormaq', userName: 'Tammy',
      attachments: [{ url: 'https://storage/print.png', filename: 'print.png', contentType: 'image/png' }],
      seniorToolContext: seniorCtx, logger: fakeLogger,
    });

    expect(uploadTaskAttachment).toHaveBeenCalledWith(expect.anything(), 'T1', 'https://storage/print.png', 'print.png');
    expect(result?.answer).toContain('anexo');
  });

  it('anexo que falha no upload degrada a resposta, nunca invalida a task', async () => {
    vi.mocked(proposeBentoAction).mockResolvedValue(act('create_task', { changes: { title: 'Peça com o print' } }));
    vi.mocked(uploadTaskAttachment).mockRejectedValueOnce(new Error('ClickUp 413 payload too large'));

    const result = await runBentoOpenAiCore({
      message: 'cria a task com esse print',
      conversationId: 'conv1', organizationId: 'org1', clientId: 'c1',
      clientName: 'Colormaq', userName: 'Tammy',
      attachments: [{ url: 'https://storage/print.png', filename: 'print.png', contentType: 'image/png' }],
      seniorToolContext: seniorCtx, logger: fakeLogger,
    });

    expect(result?.status).toBe('completed');
    expect(result?.answer).toContain('0/1');
  });

  it('"fecha essa task" vira status real + comentário de procedência (destravamento do hard deny)', async () => {
    vi.mocked(proposeBentoAction).mockResolvedValue(
      act('update_task', { target: { resourceType: 'CLICKUP_TASK', resourceId: 'T9' }, changes: { status: 'concluída' } }),
    );
    vi.mocked(executeTaskUpdate).mockResolvedValue({
      execution_id: '', agent: 'bento', status: 'completed', answer: 'ok',
      sources: [], tool_calls: [], usage: { input_tokens: 0, output_tokens: 0 },
    });

    await runBentoOpenAiCore({
      message: 'fecha essa task',
      conversationId: 'conv1', organizationId: 'org1', clientId: 'c1',
      clientName: 'Colormaq', userName: 'Tammy',
      seniorToolContext: seniorCtx, logger: fakeLogger,
    });

    // 1) o hint em português chega ao executor (antes: mapStatus era () => undefined)
    expect(vi.mocked(executeTaskUpdate).mock.calls[0]?.[0].fields.statusHint).toBe('concluída');
    // 2) e o fechamento deixa rastro de QUEM pediu — é o que substitui o deny
    const comentario = vi.mocked(createTaskComment).mock.calls[0]?.[2] ?? '';
    expect(comentario).toContain('Tammy');
    expect(comentario).toContain('concluída');
  });
});

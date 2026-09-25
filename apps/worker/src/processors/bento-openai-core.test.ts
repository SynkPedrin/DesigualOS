import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@desigual-os/bento-core', async () => {
  const actual = await vi.importActual<typeof import('@desigual-os/bento-core')>('@desigual-os/bento-core');
  return { ...actual, proposeBentoAction: vi.fn(), validateBentoAction: vi.fn() };
});
vi.mock('@desigual-os/tool-gateway', async () => {
  const actual = await vi.importActual<typeof import('@desigual-os/tool-gateway')>('@desigual-os/tool-gateway');
  return { ...actual, createVerifiedSeniorTask: vi.fn(), createTaskComment: vi.fn(), getTaskComments: vi.fn() };
});
vi.mock('./bento-action-guard', () => ({ getClickUpConfigOrNull: vi.fn(() => ({ apiKey: 'k', teamId: 't' })) }));
vi.mock('./bento-resource-state', () => ({
  loadResourceState: vi.fn(async () => ({
    version: 1,
    focusedResource: null,
    selectedResources: [],
    recentCreatedResources: [],
    recentUpdatedResources: [],
    lastExecution: null,
    client: null,
    assignee: null,
    dueDate: null,
    sources: [],
    updatedAt: 'now',
  })),
  persistResourceState: vi.fn(async () => undefined),
  applyExecutionToState: vi.fn((state) => state),
}));
vi.mock('./execution-record', () => ({ loadLatestExecutionState: vi.fn(async () => null), sameExecutionAlreadyDone: vi.fn(() => false) }));
vi.mock('./write-target', () => ({
  resolveWriteTarget: vi.fn(async () => ({ status: 'resolved', clientId: 'c1', clientName: 'Cliente', listId: 'L1', candidates: [], reason: 'ok' })),
}));
vi.mock('./bento-update-executor', () => ({ executeTaskUpdate: vi.fn() }));

import { proposeBentoAction, validateBentoAction } from '@desigual-os/bento-core';
import { createVerifiedSeniorTask } from '@desigual-os/tool-gateway';
import { bentoOpenAiCoreEnabled, runBentoOpenAiCore } from './bento-openai-core.js';

const fakeLogger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as import('@desigual-os/logging').Logger;

const seniorCtx = { executionId: 'e1', userId: 'u1', organizationId: 'org1', agent: 'bento' as const, permissions: [{ resource: 'clickup', action: 'write' }] };

describe('bentoOpenAiCoreEnabled', () => {
  it('desligado por padrão (env ausente)', () => {
    delete process.env.BENTO_OPENAI_CORE_ENABLED;
    expect(bentoOpenAiCoreEnabled()).toBe(false);
  });
});

describe('runBentoOpenAiCore', () => {
  beforeEach(() => {
    vi.mocked(proposeBentoAction).mockReset();
    vi.mocked(validateBentoAction).mockReset();
    vi.mocked(createVerifiedSeniorTask).mockReset();
  });

  it('flag desligada: devolve null sem chamar o planner', async () => {
    delete process.env.BENTO_OPENAI_CORE_ENABLED;
    const result = await runBentoOpenAiCore({ message: 'oi', conversationId: 'conv1', organizationId: null, clientId: null, seniorToolContext: null, logger: fakeLogger });
    expect(result).toBeNull();
    expect(proposeBentoAction).not.toHaveBeenCalled();
  });

  it('flag ligada, sem seniorToolContext: falha explícita, nunca executa a escrita', async () => {
    process.env.BENTO_OPENAI_CORE_ENABLED = 'true';
    vi.mocked(proposeBentoAction).mockResolvedValue({ intent: 'create_task', target: null, changes: { title: 'X' }, requestedCardinality: 1, reasoning: 'r' });
    const result = await runBentoOpenAiCore({ message: 'cria uma task X', conversationId: 'conv1', organizationId: null, clientId: null, seniorToolContext: null, logger: fakeLogger });
    expect(result?.status).toBe('failed');
    expect(createVerifiedSeniorTask).not.toHaveBeenCalled();
    delete process.env.BENTO_OPENAI_CORE_ENABLED;
  });

  it('flag ligada, policy bloqueia: não chama o executor', async () => {
    process.env.BENTO_OPENAI_CORE_ENABLED = 'true';
    vi.mocked(proposeBentoAction).mockResolvedValue({ intent: 'create_task', target: null, changes: { title: 'X' }, requestedCardinality: 0, reasoning: 'r' });
    vi.mocked(validateBentoAction).mockReturnValue({ allowed: false, reason: 'cardinalidade bloqueada', cardinality: { requestedCardinality: 0, plannedCardinality: 1, executedCardinality: 0, blocked: true, blockReason: 'x' }, resolvedResourceId: null });
    const result = await runBentoOpenAiCore({ message: 'cria uma task X', conversationId: 'conv1', organizationId: null, clientId: null, seniorToolContext: seniorCtx, logger: fakeLogger });
    expect(result?.status).toBe('failed');
    expect(createVerifiedSeniorTask).not.toHaveBeenCalled();
    delete process.env.BENTO_OPENAI_CORE_ENABLED;
  });

  it('flag ligada, create_task aprovado: executa via createVerifiedSeniorTask (LEGACY_GATEWAY) e reporta sucesso', async () => {
    process.env.BENTO_OPENAI_CORE_ENABLED = 'true';
    vi.mocked(proposeBentoAction).mockResolvedValue({ intent: 'create_task', target: null, changes: { title: 'Post X' }, requestedCardinality: 1, reasoning: 'r' });
    vi.mocked(validateBentoAction).mockReturnValue({ allowed: true, reason: 'ok', cardinality: { requestedCardinality: 1, plannedCardinality: 1, executedCardinality: 0, blocked: false, blockReason: null }, resolvedResourceId: null });
    vi.mocked(createVerifiedSeniorTask).mockResolvedValue({ success: true, resourceId: 'T1', resourceUrl: 'https://clickup/T1', verified: true, data: {} as never, assignedTo: null, wasExisting: false });

    const result = await runBentoOpenAiCore({ message: 'cria uma task X', conversationId: 'conv1', organizationId: 'org1', clientId: 'c1', seniorToolContext: seniorCtx, logger: fakeLogger });
    expect(result?.status).toBe('completed');
    expect(createVerifiedSeniorTask).toHaveBeenCalledTimes(1);
    const envelope = (result?.metadata as { write_envelope?: { provider?: string; resourceIds?: string[] } })?.write_envelope;
    expect(envelope?.provider).toBe('LEGACY_GATEWAY');
    expect(envelope?.resourceIds).toEqual(['T1']);
    delete process.env.BENTO_OPENAI_CORE_ENABLED;
  });
});

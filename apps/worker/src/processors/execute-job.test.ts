import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@desigual-os/logging';

/**
 * execute-job.ts é o pipeline inteiro de execução (800+ linhas), acoplado a
 * banco, filas BullMQ e rede real pros agentes. Este arquivo NÃO tenta
 * testar processAgentJob/processSingleAgentJob/processWorkflowStep fim a
 * fim (isso exigiria recriar o banco inteiro) - foca nas três funções que
 * são lógica isolável e de maior risco: buildNodeUrl (monta a URL de
 * dispatch), callBento e callAgentesDesigual (Jarbas/Suzy - inclui a
 * barreira de aprovação humana adicionada em 08/09/2026).
 *
 * buildNodeUrl/callBento/callAgentesDesigual não eram exportadas; ganharam
 * `export` (só a palavra-chave, nenhuma mudança de lógica) especificamente
 * pra viabilizar este teste.
 */

// db/schema não são tocados por nenhuma das 3 funções testadas aqui, mas
// precisam existir pra o módulo importar sem estourar (o client real de
// @desigual-os/database exige DATABASE_URL, que não está setada em teste).
vi.mock('@desigual-os/database', () => ({ db: {}, schema: {} }));

// Mock leve do orchestrator: só os valores que callAgentesDesigual/callBento
// realmente leem (AGENT_TIMEOUT_MS). O resto vira vi.fn() só pra satisfazer
// a resolução do módulo (processAgentJob e as funções de workflow usam,
// mas não são exercitadas aqui).
vi.mock('@desigual-os/orchestrator', () => ({
  AGENT_TIMEOUT_MS: { bento: 120_000, jarbas: 180_000, suzy: 180_000, studio: 900_000, otto: 300_000 },
  AGENT_MAX_ATTEMPTS: { bento: 2, jarbas: 1, suzy: 1, studio: 2, otto: 2 },
  PRIORITY_VALUE: { P0: 1, P1: 2, P2: 3, P3: 4 },
  findHealthyNodeForAgent: vi.fn(),
  finalizeExecutionCost: vi.fn(),
  generateStudioJobId: vi.fn(),
  getAgentQueue: vi.fn(),
  getStudioJobQueue: vi.fn(),
  publishWsEvent: vi.fn(),
  recordCostEvent: vi.fn(),
  recordLearning: vi.fn(),
}));

const mockAskAgent = vi.fn();
const mockAskBentoQA = vi.fn();
const mockRequestToolCall = vi.fn();

vi.mock('@desigual-os/tool-gateway', () => ({
  askAgent: mockAskAgent,
  askBentoQA: mockAskBentoQA,
  requestToolCall: mockRequestToolCall,
  AgentAskError: class AgentAskError extends Error {
    kind: string;
    constructor(message: string, kind: string) {
      super(message);
      this.name = 'AgentAskError';
      this.kind = kind;
    }
  },
  BentoQAError: class BentoQAError extends Error {
    kind: string;
    constructor(message: string, kind: string) {
      super(message);
      this.name = 'BentoQAError';
      this.kind = kind;
    }
  },
}));

function fakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

describe('buildNodeUrl', () => {
  it('acrescenta a porta padrão 4001 quando o host não tem porta', async () => {
    const { buildNodeUrl } = await import('./execute-job.js');
    expect(buildNodeUrl('100.107.198.50')).toBe('http://100.107.198.50:4001');
  });

  it('não acrescenta porta quando o host já traz uma (dev, vários nodes fake na mesma máquina)', async () => {
    const { buildNodeUrl } = await import('./execute-job.js');
    expect(buildNodeUrl('localhost:4102')).toBe('http://localhost:4102');
  });

  it('não valida/sanitiza o host - um host malformado (com espaço) ainda produz uma URL inválida', async () => {
    // Documenta o comportamento atual: buildNodeUrl é um formatador puro,
    // não uma validação. O bug histórico (nodes.private_host guardando o
    // label "Jarbas (Mac Mini)" em vez do host de verdade) foi corrigido na
    // ORIGEM (agent-sync.ts), não aqui. Isto não é uma regressão nova, mas
    // fica registrado pra quem for mexer aqui de novo não assumir validação
    // que não existe.
    const { buildNodeUrl } = await import('./execute-job.js');
    expect(buildNodeUrl('Jarbas (Mac Mini)')).toBe('http://Jarbas (Mac Mini):4001');
  });
});

describe('studioResolutionForAspectRatio', () => {
  it('traduz proporções do OTTO para resoluções reais na grade do Studio', async () => {
    const { studioResolutionForAspectRatio } = await import('./execute-job.js');
    expect(studioResolutionForAspectRatio('4:5')).toBe('1088x1360');
    expect(studioResolutionForAspectRatio('16:9')).toBe('1536x864');
    expect(studioResolutionForAspectRatio('9:16')).toBe('1088x1920');
  });

  it('preserva resolução explícita e usa retrato seguro para valor desconhecido', async () => {
    const { studioResolutionForAspectRatio } = await import('./execute-job.js');
    expect(studioResolutionForAspectRatio('1344x896')).toBe('1344x896');
    expect(studioResolutionForAspectRatio('cinema')).toBe('1088x1360');
  });
});

describe('callBento', () => {
  const logger = fakeLogger();

  afterEach(() => {
    vi.unstubAllEnvs();
    mockAskBentoQA.mockReset();
  });

  it('devolve failed com mensagem clara quando BENTO_QA_TOKEN não está configurado (não lança, não chama askBentoQA)', async () => {
    vi.stubEnv('BENTO_QA_TOKEN', '');
    const { callBento } = await import('./execute-job.js');

    const result = await callBento('oi bento', logger);

    expect(result.status).toBe('failed');
    expect(result.answer).toBeNull();
    expect(result.error).toContain('BENTO_QA_TOKEN not configured');
    expect(mockAskBentoQA).not.toHaveBeenCalled();
  });

  it('devolve completed com a resposta e as fontes quando o bento-qa responde', async () => {
    vi.stubEnv('BENTO_QA_TOKEN', 'token-teste');
    mockAskBentoQA.mockResolvedValue({
      text: 'O horário de atendimento é 9h-18h.',
      citations: [{ n: 1, path: 'sops/atendimento.md' }],
    });
    const { callBento } = await import('./execute-job.js');

    const result = await callBento('qual o horário?', logger);

    expect(result.status).toBe('completed');
    expect(result.answer).toBe('O horário de atendimento é 9h-18h.');
    expect(result.sources).toEqual(['sops/atendimento.md']);
  });

  it('devolve failed (não lança) quando askBentoQA rejeita com BentoQAError', async () => {
    vi.stubEnv('BENTO_QA_TOKEN', 'token-teste');
    const { callBento } = await import('./execute-job.js');
    const { BentoQAError } = await import('@desigual-os/tool-gateway');
    mockAskBentoQA.mockRejectedValue(new BentoQAError('o Bento não respondeu em 100s', 'timeout'));

    const result = await callBento('oi', logger);

    expect(result.status).toBe('failed');
    expect(result.error).toBe('o Bento não respondeu em 100s');
  });
});

describe('callAgentesDesigual (Jarbas/Suzy)', () => {
  const logger = fakeLogger();

  beforeEach(() => {
    vi.stubEnv('AGENTES_ASK_TOKEN', 'token-teste');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    mockAskAgent.mockReset();
    mockRequestToolCall.mockReset();
  });

  it('devolve failed sem chamar askAgent quando AGENTES_ASK_TOKEN não está configurado', async () => {
    vi.stubEnv('AGENTES_ASK_TOKEN', '');
    const { callAgentesDesigual } = await import('./execute-job.js');

    const result = await callAgentesDesigual('jarbas', 'oi', 'session-1', 'exec-1', logger);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('AGENTES_ASK_TOKEN not configured');
    expect(mockAskAgent).not.toHaveBeenCalled();
  });

  it('caminho normal (sem bloco de aprovação): devolve a resposta como veio, sem interceptar nada', async () => {
    mockAskAgent.mockResolvedValue('Tudo certo, a campanha está performando bem esta semana.');
    const { callAgentesDesigual } = await import('./execute-job.js');

    const result = await callAgentesDesigual('jarbas', 'como está a campanha?', 'session-1', 'exec-1', logger);

    expect(result.status).toBe('completed');
    expect(result.answer).toBe('Tudo certo, a campanha está performando bem esta semana.');
    expect(mockRequestToolCall).not.toHaveBeenCalled();
    expect(mockAskAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'jarbas', token: 'token-teste', timeoutMs: 180_000 }),
      'como está a campanha?',
      'session-1',
    );
  });

  it('[AGUARDA_APROVACAO]: NÃO devolve o texto cru como resposta liberada - intercepta via requestToolCall', async () => {
    const rawAnswer =
      'Vou ajustar o budget. [AGUARDA_APROVACAO]Proposta de mudar budget pra R$5000[/AGUARDA_APROVACAO] Aguardo o ok.';
    mockAskAgent.mockResolvedValue(rawAnswer);
    mockRequestToolCall.mockResolvedValue({ status: 'pending_approval', toolCallId: 'tc-123' });
    const { callAgentesDesigual } = await import('./execute-job.js');

    const result = await callAgentesDesigual('jarbas', 'aumenta o budget', 'session-1', 'exec-1', logger);

    // Foi pro Tool Gateway de verdade com a proposta extraída do bloco.
    expect(mockRequestToolCall).toHaveBeenCalledWith({
      executionId: 'exec-1',
      agent: 'jarbas',
      tool: 'meta_ads',
      input: { proposal: 'Proposta de mudar budget pra R$5000', session_id: 'session-1' },
    });
    // A resposta NÃO é o texto cru do agente como se já estivesse aprovado.
    expect(result.answer).not.toBe(rawAnswer);
    expect(result.answer?.toLowerCase()).toContain('aprovação');
    expect(result.answer).toContain('tc-123');
    expect(result.status).toBe('completed');
    expect(result.metadata).toEqual({ pending_tool_call_id: 'tc-123', pending_tool_call_status: 'pending_approval' });
  });

  it('[AGUARDA_APROVACAO] negado pela matriz de permissões: resposta explica a falta de permissão, não finge aprovação', async () => {
    const rawAnswer = '[AGUARDA_APROVACAO]Publicar story promocional[/AGUARDA_APROVACAO]';
    mockAskAgent.mockResolvedValue(rawAnswer);
    mockRequestToolCall.mockResolvedValue({ status: 'denied', toolCallId: 'tc-999' });
    const { callAgentesDesigual } = await import('./execute-job.js');

    const result = await callAgentesDesigual('suzy', 'posta isso', 'session-2', 'exec-2', logger);

    expect(result.answer?.toLowerCase()).toContain('permissão');
    expect(result.answer).toContain('tc-999');
    expect(result.status).toBe('completed');
  });

  it('vazamento interno (looksLikeInternalLeak): "No response from OpenClaw" vira failed, não resposta normal', async () => {
    mockAskAgent.mockResolvedValue('No response from OpenClaw.');
    const { callAgentesDesigual } = await import('./execute-job.js');

    const result = await callAgentesDesigual('jarbas', 'oi', 'session-1', 'exec-1', logger);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('problema interno');
    expect(mockRequestToolCall).not.toHaveBeenCalled();
  });

  it('askAgent lançando AgentAskError vira failed com a mensagem do erro (não propaga a exceção)', async () => {
    const { AgentAskError } = await import('@desigual-os/tool-gateway');
    mockAskAgent.mockRejectedValue(new AgentAskError('a Suzy não respondeu em 180s', 'timeout'));
    const { callAgentesDesigual } = await import('./execute-job.js');

    const result = await callAgentesDesigual('suzy', 'oi', 'session-1', 'exec-1', logger);

    expect(result.status).toBe('failed');
    expect(result.error).toBe('a Suzy não respondeu em 180s');
  });
});

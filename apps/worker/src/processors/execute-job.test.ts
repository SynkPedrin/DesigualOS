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

// Mock PARCIAL pelo mesmo motivo do workflow-consolidation: o grafo de import
// do agentic-dispatch cresce (ciclo de ação autônoma, cerca de escopo) e um
// mock total obrigaria a redeclarar cada símbolo novo aqui.
vi.mock('@desigual-os/tool-gateway', async (importOriginal) => ({
  ...(await importOriginal<typeof import("@desigual-os/tool-gateway")>()),
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

  it('resposta que é SÓ a diretiva interna `pergunta pro bento:` vira failed, não jargão na tela', async () => {
    // Medido em teste real (2026-09-11): a Suzy respondeu ao usuário com a
    // sintaxe interna de handoff pro Bento em backticks.
    mockAskAgent.mockResolvedValue('`pergunta pro bento: quais são as tarefas abertas da 3net?`');
    const { callAgentesDesigual } = await import('./execute-job.js');

    const result = await callAgentesDesigual('suzy', 'oi', 'session-1', 'exec-1', logger);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('mecanismo interno');
    expect(mockRequestToolCall).not.toHaveBeenCalled();
  });

  it('diretiva interna embutida numa resposta válida é removida e o resto segue normal', async () => {
    mockAskAgent.mockResolvedValue(
      'Claro! Sobre as tarefas, deixa eu verificar. `pergunta pro bento: tarefas da 3net`\n\nEnquanto isso, posso adiantar o relatório.',
    );
    const { callAgentesDesigual } = await import('./execute-job.js');

    const result = await callAgentesDesigual('suzy', 'oi', 'session-1', 'exec-1', logger);

    expect(result.status).toBe('completed');
    expect(result.answer).not.toContain('pergunta pro bento');
    expect(result.answer).toContain('Claro!');
    expect(result.answer).toContain('relatório');
  });

  it('o segundo formato vazado (`cria uma task no clickup:`) também é removido', async () => {
    // Baseline de comportamento, Onda 0 caso s2 (13/09/2026): a Suzy vazou a
    // ordem interna de criação de task em backticks no meio da resposta.
    mockAskAgent.mockResolvedValue(
      'Perfeito, vou organizar isso pra você. `cria uma task no clickup: revisar carrossel da Elite`\n\nJá te confirmo assim que estiver lá.',
    );
    const { callAgentesDesigual } = await import('./execute-job.js');

    const result = await callAgentesDesigual('suzy', 'cria essa task', 'session-1', 'exec-1', logger);

    expect(result.status).toBe('completed');
    expect(result.answer).not.toContain('cria uma task no clickup');
    expect(result.answer).toContain('Perfeito');
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

/**
 * Regressão do defeito relatado em 11/09/2026 ("o Bento não está conseguindo
 * gerar nenhuma resposta"): o motivo verdadeiro da falha existia, vinha
 * preenchido em `result.error`, e era descartado antes de chegar na tela -
 * o usuário recebia "Tente reformular a pergunta" enquanto o problema real
 * era um HTTP 502 do bento-qa ("o motor de texto não respondeu em 30s").
 */
describe('failureAnswerFor', () => {
  it('repassa o motivo real do agente em vez de culpar a pergunta', async () => {
    const { failureAnswerFor } = await import('./execute-job.js');

    expect(failureAnswerFor('bento', 'HTTP 502')).toBe('Não consegui responder agora: HTTP 502');
    expect(failureAnswerFor('bento', 'o Bento não respondeu em 100s')).toBe(
      'Não consegui responder agora: o Bento não respondeu em 100s',
    );
  });

  it('agente que falhou sem informar motivo diz exatamente isso, e nomeia quem falhou', async () => {
    const { failureAnswerFor } = await import('./execute-job.js');

    expect(failureAnswerFor('bento', undefined)).toBe('Não consegui responder agora e Bento não informou o motivo.');
    expect(failureAnswerFor('jarbas', null)).toBe('Não consegui responder agora e Jarbas não informou o motivo.');
    expect(failureAnswerFor('suzy', '   ')).toBe('Não consegui responder agora e Suzy não informou o motivo.');
  });
});

describe('parseAgentLoopFlag (AGENT_LOOP_V2 por agente)', () => {
  // A flag v2 liga o loop agêntico por agente. Jarbas é golden agent
  // (read-only): ele NUNCA entra no loop, nem com "true", nem nomeado.
  it('desligado por default (ausente, vazio, false)', async () => {
    const { parseAgentLoopFlag } = await import('./execute-job.js');
    expect(parseAgentLoopFlag(undefined).size).toBe(0);
    expect(parseAgentLoopFlag('').size).toBe(0);
    expect(parseAgentLoopFlag('false').size).toBe(0);
  });

  it('"true" liga todos EXCETO jarbas', async () => {
    const { parseAgentLoopFlag } = await import('./execute-job.js');
    const enabled = parseAgentLoopFlag('true');
    expect(enabled.has('bento')).toBe(true);
    expect(enabled.has('suzy')).toBe(true);
    expect(enabled.has('otto')).toBe(true);
    expect(enabled.has('jarbas')).toBe(false);
  });

  it('lista explícita com jarbas ainda o exclui', async () => {
    const { parseAgentLoopFlag } = await import('./execute-job.js');
    const enabled = parseAgentLoopFlag('jarbas,bento');
    expect(enabled.has('jarbas')).toBe(false);
    expect(enabled.has('bento')).toBe(true);
  });

  it('ignora nomes desconhecidos', async () => {
    const { parseAgentLoopFlag } = await import('./execute-job.js');
    expect(parseAgentLoopFlag('bento,fulano').size).toBe(1);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regressão de dois defeitos reais do workflow multi-agente, achados em 10/09/2026:
 *  1. a resposta final era a do ÚLTIMO agente e as etapas anteriores eram descartadas
 *     (workflow de 4 etapas entregava 1/4 do trabalho);
 *  2. a mensagem de cada etapa era a anterior + a resposta anterior, CUMULATIVA e sem teto
 *     — e o único workflow existente termina no Bento, cujo backend usa a mensagem inteira
 *     como consulta vetorial.
 */

interface FakeStep {
  stepIndex: number;
  agent: string;
  output: { answer?: string } | null;
  status?: string;
  input?: { message?: string } | null;
}

let fakeSteps: FakeStep[] = [];
/** stepIndex pedido na cláusula where (quando houve filtro por índice). */
let requestedStepIndex: number | null = null;

vi.mock('drizzle-orm', () => ({
  eq: (col: { __col?: string }, value: unknown) => ({ op: 'eq', col: col?.__col, value }),
  and: (...conds: unknown[]) => ({ op: 'and', conds }),
}));

vi.mock('@desigual-os/database', () => {
  const schema = {
    executionSteps: {
      executionId: { __col: 'executionId' },
      stepIndex: { __col: 'stepIndex' },
      agent: { __col: 'agent' },
      output: { __col: 'output' },
      status: { __col: 'status' },
      input: { __col: 'input' },
    },
  };
  const db = {
    select: () => ({
      from: () => ({
        where: (cond: { op: string; conds?: Array<{ col?: string; value?: unknown }> }) => {
          requestedStepIndex = null;
          if (cond?.op === 'and') {
            const stepCond = cond.conds?.find((c) => c?.col === 'stepIndex');
            if (stepCond) requestedStepIndex = stepCond.value as number;
          }
          const rows =
            requestedStepIndex === null
              ? fakeSteps
              : fakeSteps.filter((s) => s.stepIndex === requestedStepIndex);
          return Promise.resolve(rows);
        },
      }),
    }),
  };
  return { db, schema };
});

// Dependências pesadas do módulo que não importam pra estas duas funções puras-de-DB.
vi.mock('@desigual-os/orchestrator', () => ({
  AGENT_TIMEOUT_MS: {},
  AGENT_MAX_ATTEMPTS: {},
  PRIORITY_VALUE: {},
  findHealthyNodeForAgent: vi.fn(),
  finalizeExecutionCost: vi.fn(),
  generateStudioJobId: vi.fn(),
  getAgentQueue: vi.fn(),
  getStudioJobQueue: vi.fn(),
  publishWsEvent: vi.fn(),
  recordCostEvent: vi.fn(),
  recordLearning: vi.fn(),
}));
// Mock PARCIAL: só o que este teste precisa fingir; o resto vem do módulo
// real. Com mock total, qualquer símbolo novo importado por outro arquivo do
// grafo derrubava esta suíte por "export não definido no mock".
vi.mock('@desigual-os/tool-gateway', async (importOriginal) => ({
  ...(await importOriginal<typeof import("@desigual-os/tool-gateway")>()),
  askBentoQA: vi.fn(),
  BentoQAError: class extends Error {},
  askAgent: vi.fn(),
  AgentAskError: class extends Error {},
  requestToolCall: vi.fn(),
  recordToolResult: vi.fn(),
}));

const { buildChainedMessage, consolidateWorkflowAnswer } = await import('./execute-job');

beforeEach(() => {
  fakeSteps = [];
  requestedStepIndex = null;
});

describe('consolidateWorkflowAnswer', () => {
  it('junta TODAS as contribuições, não só a do último agente', async () => {
    fakeSteps = [
      { stepIndex: 0, agent: 'bento', output: { answer: 'Contexto da 3Net: contrato anual.' } },
      { stepIndex: 1, agent: 'jarbas', output: { answer: 'CPA em R$ 12, dentro da meta.' } },
      { stepIndex: 2, agent: 'studio', output: { answer: '3 criativos gerados.' } },
    ];
    const r = await consolidateWorkflowAnswer('exec-1', ['bento', 'jarbas', 'studio'], '3 criativos gerados.');
    expect(r).toContain('contrato anual');
    expect(r).toContain('CPA em R$ 12');
    expect(r).toContain('3 criativos gerados');
    expect(r).toMatch(/bento/);
    expect(r).toMatch(/jarbas/);
  });

  it('agente repetido na definição (bento->jarbas->studio->bento): vale a ÚLTIMA passagem dele', async () => {
    fakeSteps = [
      { stepIndex: 0, agent: 'bento', output: { answer: 'Levantamento inicial.' } },
      { stepIndex: 1, agent: 'jarbas', output: { answer: 'Leitura de mídia.' } },
      { stepIndex: 2, agent: 'studio', output: { answer: 'Peças prontas.' } },
      { stepIndex: 3, agent: 'bento', output: { answer: 'Fechamento consolidado do plano.' } },
    ];
    const r = await consolidateWorkflowAnswer('exec-1', ['bento', 'jarbas', 'studio', 'bento'], 'Fechamento consolidado do plano.');
    expect(r).toContain('Fechamento consolidado do plano');
    expect(r).not.toContain('Levantamento inicial');
    // o bento aparece uma vez só, na posição final da definição
    expect(r.match(/\(bento\)/g)).toHaveLength(1);
  });

  it('uma contribuição só devolve o texto puro, sem cabeçalho de seção', async () => {
    fakeSteps = [{ stepIndex: 0, agent: 'otto', output: { answer: 'Conceito: menos é mais.' } }];
    const r = await consolidateWorkflowAnswer('exec-1', ['otto'], 'Conceito: menos é mais.');
    expect(r).toBe('Conceito: menos é mais.');
  });

  it('sem nada legível no banco, cai no fallback e nunca devolve vazio', async () => {
    fakeSteps = [{ stepIndex: 0, agent: 'bento', output: null }];
    const r = await consolidateWorkflowAnswer('exec-1', ['bento'], 'resposta da última etapa');
    expect(r).toBe('resposta da última etapa');
  });

  it('etapa sem texto é ignorada em vez de virar seção vazia', async () => {
    fakeSteps = [
      { stepIndex: 0, agent: 'bento', output: { answer: 'Tem conteúdo.' } },
      { stepIndex: 1, agent: 'jarbas', output: { answer: '   ' } },
    ];
    const r = await consolidateWorkflowAnswer('exec-1', ['bento', 'jarbas'], null);
    expect(r).toBe('Tem conteúdo.');
    expect(r).not.toMatch(/jarbas/);
  });
});

describe('buildChainedMessage', () => {
  it('NÃO acumula: a pergunta original volta a ser a primeira linha', async () => {
    fakeSteps = [
      { stepIndex: 0, agent: 'bento', output: { answer: 'A' }, input: { message: 'Crie uma campanha para a 3Net' } },
    ];
    const msg = await buildChainedMessage({
      executionDbId: 'exec-1',
      originalMessage: 'Crie uma campanha para a 3Net\n\n---\nContexto:\nlixo enorme aqui',
      currentStepIndex: 0,
      currentAgent: 'bento',
      currentAnswer: 'Contexto institucional levantado.',
      nextAgent: 'jarbas',
    });
    expect(msg.startsWith('Crie uma campanha para a 3Net')).toBe(true);
    expect(msg).not.toContain('lixo enorme');
    expect(msg).toContain('Contexto institucional levantado.');
    expect(msg).toContain('tráfego e performance');
  });

  it('limita a 3 contribuições anteriores (não cresce sem teto)', async () => {
    fakeSteps = [
      { stepIndex: 0, agent: 'bento', output: { answer: 'primeira-contribuicao' }, input: { message: 'pergunta base' } },
      { stepIndex: 1, agent: 'jarbas', output: { answer: 'segunda-contribuicao' } },
      { stepIndex: 2, agent: 'suzy', output: { answer: 'terceira-contribuicao' } },
      { stepIndex: 3, agent: 'otto', output: { answer: 'quarta-contribuicao' } },
    ];
    const msg = await buildChainedMessage({
      executionDbId: 'exec-1',
      originalMessage: 'pergunta base',
      currentStepIndex: 4,
      currentAgent: 'otto',
      currentAnswer: 'quinta-contribuicao',
      nextAgent: 'studio',
    });
    expect(msg).not.toContain('primeira-contribuicao');
    expect(msg).toContain('quinta-contribuicao');
    expect(msg).toContain('quarta-contribuicao');
  });

  it('trunca contribuição longa em vez de arrastar texto inteiro pra próxima etapa', async () => {
    const gigante = 'x'.repeat(5000);
    fakeSteps = [{ stepIndex: 0, agent: 'bento', output: { answer: gigante }, input: { message: 'p' } }];
    const msg = await buildChainedMessage({
      executionDbId: 'exec-1',
      originalMessage: 'p',
      currentStepIndex: 1,
      currentAgent: 'jarbas',
      currentAnswer: null,
      nextAgent: 'studio',
    });
    expect(msg.length).toBeLessThan(2500);
  });

  it('primeira etapa sem contribuição nenhuma devolve só a pergunta', async () => {
    fakeSteps = [{ stepIndex: 0, agent: 'bento', output: null, input: { message: 'so a pergunta' } }];
    const msg = await buildChainedMessage({
      executionDbId: 'exec-1',
      originalMessage: 'so a pergunta',
      currentStepIndex: 0,
      currentAgent: 'bento',
      currentAnswer: null,
      nextAgent: 'jarbas',
    });
    expect(msg).toBe('so a pergunta');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * §46/§47 — os cenários obrigatórios do guard.
 *
 * O módulo @desigual-os/otto-motion é mockado inteiro: aqui o que se prova é
 * a PONTE (quando o guard assume o turno, quando devolve null, o que ele faz
 * com erro), não o motor. O motor tem os testes dele em packages/otto-motion.
 */
const mocks = vi.hoisted(() => ({
  ottoMotionEnabled: vi.fn(() => true),
  detectMotionIntent: vi.fn(),
  // Tipado explicitamente: `vi.fn(async () => null)` inferiria o retorno como
  // `null` e o teste de iteração não conseguiria devolver uma sessão.
  findConversationMotion: vi.fn<(conversationId: string) => Promise<unknown>>(async () => null),
  createMotion: vi.fn(),
  updateMotion: vi.fn(),
}));

vi.mock('@desigual-os/otto-motion', async () => {
  const real = await vi.importActual<typeof import('@desigual-os/otto-motion')>('@desigual-os/otto-motion');
  return {
    ...real,
    ottoMotionEnabled: mocks.ottoMotionEnabled,
    detectMotionIntent: mocks.detectMotionIntent,
    findConversationMotion: mocks.findConversationMotion,
    createMotion: mocks.createMotion,
    updateMotion: mocks.updateMotion,
  };
});

const { tryMotionGuard } = await import('./motion-guard');
const { MotionModelUnavailableError, MotionError } = await import('@desigual-os/otto-motion');

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
} as unknown as import('@desigual-os/logging').Logger;

function params(overrides: Partial<Parameters<typeof tryMotionGuard>[0]> = {}) {
  return {
    agent: 'otto' as const,
    message: 'faz um motion de 15 segundos pra campanha',
    executionId: 'exec-1',
    conversationId: 'conv-1',
    clientId: 'client-1',
    userId: 'user-1',
    projectId: null,
    attachments: [],
    logger,
    ...overrides,
  };
}

const sessionFixture = {
  id: 'motion-1',
  clientId: 'client-1',
  conversationId: 'conv-1',
  projectId: null,
  requestedBy: 'user-1',
  workspacePath: '/tmp/motion-1',
  status: 'queued' as const,
  stageDetail: null,
  prompt: 'faz um motion',
  durationSeconds: 15,
  fps: 30 as const,
  width: 1080,
  height: 1920,
  format: '9:16' as const,
  model: 'claude-opus-5-5',
  renderVersion: 0,
  error: null,
  errorCode: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  mocks.ottoMotionEnabled.mockReturnValue(true);
  mocks.detectMotionIntent.mockReturnValue({ kind: 'create', reason: 'teste', durationSeconds: 15, format: undefined, fps: undefined });
  mocks.findConversationMotion.mockResolvedValue(null);
  mocks.createMotion.mockResolvedValue(sessionFixture);
  mocks.updateMotion.mockResolvedValue(sessionFixture);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('A — Motion Engine desativado (§47-A, §46)', () => {
  it('devolve null antes de qualquer outra coisa', async () => {
    mocks.ottoMotionEnabled.mockReturnValue(false);
    expect(await tryMotionGuard(params())).toBeNull();
  });

  it('não classifica, não consulta o banco e não cria nada', async () => {
    mocks.ottoMotionEnabled.mockReturnValue(false);
    await tryMotionGuard(params());
    expect(mocks.detectMotionIntent).not.toHaveBeenCalled();
    expect(mocks.findConversationMotion).not.toHaveBeenCalled();
    expect(mocks.createMotion).not.toHaveBeenCalled();
  });
});

describe('fronteira do agente', () => {
  it.each(['bento', 'jarbas', 'suzy', 'studio'] as const)('não toca no turno do %s', async (agent) => {
    expect(await tryMotionGuard(params({ agent }))).toBeNull();
    expect(mocks.createMotion).not.toHaveBeenCalled();
  });

  it('turno do Otto que não é motion segue o caminho normal', async () => {
    mocks.detectMotionIntent.mockReturnValue(null);
    expect(await tryMotionGuard(params({ message: 'escreve a legenda do post' }))).toBeNull();
  });
});

describe('B/D — provider fora do ar (§47-B, §47-D)', () => {
  it('Opus 5.5 indisponível vira resposta explicada, nunca um modelo menor', async () => {
    mocks.createMotion.mockRejectedValue(new MotionModelUnavailableError('CLI 2.1.263'));
    const result = await tryMotionGuard(params());
    expect(result?.status).toBe('completed');
    expect(result?.answer).toContain('Opus 5.5');
    expect(result?.metadata?.motion_error).toBe('OPUS_UNAVAILABLE');
    // Não abriu sessão nenhuma: nada de motion pela metade.
    expect(result?.metadata?.motion).toBeUndefined();
  });

  it('Claude desconectado também vira resposta, não exceção', async () => {
    mocks.createMotion.mockRejectedValue(
      new MotionError('PROVIDER_DISCONNECTED', 'O Claude Code está instalado, mas sem conta conectada.'),
    );
    const result = await tryMotionGuard(params());
    expect(result?.metadata?.motion_error).toBe('PROVIDER_DISCONNECTED');
  });

  it('erro inesperado NÃO sobe — subir faria o BullMQ recriar o motion no retry', async () => {
    mocks.createMotion.mockRejectedValue(new Error('boom'));
    const result = await tryMotionGuard(params());
    expect(result?.status).toBe('completed');
    expect(result?.metadata?.motion_error).toBe('INTERNAL');
  });
});

describe('C/G — motion novo (§47-C, §47-G)', () => {
  it('cria a sessão e devolve o bloco que a UI usa pro player', async () => {
    const result = await tryMotionGuard(params());
    expect(mocks.createMotion).toHaveBeenCalledOnce();
    expect(result?.metadata?.motion).toMatchObject({ motion_id: 'motion-1', format: '9:16', duration_seconds: 15 });
  });

  it('repassa a duração que a classificação leu do pedido', async () => {
    await tryMotionGuard(params());
    expect(mocks.createMotion.mock.calls[0]?.[0]).toMatchObject({ durationSeconds: 15 });
  });

  it('sem cliente selecionado, explica e NÃO abre sessão', async () => {
    const result = await tryMotionGuard(params({ clientId: null }));
    expect(mocks.createMotion).not.toHaveBeenCalled();
    expect(result?.metadata?.motion_blocked).toBe('no_client');
    expect(result?.answer).toContain('cliente');
  });
});

describe('H — edição de motion existente (§47-H, §17, §43)', () => {
  beforeEach(() => {
    mocks.findConversationMotion.mockResolvedValue(sessionFixture);
    mocks.detectMotionIntent.mockReturnValue({ kind: 'update', reason: 'ajuste', durationSeconds: undefined, format: undefined, fps: undefined });
  });

  it('edita o projeto existente em vez de criar outro', async () => {
    const result = await tryMotionGuard(params({ message: 'o CTA precisa entrar antes' }));
    expect(mocks.updateMotion).toHaveBeenCalledOnce();
    expect(mocks.createMotion).not.toHaveBeenCalled();
    expect(result?.metadata?.motion_intent).toBe('update');
  });

  it('manda a instrução crua pro motor, sem reinterpretar', async () => {
    await tryMotionGuard(params({ message: 'deixa o preço entrar mais forte' }));
    expect(mocks.updateMotion.mock.calls[0]?.[0]).toMatchObject({
      motionId: 'motion-1',
      instruction: 'deixa o preço entrar mais forte',
    });
  });

  it('anexos do turno viram referências da sessão (§33)', async () => {
    const attachments = [{ url: 'https://x/ref.png', filename: 'ref.png', contentType: 'image/png' }];
    await tryMotionGuard(params({ attachments }));
    expect(mocks.updateMotion.mock.calls[0]?.[0]).toMatchObject({ references: attachments });
  });
});

describe('resiliência da ponte', () => {
  it('banco fora do ar na consulta da sessão não derruba o turno', async () => {
    mocks.findConversationMotion.mockRejectedValue(new Error('connection refused'));
    mocks.detectMotionIntent.mockReturnValue(null);
    expect(await tryMotionGuard(params())).toBeNull();
  });

  it('conversa nova (sem id) ainda consegue criar motion', async () => {
    const result = await tryMotionGuard(params({ conversationId: null }));
    expect(mocks.findConversationMotion).not.toHaveBeenCalled();
    expect(result?.metadata?.motion).toBeDefined();
  });
});

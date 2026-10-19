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
  summarizeClientContext: vi.fn(),
  // extractCampaignBriefFromMessage bate na OpenAI de verdade (chat-first,
  // adendo de release) — NUNCA pode rodar sem mock numa suíte unitária.
  // Default `null` preserva o comportamento anterior a este mock existir:
  // cai pro card, byte a byte, em todo teste que não sobrescrever isto.
  extractCampaignBriefFromMessage: vi.fn<() => Promise<unknown>>(async () => null),
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
    summarizeClientContext: mocks.summarizeClientContext,
    extractCampaignBriefFromMessage: mocks.extractCampaignBriefFromMessage,
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

// Briefing mínimo válido (contrato do card): o que separa "criar de verdade"
// de "pedir o briefing" desde que o guard passou a exigir o card preenchido.
const briefFixture = {
  campaignName: 'Campanha de Setembro',
  objective: 'Gerar leads',
};

const summaryFixture = {
  clientName: 'Fratelli',
  hasBrandKit: true,
  logoUrl: 'https://storage/logo.png',
  colors: ['#111111'],
  fonts: ['Work Sans'],
  images: 7,
  videos: 2,
  totalAssets: 9,
  hasBrain: true,
};

beforeEach(() => {
  mocks.ottoMotionEnabled.mockReturnValue(true);
  mocks.detectMotionIntent.mockReturnValue({ kind: 'create', reason: 'teste', durationSeconds: 15, format: undefined, fps: undefined });
  mocks.findConversationMotion.mockResolvedValue(null);
  mocks.createMotion.mockResolvedValue(sessionFixture);
  mocks.updateMotion.mockResolvedValue(sessionFixture);
  mocks.summarizeClientContext.mockResolvedValue(summaryFixture);
  mocks.extractCampaignBriefFromMessage.mockResolvedValue(null);
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
    const result = await tryMotionGuard(params({ brief: briefFixture }));
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
    const result = await tryMotionGuard(params({ brief: briefFixture }));
    expect(result?.metadata?.motion_error).toBe('PROVIDER_DISCONNECTED');
  });

  it('erro inesperado NÃO sobe — subir faria o BullMQ recriar o motion no retry', async () => {
    mocks.createMotion.mockRejectedValue(new Error('boom'));
    const result = await tryMotionGuard(params({ brief: briefFixture }));
    expect(result?.status).toBe('completed');
    expect(result?.metadata?.motion_error).toBe('INTERNAL');
  });
});

describe('C/G — motion novo COM briefing (§47-C, §47-G)', () => {
  it('cria a sessão e devolve o bloco que a UI usa pro player', async () => {
    const result = await tryMotionGuard(params({ brief: briefFixture }));
    expect(mocks.createMotion).toHaveBeenCalledOnce();
    expect(result?.metadata?.motion).toMatchObject({ motion_id: 'motion-1', format: '9:16', duration_seconds: 15 });
  });

  it('repassa o briefing do card pro motor, byte a byte', async () => {
    await tryMotionGuard(params({ brief: briefFixture }));
    expect(mocks.createMotion.mock.calls[0]?.[0]).toMatchObject({ brief: briefFixture });
  });

  it('o ack cita a campanha do briefing', async () => {
    const result = await tryMotionGuard(params({ brief: briefFixture }));
    expect(result?.answer).toContain('Campanha de Setembro');
  });

  it('repassa a duração que a classificação leu do pedido', async () => {
    await tryMotionGuard(params({ brief: briefFixture }));
    expect(mocks.createMotion.mock.calls[0]?.[0]).toMatchObject({ durationSeconds: 15 });
  });

  it('sem cliente selecionado MAS com briefing já com direção (§AD_HOC): cria mesmo assim, sem pedir cliente', async () => {
    // Mudança de comportamento intencional (adendo chat-first, regra nova):
    // clientId deixou de ser obrigatório quando o pedido já tem contexto —
    // um brief com direção real conta como contexto suficiente.
    const result = await tryMotionGuard(params({ clientId: null, brief: briefFixture }));
    expect(mocks.createMotion).toHaveBeenCalledOnce();
    expect(mocks.createMotion.mock.calls[0]?.[0]).toMatchObject({ clientId: null, brief: briefFixture });
    expect(result?.metadata?.motion_blocked).toBeUndefined();
  });
});

describe('pedido de briefing — create SEM card preenchido', () => {
  it('NÃO abre sessão: responde com o pedido de briefing que a web usa pra desenhar o card', async () => {
    const result = await tryMotionGuard(params());
    expect(mocks.createMotion).not.toHaveBeenCalled();
    expect(result?.metadata?.fast_path).toBe('motion_request');
    expect(result?.metadata?.motion_intent).toBe('create');
    expect(result?.metadata?.motion_brief_request).toMatchObject({ client_id: 'client-1' });
    expect(result?.metadata?.motion).toBeUndefined();
  });

  it('o prefill carrega o que a detecção leu da frase (duração, formato, fps)', async () => {
    mocks.detectMotionIntent.mockReturnValue({ kind: 'create', reason: 'teste', durationSeconds: 20, format: '16:9', fps: 60 });
    const result = await tryMotionGuard(params());
    expect(result?.metadata?.motion_brief_request).toMatchObject({
      prefill: { duration: 20, aspectRatio: '16:9', fps: 60 },
    });
  });

  it('a resposta apresenta o que já existe do cliente', async () => {
    const result = await tryMotionGuard(params());
    expect(mocks.summarizeClientContext).toHaveBeenCalledWith('client-1');
    expect(result?.answer).toContain('Fratelli');
    expect(result?.answer).toContain('7 imagens');
    expect(result?.answer).toContain('informações desta campanha');
  });

  it('falha no resumo degrada pra texto genérico sem quebrar o turno', async () => {
    mocks.summarizeClientContext.mockRejectedValue(new Error('connection refused'));
    const result = await tryMotionGuard(params());
    expect(result?.status).toBe('completed');
    expect(result?.metadata?.motion_brief_request).toBeDefined();
    expect(result?.answer).not.toContain('Fratelli');
    expect(result?.answer).toContain('informações desta campanha');
  });

  it('cliente sem material nenhum ainda recebe o card', async () => {
    mocks.summarizeClientContext.mockResolvedValue({
      ...summaryFixture,
      hasBrandKit: false,
      logoUrl: null,
      images: 0,
      videos: 0,
      totalAssets: 0,
      hasBrain: false,
    });
    const result = await tryMotionGuard(params());
    expect(result?.metadata?.motion_brief_request).toBeDefined();
    expect(result?.answer).toContain('ainda não tem material');
  });

  it('sem cliente, sem anexo e sem direção nenhuma no texto: bloqueia pedindo mais contexto (não abre o card, que depende de cliente)', async () => {
    const result = await tryMotionGuard(params({ clientId: null }));
    expect(result?.metadata?.motion_blocked).toBe('insufficient_context');
    expect(result?.metadata?.motion_brief_request).toBeUndefined();
    expect(mocks.createMotion).not.toHaveBeenCalled();
  });
});

describe('CHAT-FIRST — extração automática de briefing (adendo release, sem formulário)', () => {
  it('extração com direção suficiente: cria direto, NUNCA abre o card', async () => {
    mocks.extractCampaignBriefFromMessage.mockResolvedValue({
      campaignName: 'Expo Agro',
      objective: 'Vender agora',
      offer: { price: 'R$ 400.000' },
      tone: 'Premium / cinematográfico',
    });
    const result = await tryMotionGuard(params({ message: 'Crie um motion promocional muito forte para venda de um trator John Deere. Valor: R$ 400.000.' }));

    expect(mocks.createMotion).toHaveBeenCalledOnce();
    expect(mocks.createMotion.mock.calls[0]?.[0]).toMatchObject({ brief: { campaignName: 'Expo Agro' } });
    expect(result?.metadata?.motion_brief_request).toBeUndefined();
    expect(result?.metadata?.motion).toBeDefined();
  });

  it('os anexos do MESMO turno chegam no createMotion — nunca se perdem pra um turno de card', async () => {
    mocks.extractCampaignBriefFromMessage.mockResolvedValue({ campaignName: 'Expo Agro', objective: 'Vender agora' });
    const attachments = [
      { url: 'https://x/trator.jpg', filename: 'trator.jpg', contentType: 'image/jpeg' },
      { url: 'https://x/logo.png', filename: 'logo_johndeere.png', contentType: 'image/png' },
      { url: 'https://x/campo.jpg', filename: 'campo.jpg', contentType: 'image/jpeg' },
    ];
    await tryMotionGuard(params({ message: 'motion do trator com essas imagens', attachments }));

    expect(mocks.createMotion.mock.calls[0]?.[0]).toMatchObject({ references: attachments });
  });

  it('a resposta lista as referências visuais detectadas quando há anexos', async () => {
    mocks.extractCampaignBriefFromMessage.mockResolvedValue({ campaignName: 'Expo Agro', objective: 'Vender agora' });
    const attachments = [{ url: 'https://x/trator.jpg', filename: 'trator.jpg', contentType: 'image/jpeg' }];
    const result = await tryMotionGuard(params({ attachments }));
    expect(result?.answer).toContain('Referências visuais detectadas');
    expect(result?.answer).toContain('trator.jpg');
  });

  it('extração sem direção nenhuma (texto vago): cai pro card, comportamento anterior preservado', async () => {
    mocks.extractCampaignBriefFromMessage.mockResolvedValue({});
    const result = await tryMotionGuard(params({ message: 'faz um motion' }));
    expect(mocks.createMotion).not.toHaveBeenCalled();
    expect(result?.metadata?.motion_brief_request).toBeDefined();
  });

  it('falha na extração (ex: sem credencial OpenAI): cai pro card, nunca quebra o turno', async () => {
    mocks.extractCampaignBriefFromMessage.mockResolvedValue(null);
    const result = await tryMotionGuard(params({ message: 'faz um motion' }));
    expect(mocks.createMotion).not.toHaveBeenCalled();
    expect(result?.metadata?.motion_brief_request).toBeDefined();
  });

  it('brief já vindo do card (formulário) continua tendo prioridade — nunca chama a extração', async () => {
    await tryMotionGuard(params({ brief: briefFixture }));
    expect(mocks.extractCampaignBriefFromMessage).not.toHaveBeenCalled();
  });
});

describe('AD_HOC — motion sem cliente selecionado (adendo "cliente não pode ficar acima dos anexos")', () => {
  it('CASO OBRIGATÓRIO: sem cliente + prompt completo + 3 anexos → cria direto, NUNCA pede cliente, NUNCA abre card', async () => {
    mocks.extractCampaignBriefFromMessage.mockResolvedValue({
      objective: 'Anunciar e valorizar a venda do trator',
      offer: { name: 'Trator John Deere', price: 'R$ 400.000' },
      tone: 'Premium, cinematográfico',
    });
    const attachments = [
      { url: 'https://x/trator.jpg', filename: 'trator.jpg', contentType: 'image/jpeg' },
      { url: 'https://x/logo.png', filename: 'logo.png', contentType: 'image/png' },
      { url: 'https://x/campo.jpg', filename: 'campo.jpg', contentType: 'image/jpeg' },
    ];
    const result = await tryMotionGuard(
      params({
        clientId: null,
        attachments,
        message:
          'Crie um motion promocional para venda deste trator John Deere por R$ 400.000 para a Expo Agro. Use obrigatoriamente as imagens anexadas. Formato 9:16, 15 segundos, premium e cinematográfico.',
      }),
    );

    expect(result?.metadata?.motion_blocked).toBeUndefined();
    expect(result?.metadata?.motion_brief_request).toBeUndefined();
    expect(mocks.createMotion).toHaveBeenCalledOnce();
    const call = mocks.createMotion.mock.calls[0]?.[0];
    expect(call).toMatchObject({ clientId: null, references: attachments });
    expect(result?.metadata?.motion).toBeDefined();
  });

  it('sem cliente, mas com anexos (mesmo que a extração de texto não ache direção): ainda cria ad-hoc, nunca pede cliente', async () => {
    mocks.extractCampaignBriefFromMessage.mockResolvedValue({}); // sem direção nenhuma
    const attachments = [{ url: 'https://x/produto.jpg', filename: 'produto.jpg', contentType: 'image/jpeg' }];
    const result = await tryMotionGuard(params({ clientId: null, attachments, message: 'faz um motion com essa imagem' }));

    expect(result?.metadata?.motion_blocked).toBeUndefined();
    expect(mocks.createMotion).toHaveBeenCalledOnce();
    expect(mocks.createMotion.mock.calls[0]?.[0]).toMatchObject({ clientId: null, references: attachments });
  });

  it('sem cliente, sem anexo, mas com direção real no texto: ainda cria ad-hoc, nunca pede cliente', async () => {
    mocks.extractCampaignBriefFromMessage.mockResolvedValue({ objective: 'Vender agora', offer: { price: 'R$ 99' } });
    const result = await tryMotionGuard(params({ clientId: null, message: 'motion pra vender por R$ 99' }));

    expect(result?.metadata?.motion_blocked).toBeUndefined();
    expect(mocks.createMotion).toHaveBeenCalledOnce();
    expect(mocks.createMotion.mock.calls[0]?.[0]).toMatchObject({ clientId: null });
  });

  it('não gera cliente falso: sem cliente e SEM nenhum contexto, bloqueia pedindo mais informação, nunca infere um cliente', async () => {
    mocks.extractCampaignBriefFromMessage.mockResolvedValue(null);
    const result = await tryMotionGuard(params({ clientId: null, message: 'faz um motion' }));

    expect(mocks.createMotion).not.toHaveBeenCalled();
    expect(result?.metadata?.motion_blocked).toBe('insufficient_context');
    expect(result?.answer).not.toContain('Cliente Teste');
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
    const result = await tryMotionGuard(params({ conversationId: null, brief: briefFixture }));
    expect(mocks.findConversationMotion).not.toHaveBeenCalled();
    expect(result?.metadata?.motion).toBeDefined();
  });
});

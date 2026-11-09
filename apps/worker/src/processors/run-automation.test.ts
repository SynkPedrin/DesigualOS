import { describe, expect, it, vi } from 'vitest';

const linhas = vi.hoisted(() => ({ fila: [] as unknown[][] }));
vi.mock('@desigual-os/database', () => {
  const consulta = { from: () => consulta, where: async () => linhas.fila.shift() ?? [] };
  return { db: { select: () => consulta }, schema: { automations: {}, automationRuns: {} } };
});
vi.mock('drizzle-orm', () => ({ and: vi.fn(), eq: vi.fn(), isNotNull: vi.fn(), isNull: vi.fn() }));
vi.mock('@desigual-os/orchestrator', () => ({ dispatchChatMessage: vi.fn(), touchConversation: vi.fn() }));
vi.mock('@desigual-os/tool-gateway', async (importOriginal) => {
  const { formatarParaWhatsapp } = await importOriginal<typeof import('@desigual-os/tool-gateway')>();
  return { enviarPeloBento: vi.fn(), formatarParaWhatsapp };
});

describe('mensagemDaAutomacao', () => {
  const CONTEXTO = 'Usuário: Pedro\nHistórico: Bento: qual delas você quer que eu mova pra sexta?';

  /**
   * O caso de produção de 13/10/2026: o histórico colado trazia "delas" e
   * "mova pra sexta", e as travas do Bento barravam a automação toda hora.
   */
  it('Bento recebe só o prompt da automação, sem o bloco colado', async () => {
    const { mensagemDaAutomacao } = await import('./run-automation');
    expect(mensagemDaAutomacao('Resumo das tarefas atrasadas da agência', 'bento', CONTEXTO)).toBe(
      'Resumo das tarefas atrasadas da agência',
    );
  });

  it('a mesma regra do chat vale para Otto, Jarbas e Suzy', async () => {
    const { mensagemDaAutomacao } = await import('./run-automation');
    for (const agente of ['otto', 'jarbas', 'suzy'] as const) {
      expect(mensagemDaAutomacao('pedido', agente, CONTEXTO)).toBe('pedido');
    }
  });

  it('o Studio, que não tem outro canal de contexto, continua recebendo o bloco', async () => {
    const { mensagemDaAutomacao } = await import('./run-automation');
    expect(mensagemDaAutomacao('pedido', 'studio', CONTEXTO)).toBe(`pedido\n\n---\nContexto:\n${CONTEXTO}`);
    expect(mensagemDaAutomacao('pedido', 'studio', '')).toBe('pedido');
  });
});

describe('entregarAutomacaoNoWhatsapp', () => {
  const logger = { info: vi.fn(), warn: vi.fn() } as never;
  const AUTOMACAO = { id: 'a1', name: 'Briefing da manhã', whatsappPhone: '5518991652039' };
  const esperar = async () => undefined;

  it('disparo da automação vai para o número dela, com título e chave por execução', async () => {
    const { entregarAutomacaoNoWhatsapp } = await import('./run-automation');
    linhas.fila = [[AUTOMACAO], [{ id: 'run1' }]];
    const enviar = vi.fn(async () => ({ ok: true as const, messageId: 'm1' }));
    await entregarAutomacaoNoWhatsapp(
      { conversationId: 'c1', executionId: 'EXE-1', answer: '**3 tarefas** atrasadas', falhou: false },
      logger,
      { enviar, esperar },
    );
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(enviar).toHaveBeenCalledWith({
      phone: '5518991652039',
      text: '*Automação “Briefing da manhã”*\n\n*3 tarefas* atrasadas',
      idempotencyKey: 'automacao:EXE-1:0',
    });
  });

  it('conversa à mão na conversa da automação (sem run) não vai para o celular', async () => {
    const { entregarAutomacaoNoWhatsapp } = await import('./run-automation');
    linhas.fila = [[AUTOMACAO], [], []];
    const enviar = vi.fn();
    await entregarAutomacaoNoWhatsapp({ conversationId: 'c1', executionId: 'EXE-2', answer: 'oi', falhou: false }, logger, { enviar, esperar });
    expect(enviar).not.toHaveBeenCalled();
  });

  it('run gravado depois da resposta: a segunda olhada entrega', async () => {
    const { entregarAutomacaoNoWhatsapp } = await import('./run-automation');
    linhas.fila = [[AUTOMACAO], [], [{ id: 'run1' }]];
    const enviar = vi.fn(async () => ({ ok: true as const, messageId: 'm1' }));
    await entregarAutomacaoNoWhatsapp({ conversationId: 'c1', executionId: 'EXE-3', answer: 'pronto', falhou: false }, logger, { enviar, esperar });
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it('automação sem WhatsApp não envia nada', async () => {
    const { entregarAutomacaoNoWhatsapp } = await import('./run-automation');
    linhas.fila = [[]];
    const enviar = vi.fn();
    await entregarAutomacaoNoWhatsapp({ conversationId: 'c1', executionId: 'EXE-4', answer: 'pronto', falhou: false }, logger, { enviar, esperar });
    expect(enviar).not.toHaveBeenCalled();
  });

  it('canal do Bento desligado não derruba o turno', async () => {
    const { entregarAutomacaoNoWhatsapp } = await import('./run-automation');
    linhas.fila = [[AUTOMACAO], [{ id: 'run1' }]];
    const enviar = vi.fn(async () => ({ ok: false as const, motivo: 'canal_desligado' as const, erro: 'desligado', repetivel: true }));
    await expect(
      entregarAutomacaoNoWhatsapp({ conversationId: 'c1', executionId: 'EXE-5', answer: 'pronto', falhou: false }, logger, { enviar, esperar }),
    ).resolves.toBeUndefined();
  });
});

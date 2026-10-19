import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@desigual-os/tool-gateway', async () => {
  const actual = await vi.importActual<typeof import('@desigual-os/tool-gateway')>('@desigual-os/tool-gateway');
  return { ...actual, createVerifiedSeniorTask: vi.fn() };
});

import { createVerifiedSeniorTask } from '@desigual-os/tool-gateway';
import { executarCampanha, pedeSegmentacaoDeCampanha } from './bento-campanha-executor';

/**
 * A metade perigosa deste caminho não é decompor errado — alguém corrige. É
 * criar N tasks quando ninguém pediu N, e é criar METADE da campanha deixando
 * o resto invisível. Estes testes travam as duas.
 */

const fakeLogger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as import('@desigual-os/logging').Logger;
const ctx = { executionId: 'e1', userId: 'u1', organizationId: 'org1', agent: 'bento' as const, permissions: [{ resource: 'clickup', action: 'write' }] };

function escritorComFrentes(frentes: Array<{ funcao: string; titulo: string; responsavel?: string }>) {
  return vi.fn(async () =>
    JSON.stringify({ frentes: frentes.map((f) => ({ ...f, briefing: 'Contexto suficiente pra executar sem ler as outras tasks.' })) }),
  );
}

function rodar(escritor: ReturnType<typeof escritorComFrentes>, env?: NodeJS.ProcessEnv) {
  return executarCampanha({
    mensagem: 'divide a campanha de outubro entre a equipe',
    clientName: 'Colormaq', listId: 'L1',
    config: { apiKey: 'k', teamId: 't' }, seniorToolContext: ctx,
    escritor, logger: fakeLogger, env: env ?? ({} as NodeJS.ProcessEnv),
  });
}

describe('o gatilho é explícito — falso positivo aqui vira 5 tasks indevidas', () => {
  it.each([
    'divide a campanha de outubro entre a equipe',
    'segmenta essa demanda e lança pra cada função',
    'quebra o projeto e distribui pro time',
    'cria uma task pra cada responsável',
  ])('%s -> segmenta', (m) => {
    expect(pedeSegmentacaoDeCampanha(m)).toBe(true);
  });

  it.each([
    'cria a task do carrossel pro Gui',
    'muda o prazo dessa task pra amanhã',
    'me lista as tarefas da campanha de outubro',
    'faz o briefing da campanha',
  ])('%s -> NÃO segmenta', (m) => {
    expect(pedeSegmentacaoDeCampanha(m)).toBe(false);
  });
});

describe('perguntar vem antes de criar', () => {
  beforeEach(() => vi.mocked(createVerifiedSeniorTask).mockReset());

  it('faltando dono de UMA frente, NENHUMA task é criada', async () => {
    // redação e vídeo têm dono declarado; tráfego não tem ninguém.
    const r = await rodar(escritorComFrentes([
      { funcao: 'redacao', titulo: 'Copy dos posts' },
      { funcao: 'trafego', titulo: 'Subir anúncios' },
    ]));
    expect(createVerifiedSeniorTask).not.toHaveBeenCalled();
    expect(r?.pergunta).toContain('Tráfego');
    expect(r?.criadas).toEqual([]);
  });

  it('com todos os donos resolvidos, cria uma task por frente com o briefing DELA', async () => {
    let n = 0;
    vi.mocked(createVerifiedSeniorTask).mockImplementation(async () => {
      n += 1;
      return { success: true, resourceId: `id-${n}`, resourceUrl: `https://app.clickup.com/t/${n}`, verified: true, data: {} as never, assignedTo: null, wasExisting: false };
    });
    const r = await rodar(escritorComFrentes([
      { funcao: 'redacao', titulo: 'Copy dos posts' },
      { funcao: 'video', titulo: 'Edição do reels' },
    ]));
    expect(createVerifiedSeniorTask).toHaveBeenCalledTimes(2);
    const chamadas = vi.mocked(createVerifiedSeniorTask).mock.calls.map((c) => c[2]);
    expect(chamadas.map((i) => i.assigneeName)).toEqual(['Matheus Sain', 'Celso de Andrade Guimarães']);
    // cada uma leva um briefing próprio, não o texto da campanha inteira
    for (const i of chamadas) expect(i.description.length).toBeGreaterThan(20);
    expect(r?.criadas).toHaveLength(2);
    expect(r?.resposta).toContain('cada uma com o briefing dela');
  });

  it('pessoa NOMEADA no pedido ganha do registro declarado', async () => {
    vi.mocked(createVerifiedSeniorTask).mockResolvedValue({
      success: true, resourceId: 'x', resourceUrl: 'u', verified: true, data: {} as never, assignedTo: null, wasExisting: false,
    });
    await rodar(escritorComFrentes([{ funcao: 'redacao', titulo: 'Copy', responsavel: 'Jamile Galdino' }]));
    expect(vi.mocked(createVerifiedSeniorTask).mock.calls[0]?.[2].assigneeName).toBe('Jamile Galdino');
  });

  it('falha numa frente não apaga as que deram certo, e é dita', async () => {
    vi.mocked(createVerifiedSeniorTask)
      .mockResolvedValueOnce({ success: true, resourceId: 'a', resourceUrl: 'ua', verified: true, data: {} as never, assignedTo: null, wasExisting: false })
      .mockResolvedValueOnce({ success: false, errorCode: 'write_failed', message: 'ClickUp 500', retryable: true } as never);
    const r = await rodar(escritorComFrentes([
      { funcao: 'redacao', titulo: 'Copy' },
      { funcao: 'video', titulo: 'Edição' },
    ]));
    expect(r?.criadas).toHaveLength(1);
    expect(r?.resposta).toContain('não saiu');
    expect(r?.resposta).toContain('ClickUp 500');
  });

  it('nada segmentável devolve null — o turno segue pelo caminho normal', async () => {
    const r = await rodar(vi.fn(async () => '{"frentes":[]}'));
    expect(r).toBeNull();
    expect(createVerifiedSeniorTask).not.toHaveBeenCalled();
  });
});

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMotionRef } from './motion-card';
import { assetSummaryParts, MotionCard, motionDownloadFilename, pickVersionUrl } from './motion-card';
import type { MotionStatusWire, MotionVersionWire } from '@/hooks/use-motion';
import type { ConversationMessageWire } from '@/lib/api/contracts';
import { mapConversationMessage } from '@/lib/api/contracts';

/**
 * O GET /motion/:id é mockado no nível do apiFetch: o que se prova no bloco
 * "montado" é o ESTADO DE ERRO do card (OPUS_UNAVAILABLE, contrato 24/09/2026),
 * não a rede.
 */
const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', () => ({ apiFetch: apiFetchMock }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
  apiFetchMock.mockReset();
  vi.useRealTimers();
});

/**
 * O que precisa ser verdade pro player sobreviver a um F5: o bloco `motion`
 * vem da metadata da MENSAGEM persistida, não de estado local do React.
 */
function wire(overrides: Partial<ConversationMessageWire> = {}): ConversationMessageWire {
  return {
    id: 'msg-1',
    role: 'assistant',
    agent: 'otto',
    content: 'Vou fazer.',
    attachment_url: null,
    attachment_type: null,
    attachment_filename: null,
    attachments: [],
    created_at: '2026-09-24T12:00:00.000Z',
    ...overrides,
  };
}

const motion: ChatMotionRef = {
  motion_id: 'motion-1',
  status: 'queued',
  format: '9:16',
  duration_seconds: 15,
  fps: 30,
  width: 1080,
  height: 1920,
};

describe('motion na mensagem persistida', () => {
  it('o bloco atravessa o mapeamento intacto', () => {
    expect(mapConversationMessage(wire({ motion })).motion).toEqual(motion);
  });

  it('mensagem sem motion fica com null, não undefined — a UI testa por truthiness', () => {
    expect(mapConversationMessage(wire()).motion).toBeNull();
  });

  it('mensagem antiga (de antes do Motion Engine) não quebra', () => {
    const antiga = wire();
    delete (antiga as { motion?: unknown }).motion;
    expect(mapConversationMessage(antiga).motion).toBeNull();
  });

  it('motion e anexos convivem no mesmo balão', () => {
    const mapeada = mapConversationMessage(
      wire({ motion, attachments: [{ url: 'https://x/ref.png', filename: 'ref.png', contentType: 'image/png' }] }),
    );
    expect(mapeada.motion).toEqual(motion);
    expect(mapeada.attachments).toHaveLength(1);
  });
});

describe('motion_brief_request na mensagem persistida', () => {
  const briefRequest = {
    client_id: 'client-1',
    prefill: { campaignName: 'Verão 2027', duration: 20, fps: 30 as const, aspectRatio: '9:16' },
  };

  it('atravessa o mapeamento intacto (prefill camelCase preservado)', () => {
    expect(mapConversationMessage(wire({ motion_brief_request: briefRequest })).motionBriefRequest).toEqual(
      briefRequest,
    );
  });

  it('mensagem sem pedido de briefing fica com null, não undefined', () => {
    expect(mapConversationMessage(wire()).motionBriefRequest).toBeNull();
  });
});

describe('versões do motion', () => {
  const versions: MotionVersionWire[] = [
    { version: 1, quality: 'preview', url: 'https://x/v1-preview.mp4', createdAt: '2026-09-24T10:00:00.000Z' },
    { version: 2, quality: 'preview', url: 'https://x/v2-preview.mp4', createdAt: '2026-09-24T11:00:00.000Z' },
    { version: 2, quality: 'final', url: 'https://x/v2-final.mp4', createdAt: '2026-09-24T11:05:00.000Z' },
  ];

  it('prefere o render final da versão', () => {
    expect(pickVersionUrl(versions, 2)).toBe('https://x/v2-final.mp4');
  });

  it('cai pro preview quando a versão não tem final', () => {
    expect(pickVersionUrl(versions, 1)).toBe('https://x/v1-preview.mp4');
  });

  it('versão inexistente (ou sem URL publicada) devolve null — o card cai pro finalUrl atual', () => {
    expect(pickVersionUrl(versions, 9)).toBeNull();
    expect(pickVersionUrl([{ version: 3, quality: 'final', url: null, createdAt: '' }], 3)).toBeNull();
  });
});

describe('nome do arquivo de download', () => {
  it('slug minúsculo, sem acento, sem espaço', () => {
    expect(motionDownloadFilename('Açaí do João', 'Coleção Verão 2027', 2)).toBe(
      'acai-do-joao-colecao-verao-2027-motion-v2.mp4',
    );
  });

  it('sem campanha, só o cliente', () => {
    expect(motionDownloadFilename('Fratelli', null, 1)).toBe('fratelli-motion-v1.mp4');
  });

  it('sem nada, fallback cliente-motion-v<N>.mp4', () => {
    expect(motionDownloadFilename(null, null, 3)).toBe('cliente-motion-v3.mp4');
    expect(motionDownloadFilename('  ', '!!!', 3)).toBe('cliente-motion-v3.mp4');
  });
});

describe('linha "Usando:"', () => {
  it('monta conforme as flags, com plural correto', () => {
    expect(assetSummaryParts({ logo: true, images: 3, videos: 0 })).toEqual(['Logo', '3 fotografias']);
    expect(assetSummaryParts({ logo: false, images: 1, videos: 2 })).toEqual(['1 fotografia', '2 vídeos']);
  });

  it('sem assets usados, linha vazia (o card não renderiza a linha)', () => {
    expect(assetSummaryParts({ logo: false, images: 0, videos: 0 })).toEqual([]);
  });
});

describe('MotionCard montado — estado de erro', () => {
  const reference: ChatMotionRef = { motion_id: 'motion-1', status: 'failed' };

  function failedWire(overrides: Partial<MotionStatusWire> = {}): MotionStatusWire {
    return {
      motionId: 'motion-1',
      status: 'failed',
      stage: 'Falhou',
      stageDetail: null,
      format: '9:16',
      durationSeconds: 15,
      fps: 30,
      width: 1080,
      height: 1920,
      renderVersion: 0,
      previewUrl: null,
      finalUrl: null,
      error: 'O Claude Opus 5.5 está indisponível — limite de uso atingido.',
      errorCode: 'OPUS_UNAVAILABLE',
      updatedAt: '2026-09-24T12:00:00.000Z',
      ...overrides,
    };
  }

  /** React Query resolve o fetch num microtask mas agenda o re-render pelo
   * scheduler (macrotask): um único act não basta, e com fake timers o
   * setTimeout nunca dispara — por isso os dois caminhos. */
  async function flushQuery() {
    await act(async () => {
      if (vi.isFakeTimers()) {
        await vi.advanceTimersByTimeAsync(30);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    });
  }

  async function mount() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <MotionCard reference={reference} />
        </QueryClientProvider>,
      );
    });
    // Duas descidas: a primeira deixa o GET resolver, a segunda aplica o
    // re-render com `data` — sem isso a assertiva lê os fallbacks de loading.
    await flushQuery();
    await flushQuery();
    return { host, root, client };
  }

  it('OPUS_UNAVAILABLE: mostra o texto do wire, o caminho de reabilitação e o retry MANUAL', async () => {
    apiFetchMock.mockResolvedValue(failedWire());
    const { host } = await mount();

    // Mensagem exata do contrato (errorCode OPUS_UNAVAILABLE -> error do wire).
    expect(host.textContent).toContain('O Claude Opus 5.5 está indisponível — limite de uso atingido.');
    // Sem loop agressivo: o card aponta a reabilitação (teste de conexão nas
    // configurações) em vez de prometer que clicar resolve agora.
    expect(host.textContent).toContain('teste a conexão nas configurações');
    const retry = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Tentar de novo'));
    expect(retry).toBeTruthy();
  });

  it('status failed é terminal: NENHUMA chamada automática depois da primeira (sem auto-retry, polling parado)', async () => {
    vi.useFakeTimers();
    apiFetchMock.mockResolvedValue(failedWire());
    await mount();
    expect(apiFetchMock).toHaveBeenCalledTimes(1); // o GET inicial
    // Muito além do refetchInterval de 4s do use-motion: se o polling não
    // tivesse parado no estágio terminal, aqui já teriam saído novas chamadas.
    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
  });

  it('"Tentar de novo" continua manual: um clique = um POST /render, nada mais', async () => {
    apiFetchMock.mockResolvedValue(failedWire());
    const { host } = await mount();
    apiFetchMock.mockClear();

    const retry = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Tentar de novo'))!;
    await act(async () => {
      retry.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    const posts = apiFetchMock.mock.calls.filter(([, options]) => (options as { method?: string })?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]![0]).toBe('/motion/motion-1/render');
  });

  it('falha genérica (sem errorCode): mostra o erro mas não o aviso de quota', async () => {
    apiFetchMock.mockResolvedValue(
      failedWire({ error: 'O render quebrou no meio.', errorCode: null }),
    );
    const { host } = await mount();
    expect(host.textContent).toContain('O render quebrou no meio.');
    expect(host.textContent).not.toContain('teste a conexão nas configurações');
    expect(host.textContent).toContain('Tentar de novo');
  });
});

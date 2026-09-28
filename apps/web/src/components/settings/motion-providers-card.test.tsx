import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MotionProviderWire } from '@/hooks/use-motion';
import { MotionProvidersSection } from './motion-providers-card';

/**
 * §38 — o estado OPUS_UNAVAILABLE do provider claude (contrato 24/09/2026).
 * O GET /motion/providers é mockado no nível do apiFetch: o que se prova é a
 * apresentação — message do wire em destaque de aviso, botão "Testar conexão"
 * preservado (é o probe real que reabilita o motor quando a quota renova) e o
 * texto auxiliar que explica isso.
 */
const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiFetch: apiFetchMock,
}));

// next/image fora do runtime do Next: basta uma <img> pra o teste de markup.
vi.mock('next/image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
  apiFetchMock.mockReset();
});

function provider(overrides: Partial<MotionProviderWire> = {}): MotionProviderWire {
  return {
    provider: 'claude',
    state: 'CONNECTED',
    message: 'Conectado e pronto para gerar.',
    remedy: null,
    account: 'agencia@desigual.com',
    model: 'Claude Opus 5.5',
    motionCapable: true,
    details: {},
    checkedAt: '2026-09-24T12:00:00.000Z',
    ...overrides,
  };
}

const chatgpt = provider({
  provider: 'chatgpt',
  state: 'CONNECTED',
  message: 'Conectado.',
  model: 'GPT-5',
  motionCapable: false,
});

async function flushQuery() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
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
        <MotionProvidersSection />
      </QueryClientProvider>,
    );
  });
  // Duas descidas (mesmo motivo do teste do MotionCard): fetch resolve num
  // microtask, o re-render é agendado pelo scheduler num macrotask.
  await flushQuery();
  await flushQuery();
  return { host, root, client };
}

describe('MotionProvidersSection — OPUS_UNAVAILABLE', () => {
  it('mostra a message do wire em destaque, o botão "Testar conexão" e o texto de reabilitação', async () => {
    apiFetchMock.mockResolvedValue({
      providers: [
        provider({
          state: 'OPUS_UNAVAILABLE',
          message: 'O Claude Opus 5.5 está indisponível — limite de uso atingido.',
          motionCapable: false,
        }),
        chatgpt,
      ],
    });
    const { host } = await mount();

    // Message exata do contrato, vinda do wire (nada reescrito pela UI).
    expect(host.textContent).toContain('O Claude Opus 5.5 está indisponível — limite de uso atingido.');
    expect(host.textContent).toContain('Opus 5.5 indisponível');
    // O botão fica: é o probe real que limpa o estado de quota.
    const testButton = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Testar conexão');
    expect(testButton).toBeTruthy();
    expect(host.textContent).toContain('Quando a quota renovar, teste a conexão para reabilitar.');
  });

  it('clique em "Testar conexão" dispara o POST /motion/providers/claude/test (uma vez por clique)', async () => {
    apiFetchMock.mockImplementation((url: string, options?: { method?: string }) => {
      if (options?.method === 'POST') {
        return Promise.resolve({ provider: provider() });
      }
      return Promise.resolve({
        providers: [
          provider({
            state: 'OPUS_UNAVAILABLE',
            message: 'O Claude Opus 5.5 está indisponível — limite de uso atingido.',
            motionCapable: false,
          }),
          chatgpt,
        ],
      });
    });
    const { host } = await mount();
    apiFetchMock.mockClear();

    const testButton = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Testar conexão')!;
    await act(async () => {
      testButton.click();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    const posts = apiFetchMock.mock.calls.filter(([, options]) => (options as { method?: string })?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]![0]).toBe('/motion/providers/claude/test');
  });

  it('provider CONNECTED: message na linha comum, sem caixa de aviso nem texto de quota', async () => {
    apiFetchMock.mockResolvedValue({ providers: [provider(), chatgpt] });
    const { host } = await mount();
    expect(host.textContent).toContain('Conectado e pronto para gerar.');
    expect(host.textContent).not.toContain('Quando a quota renovar');
    const botao = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Testar conexão');
    expect(botao).toBeTruthy();
  });
});

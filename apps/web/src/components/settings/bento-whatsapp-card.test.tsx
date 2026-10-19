import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Fluxo do vínculo como a pessoa vê: gerar código → o Bento recebe pelo
 * WhatsApp → a tela pergunta "este número é seu?" → confirmar. E o painel
 * master só aparece para master.
 */
const apiFetchMock = vi.hoisted(() => vi.fn());
const papel = vi.hoisted(() => ({ master: false }));

vi.mock('@/lib/api/client', () => ({
  apiFetch: apiFetchMock,
  ApiRequestError: class ApiRequestError extends Error {
    constructor(message: string, public readonly status: number) {
      super(message);
    }
  },
}));
vi.mock('@/hooks/use-is-master', () => ({ useIsMaster: () => ({ isMaster: papel.master, isPending: false }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { BentoWhatsappSection } = await import('./bento-whatsapp-card');

async function assentar() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function montar() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <BentoWhatsappSection />
      </QueryClientProvider>,
    );
  });
  await assentar();
  return container;
}

function botao(container: HTMLElement, texto: string): HTMLButtonElement {
  const achado = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(texto));
  if (!achado) throw new Error(`botão "${texto}" não está na tela: ${container.textContent}`);
  return achado as HTMLButtonElement;
}

afterEach(() => {
  document.body.innerHTML = '';
  apiFetchMock.mockReset();
  papel.master = false;
});

describe('Bento no WhatsApp — vínculo', () => {
  it('canal desligado: explica, não oferece vincular', async () => {
    apiFetchMock.mockResolvedValue({ enabled: false, bot_phone: null, link: null, pending_code: null });
    const tela = await montar();
    expect(tela.textContent).toContain('ainda não está ativo');
    expect(tela.textContent).not.toContain('Vincular meu WhatsApp');
  });

  it('gera o código, espera o WhatsApp e só vincula depois do "Sim, é meu"', async () => {
    let me: Record<string, unknown> = { enabled: true, bot_phone: '+55 18 99798-7295', link: null, pending_code: null };
    const expira = new Date(Date.now() + 600_000).toISOString();
    apiFetchMock.mockImplementation(async (rota: string, init?: RequestInit) => {
      if (rota === '/bento-whatsapp/me') return me;
      if (rota === '/bento-whatsapp/me/link-code' && init?.method === 'POST') {
        me = { ...me, pending_code: { id: 'c1', status: 'pending', expires_at: expira, claimed_phone: null } };
        return { id: 'c1', code: 'BENTO-AB3K-9XQP', expires_at: expira, bot_phone: '+55 18 99798-7295', wa_link: 'https://wa.me/5518997987295?text=BENTO-AB3K-9XQP' };
      }
      if (rota === '/bento-whatsapp/me/link-code/c1/confirm') {
        me = { ...me, pending_code: null, link: { id: 'l1', phone: '+55 18 99111-0001', linked_at: new Date().toISOString() } };
        return { ok: true, phone: '+55 18 99111-0001' };
      }
      throw new Error(`rota inesperada ${rota}`);
    });

    const tela = await montar();
    await act(async () => botao(tela, 'Vincular meu WhatsApp').click());
    await assentar();
    expect(tela.textContent).toContain('BENTO-AB3K-9XQP');
    expect(tela.querySelector('a[href^="https://wa.me/5518997987295?text="]')).not.toBeNull();
    // Ainda não vinculou: só gerar o código não cria vínculo.
    expect(apiFetchMock).not.toHaveBeenCalledWith('/bento-whatsapp/me/link-code/c1/confirm', expect.anything());

    // O Bento recebeu o código de um número; a tela pergunta.
    me = { ...me, pending_code: { id: 'c1', status: 'claimed', expires_at: expira, claimed_phone: '+55 18 99111-0001' } };
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 3_200));
    });
    await assentar();
    expect(tela.textContent).toContain('+55 18 99111-0001');
    expect(tela.textContent).toContain('Este número é seu?');

    await act(async () => botao(tela, 'Sim, é meu').click());
    await assentar();
    expect(apiFetchMock).toHaveBeenCalledWith('/bento-whatsapp/me/link-code/c1/confirm', { method: 'POST' });
    expect(tela.textContent).toContain('Vinculado');
  }, 10_000);

  it('colaborador não vê o painel do número do Bento; master vê', async () => {
    apiFetchMock.mockImplementation(async (rota: string) => {
      if (rota === '/bento-whatsapp/me') return { enabled: true, bot_phone: null, link: null, pending_code: null };
      if (rota === '/bento-whatsapp/admin/status')
        return {
          enabled: true, source: 'painel', can_provision: true, kill_switch: false, webhook_url: null, agent_hint: 'AUTO', open_mode: null,
          missing_config: [], bot_phone: null, transcription: 'none', documents: false, allowed_groups: 0,
          session: { status: 'qr_ready' }, gateway: { ready: true }, brain: { last_reply_at: null },
          last_24h: { by_status: {}, latency_ms: { p50: null, p95: null, samples: 0 } }, recent_failures: [], linked_users: 0,
        };
      if (rota === '/bento-whatsapp/admin/links') return { links: [] };
      throw new Error(`rota inesperada ${rota}`);
    });
    const colaborador = await montar();
    expect(colaborador.textContent).not.toContain('Número do Bento');
    expect(apiFetchMock).not.toHaveBeenCalledWith('/bento-whatsapp/admin/status');
    document.body.innerHTML = '';

    papel.master = true;
    const master = await montar();
    expect(master.textContent).toContain('Número do Bento');
    expect(master.textContent).toContain('Aguardando QR');
    // QR não é buscado sozinho: só no botão (ver o QR é auditado).
    expect(apiFetchMock).not.toHaveBeenCalledWith('/bento-whatsapp/admin/session/qr');
  });

  it('número ainda não conectado: o master conecta pelo painel, sem variável de servidor', async () => {
    papel.master = true;
    let provisionou = false;
    apiFetchMock.mockImplementation(async (rota: string, init?: RequestInit) => {
      if (rota === '/bento-whatsapp/me') return { enabled: false, bot_phone: '+55 18 99798-7295', link: null, pending_code: null };
      if (rota === '/bento-whatsapp/admin/links') return { links: [] };
      if (rota === '/bento-whatsapp/admin/session/provision' && init?.method === 'POST') {
        provisionou = true;
        return { status: 'qr_ready', created: true };
      }
      if (rota === '/bento-whatsapp/admin/status')
        return {
          enabled: false, source: provisionou ? 'painel' : 'nenhuma', can_provision: true, kill_switch: false, webhook_url: null,
          agent_hint: 'AUTO', open_mode: null, missing_config: [], bot_phone: '+55 18 99798-7295', transcription: 'none', documents: false,
          allowed_groups: 0, session: { status: provisionou ? 'qr_ready' : 'not_configured' }, gateway: { ready: false },
          brain: { last_reply_at: null }, last_24h: { by_status: {}, latency_ms: { p50: null, p95: null, samples: 0 } },
          recent_failures: [], linked_users: 0,
        };
      throw new Error(`rota inesperada ${rota}`);
    });
    const tela = await montar();
    expect(tela.textContent).toContain('ainda não está conectado');
    await act(async () => botao(tela, 'Conectar número do Bento').click());
    await assentar();
    expect(provisionou).toBe(true);
    expect(tela.textContent).toContain('Aguardando QR');
  });

  it('QR ainda não pronto: a tela espera e tenta de novo sozinha, sem o usuário clicar outra vez', async () => {
    papel.master = true;
    let tentativas = 0;
    apiFetchMock.mockImplementation(async (rota: string) => {
      if (rota === '/bento-whatsapp/me') return { enabled: true, bot_phone: null, link: null, pending_code: null };
      if (rota === '/bento-whatsapp/admin/links') return { links: [] };
      if (rota === '/bento-whatsapp/admin/session/qr') {
        tentativas += 1;
        if (tentativas < 3) throw new Error('QR code is not ready yet. Please wait...');
        return { qr_code: 'data:image/png;base64,AAAA', status: 'qr_ready' };
      }
      if (rota === '/bento-whatsapp/admin/status')
        return {
          enabled: true, source: 'painel', can_provision: true, kill_switch: false, webhook_url: null, agent_hint: 'AUTO', open_mode: null,
          missing_config: [], bot_phone: null, transcription: 'none', documents: false, allowed_groups: 0,
          session: { status: 'initializing' }, gateway: { ready: true }, brain: { last_reply_at: null },
          last_24h: { by_status: {}, latency_ms: { p50: null, p95: null, samples: 0 } }, recent_failures: [], linked_users: 0,
        };
      throw new Error(`rota inesperada ${rota}`);
    });
    const tela = await montar();
    await act(async () => botao(tela, 'Mostrar QR').click());
    await assentar();
    expect(tela.textContent).toContain('o QR aparece em alguns segundos');
    expect(tela.querySelector('img[alt^="QR"]')).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 6_400));
    });
    await assentar();
    expect(tentativas).toBe(3);
    expect(tela.querySelector('img[alt^="QR"]')).not.toBeNull();
    expect(tela.textContent).not.toContain('o QR aparece em alguns segundos');
  }, 15_000);

  it('QR na tela é renovado sozinho; e há o código de 8 caracteres como saída sem QR', async () => {
    papel.master = true;
    let qrs = 0;
    apiFetchMock.mockImplementation(async (rota: string, init?: RequestInit) => {
      if (rota === '/bento-whatsapp/me') return { enabled: true, bot_phone: null, link: null, pending_code: null };
      if (rota === '/bento-whatsapp/admin/links') return { links: [] };
      if (rota === '/bento-whatsapp/admin/session/qr') {
        qrs += 1;
        return { qr_code: `data:image/png;base64,QR${qrs}`, status: 'qr_ready' };
      }
      if (rota === '/bento-whatsapp/admin/session/pairing-code' && init?.method === 'POST')
        return { pairing_code: 'ABCD1234', phone: '+55 18 99798-7295' };
      if (rota === '/bento-whatsapp/admin/status')
        return {
          enabled: true, source: 'painel', can_provision: true, kill_switch: false, webhook_url: null, agent_hint: 'AUTO', open_mode: null,
          missing_config: [], bot_phone: null, transcription: 'none', documents: false, allowed_groups: 0,
          session: { status: 'qr_ready' }, gateway: { ready: true }, brain: { last_reply_at: null },
          last_24h: { by_status: {}, latency_ms: { p50: null, p95: null, samples: 0 } }, recent_failures: [], linked_users: 0,
        };
      throw new Error(`rota inesperada ${rota}`);
    });
    const tela = await montar();
    await act(async () => botao(tela, 'Mostrar QR').click());
    await assentar();
    expect(tela.querySelector('img[alt^="QR"]')?.getAttribute('src')).toBe('data:image/png;base64,QR1');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 12_400));
    });
    await assentar();
    expect(qrs).toBeGreaterThanOrEqual(2);
    expect(tela.querySelector('img[alt^="QR"]')?.getAttribute('src')).not.toBe('data:image/png;base64,QR1');

    await act(async () => botao(tela, 'Conectar por código').click());
    await assentar();
    expect(tela.textContent).toContain('ABCD1234');
    expect(tela.textContent).toContain('Conectar com número de telefone');
  }, 20_000);

  it('modo teste aberto: pede confirmação, liga por 1 hora e mostra como encerrar', async () => {
    papel.master = true;
    let ate: string | null = null;
    const pedidos: unknown[] = [];
    apiFetchMock.mockImplementation(async (rota: string, init?: RequestInit) => {
      if (rota === '/bento-whatsapp/me') return { enabled: true, bot_phone: null, link: null, pending_code: null };
      if (rota === '/bento-whatsapp/admin/links') return { links: [] };
      if (rota === '/bento-whatsapp/admin/open-mode') {
        const corpo = JSON.parse(String(init?.body));
        pedidos.push(corpo);
        ate = corpo.enabled ? new Date(Date.now() + 3_600_000).toISOString() : null;
        return { enabled: corpo.enabled, until: ate };
      }
      if (rota === '/bento-whatsapp/admin/status')
        return {
          enabled: true, source: 'painel', can_provision: true, kill_switch: false, webhook_url: null, agent_hint: 'AUTO',
          open_mode: ate ? { until: ate } : null, missing_config: [], bot_phone: null, transcription: 'none', documents: false,
          allowed_groups: 0, session: { status: 'ready' }, gateway: { ready: true }, brain: { last_reply_at: null },
          last_24h: { by_status: {}, latency_ms: { p50: null, p95: null, samples: 0 } }, recent_failures: [], linked_users: 0,
        };
      throw new Error(`rota inesperada ${rota}`);
    });
    const tela = await montar();
    expect(tela.textContent).toContain('só responde quem está vinculado');

    // Recusou na confirmação: nada é enviado.
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => botao(tela, 'Liberar teste por 1 hora').click());
    await assentar();
    expect(pedidos).toHaveLength(0);

    confirmar.mockReturnValue(true);
    await act(async () => botao(tela, 'Liberar teste por 1 hora').click());
    await assentar();
    expect(pedidos).toEqual([{ enabled: true, minutes: 60 }]);
    expect(tela.textContent).toContain('LIGADO até');
    expect(tela.textContent).toContain('recusa criar, mudar ou');

    await act(async () => botao(tela, 'Encerrar teste agora').click());
    await assentar();
    expect(pedidos[1]).toEqual({ enabled: false });
    confirmar.mockRestore();
  });
});

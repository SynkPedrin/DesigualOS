import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WhatsappBusinessCard } from './whatsapp-business-card';
import type { WhatsappOpenwaSession } from '@/hooks/use-whatsapp-openwa';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const connect = { mutateAsync: vi.fn(), isPending: false, isError: false, error: null };
let sessions: WhatsappOpenwaSession[] = [];
let currentSession: WhatsappOpenwaSession | null = null;
let qrData: { qr_code: string; status: string; fetched_at: string } | null = null;
let root: ReturnType<typeof createRoot> | null = null;
let container: HTMLDivElement | null = null;

function mutation() {
  return { mutate: vi.fn(), isPending: false, isError: false, error: null };
}

vi.mock('@/hooks/use-me', () => ({ useMe: () => ({ data: { id: 'user-1' } }) }));
vi.mock('@/hooks/use-whatsapp-openwa', () => ({
  useWhatsappOpenwaSessions: () => ({ data: sessions, isPending: false, isError: false, error: null }),
  useWhatsappOpenwaSession: () => ({ data: currentSession, isFetching: false, isError: false, error: null }),
  useConnectWhatsappOpenwa: () => connect,
  useWhatsappOpenwaQr: () => ({ data: qrData, isError: false, error: null, refetch: vi.fn() }),
  useReconnectWhatsappOpenwa: () => mutation(),
  useDisconnectWhatsappOpenwa: () => mutation(),
  useSyncWhatsappOpenwa: () => mutation(),
  useWhatsappOpenwaSyncHistory: () => ({ data: [] }),
  useRetryWhatsappOpenwaSync: () => mutation(),
}));

function session(status: string): WhatsappOpenwaSession {
  return {
    id: 'session-1', provider: 'openwa', external_session_id: 'external-1', owner_user_id: 'user-1',
    phone_number: status === 'ready' ? '5511999999999' : null, push_name: 'Operação', status,
    engine_loaded: true, connected_at: null, last_seen_at: null, last_sync_at: null, last_error: null,
    created_at: '2026-10-16T10:00:00.000Z', updated_at: '2026-10-16T10:00:00.000Z',
    counts: { contacts: 248, conversations: 63, messages: 1420 }, latest_sync: null,
  };
}

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<WhatsappBusinessCard />); });
}

function button(label: string): HTMLButtonElement {
  const found = [...container!.querySelectorAll('button')].find((item) => item.textContent?.includes(label));
  if (!found) throw new Error(`Botão não encontrado: ${label}`);
  return found as HTMLButtonElement;
}

beforeEach(() => {
  sessions = [];
  currentSession = null;
  qrData = null;
  vi.clearAllMocks();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('WhatsApp Business em Integrações', () => {
  it('mostra estado não configurado e ação de conectar', async () => {
    await mount();
    expect(container!.textContent).toContain('Não configurado');
    expect(button('Conectar WhatsApp')).toBeTruthy();
  });

  it('abre o modal e exibe o QR retornado pelo provider com as instruções', async () => {
    const pending = session('qr_ready');
    sessions = [pending];
    currentSession = pending;
    qrData = { qr_code: 'data:image/png;base64,provider-real-qr', status: 'qr_ready', fetched_at: '2026-10-16T10:00:00.000Z' };
    connect.mutateAsync.mockResolvedValue(pending);
    await mount();
    await act(async () => { button('Conectar WhatsApp').dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    expect(container!.textContent).toContain('Escaneie o QR Code com o WhatsApp do seu celular para conectar sua conta.');
    expect(container!.textContent).toContain('2. Acesse Aparelhos conectados.');
    expect(container!.querySelector('img[alt="QR Code real para conectar esta sessão ao WhatsApp"]')?.getAttribute('src')).toBe('data:image/png;base64,provider-real-qr');
  });

  it('mostra dados reais da sessão conectada e acesso ao Inbox', async () => {
    const ready = session('ready');
    ready.last_sync_at = '2026-10-16T10:00:00.000Z';
    ready.latest_sync = {
      id: 'job-1', status: 'completed', phase: 'completed', processed_contacts: 248,
      processed_chats: 63, processed_messages: 1420, duplicate_messages: 0, imported_media: 20,
      failures: [], error: null, started_at: null, finished_at: null, created_at: '2026-10-16T10:00:00.000Z',
    };
    sessions = [ready];
    currentSession = ready;
    await mount();
    expect(container!.textContent).toContain('Sincronizado');
    expect(container!.textContent).toContain('+5511999999999');
    expect(container!.textContent).toContain('248');
    expect(container!.textContent).toContain('63');
    expect(container!.textContent).toContain('1420');
    expect(container!.querySelector('a[href="/inbox"]')).toBeTruthy();
  });
});

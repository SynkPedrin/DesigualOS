import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 03/11/2026: a conta do Pedro tinha a agenda vinculada, mas a conexão com o Outlook tinha expirado. A tela seguia
 * dizendo "sincronizado" com a data velha e o mês aparecia vazio, sem pista do porquê.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let conectado = false;
const conectar = vi.fn();
vi.mock('@/hooks/use-me', () => ({ useMe: () => ({ data: { id: 'eu', name: 'Pedro' } }) }));
vi.mock('@/hooks/use-microsoft-calendar', () => ({
  useMicrosoftCalendarIntegration: () => ({ isPending: false, data: { connected: conectado, configured: true } }),
  useConnectMicrosoftCalendar: () => ({ mutate: conectar, isPending: false }),
  useMicrosoftCalendarAccounts: () => ({ isPending: false, data: [{ id: 'c1', external_calendar_id: 'ag', is_primary: true, connected: true, last_synced_at: '2026-10-30T12:00:00Z' }] }),
  useMicrosoftCalendarList: () => ({ data: [] }),
  useLinkMicrosoftCalendarAccount: () => ({ mutate: vi.fn(), isPending: false }),
  useSyncMicrosoftCalendarAccount: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { MicrosoftCalendarConnect } = await import('./microsoft-calendar-connect');

let root: ReturnType<typeof createRoot> | null = null;
let container: HTMLDivElement | null = null;
function montar(soAviso = false) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<MicrosoftCalendarConnect soAviso={soAviso} />));
}
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  conectar.mockReset();
});

describe('conexão do Outlook expirada', () => {
  it('avisa e reconecta, em vez de dizer "sincronizado"', () => {
    conectado = false;
    montar();
    expect(container!.querySelector('[role=alert]')!.textContent).toContain('expirou');
    expect(container!.textContent).not.toContain('sincronizado');
    act(() => Array.from(container!.querySelectorAll('button')).find((b) => b.textContent?.includes('Reconectar'))!.click());
    expect(conectar).toHaveBeenCalled();
  });

  it('no Daily (só o aviso), com a conexão em dia não mostra nada', () => {
    conectado = true;
    montar(true);
    expect(container!.innerHTML).toBe('');
  });
});

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Notification } from '@/lib/api/contracts';

/**
 * Mensagem nova e tarefa atribuída tocam som (03/11/2026, pedido da operação). O que já estava no sino ao abrir o
 * sistema não toca: é acervo. Reação e aviso que não é de mensagem nem de tarefa não tocam.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const estado = vi.hoisted(() => ({ notificacoes: [] as Notification[] }));
const som = vi.hoisted(() => ({ tocarAviso: vi.fn(), avisarNoNavegador: vi.fn(), prepararAvisos: vi.fn() }));

vi.mock('@/hooks/use-notifications', () => ({
  useNotifications: () => ({ data: estado.notificacoes }),
  useMarkNotificationRead: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/hooks/use-open-notification-link', () => ({ useOpenNotificationLink: () => vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/daily-tasks' }));
vi.mock('@/lib/aviso-sonoro', async () => {
  const original = await vi.importActual<typeof import('@/lib/aviso-sonoro')>('@/lib/aviso-sonoro');
  return { ...original, tocarAviso: som.tocarAviso, avisarNoNavegador: som.avisarNoNavegador, prepararAvisos: som.prepararAvisos };
});

const { NotificationInboxPopup } = await import('./notification-inbox-popup');

let root: ReturnType<typeof createRoot> | null = null;
let container: HTMLDivElement | null = null;

const aviso = (id: string, type: string, title = `aviso ${id}`): Notification => ({ id, type, title, body: null, link: null, read: false, createdAt: new Date().toISOString() });
function mostrar(lista: Notification[]) {
  estado.notificacoes = lista;
  act(() => root!.render(<NotificationInboxPopup />));
}

beforeEach(() => {
  som.tocarAviso.mockReset();
  som.avisarNoNavegador.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

describe('NotificationInboxPopup: som do que chega', () => {
  it('o acervo da primeira carga não toca; a mensagem que chega depois toca o som de mensagem', () => {
    mostrar([aviso('a', 'chat.direct'), aviso('b', 'work.assigned')]);
    expect(som.tocarAviso).not.toHaveBeenCalled();
    mostrar([aviso('c', 'chat.direct', 'Tammy enviou uma mensagem'), aviso('a', 'chat.direct'), aviso('b', 'work.assigned')]);
    expect(som.tocarAviso).toHaveBeenCalledWith('mensagem');
    expect(som.avisarNoNavegador).toHaveBeenCalledWith('Tammy enviou uma mensagem', null, expect.any(Function), 'c');
  });

  it('tarefa atribuída toca o som de tarefa, mesmo chegando junto com mensagem', () => {
    mostrar([]);
    mostrar([aviso('m', 'chat.channel'), aviso('t', 'work.assigned')]);
    expect(som.tocarAviso).toHaveBeenCalledTimes(1);
    expect(som.tocarAviso).toHaveBeenCalledWith('tarefa');
  });

  it('reação e aviso que não é de mensagem nem de tarefa não tocam', () => {
    mostrar([]);
    mostrar([aviso('r', 'chat.reaction'), aviso('s', 'studio.job_completed')]);
    expect(som.tocarAviso).not.toHaveBeenCalled();
  });
});

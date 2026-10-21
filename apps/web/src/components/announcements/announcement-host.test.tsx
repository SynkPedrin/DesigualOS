import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Anuncio } from '@/hooks/use-announcements';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const estado = vi.hoisted(() => ({
  me: { id: 'u1' } as { id: string } | undefined,
  workspaceOk: true,
  lista: [] as Anuncio[],
  claim: { first: true } as { first: boolean } | Error,
  claims: 0,
  mutacoes: [] as Array<{ key: string; event: string }>,
  iniciados: [] as string[],
  tourAtivo: false,
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/hooks/use-me', () => ({ useMe: () => ({ data: estado.me }) }));
vi.mock('@/hooks/use-my-workspace', () => ({ useMyWorkspace: () => ({ isSuccess: estado.workspaceOk }) }));
vi.mock('@/stores/ui-store', () => ({ useUiStore: (sel: (s: { studioModalOpen: boolean }) => unknown) => sel({ studioModalOpen: false }) }));
vi.mock('@/components/tour/tour-provider', () => ({ useTour: () => ({ ativo: estado.tourAtivo, iniciar: (id: string) => estado.iniciados.push(id) }) }));
vi.mock('@/hooks/use-announcements', () => ({
  useAnnouncements: (enabled: boolean) => ({ data: enabled ? estado.lista : undefined, refetch: async () => undefined }),
  useAnnouncementEvent: () => ({ mutate: (v: { key: string; event: string }) => estado.mutacoes.push(v) }),
  registrarEventoDoAnuncio: async (key: string) => {
    estado.claims++;
    if (estado.claim instanceof Error) throw estado.claim;
    return { first: estado.claim.first, announcement: { ...estado.lista.find((a) => a.key === key)!, auto_open: false } };
  },
}));
vi.mock('framer-motion', async () => {
  const React = await import('react');
  const div = React.forwardRef<HTMLDivElement, Record<string, unknown>>(({ initial: _i, animate: _a, exit: _e, transition: _t, ...resto }, ref) => React.createElement('div', { ...resto, ref }));
  return { motion: { div }, AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children) };
});

const { AnnouncementHost } = await import('./announcement-host');

const anuncio = (extra: Partial<Anuncio> = {}): Anuncio => ({
  id: 'a1', key: 'communication_hub_launch_v1', type: 'NEW_FEATURE', title: 'A comunicação da sua equipe evoluiu.',
  subtitle: 'Conheça o novo espaço de colaboração do Desigual OS.', description: 'Agora você pode conversar…', version: 1,
  preview_image_url: null, primary_cta: { label: 'Conhecer a novidade', action: 'start_tutorial' }, secondary_cta: { label: 'Explorar depois', action: 'dismiss' },
  tutorial_id: 'communication_hub_v1', tutorial_version: 1, priority: 100, icon: 'MessagesSquare', auto_open: true, state: 'not_seen', tutorial_step: null, completed_at: null,
  ...extra,
});

let raiz: Root;
const modal = () => document.querySelector('[aria-labelledby="anuncio-titulo"]');
const botao = (nome: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === nome || b.getAttribute('aria-label') === nome)!;
const montar = async () => {
  const div = document.createElement('div');
  document.body.appendChild(div);
  raiz = createRoot(div);
  act(() => raiz.render(<AnnouncementHost />));
  await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
};

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(estado, { me: { id: 'u1' }, workspaceOk: true, lista: [anuncio()], claim: { first: true }, claims: 0, mutacoes: [], iniciados: [], tourAtivo: false });
});
afterEach(() => { act(() => raiz?.unmount()); document.body.innerHTML = ''; vi.useRealTimers(); });

describe('quando o anúncio abre sozinho', () => {
  it('pessoa elegível, primeira vez: abre com título, selo, descrição e as duas ações', async () => {
    await montar();
    expect(modal()).not.toBeNull();
    expect(document.body.textContent).toContain('Novidade');
    expect(document.body.textContent).toContain('A comunicação da sua equipe evoluiu.');
    expect(botao('Conhecer a novidade')).toBeTruthy();
    expect(botao('Explorar depois')).toBeTruthy();
    expect(document.activeElement?.textContent).toBe('Conhecer a novidade');
  });

  it('outra aba já mostrou (o servidor nega a reivindicação): não abre', async () => {
    estado.claim = { first: false };
    await montar();
    expect(estado.claims).toBe(1);
    expect(modal()).toBeNull();
  });

  it('não elegível / nada pendente: não reivindica nem abre', async () => {
    estado.lista = [];
    await montar();
    expect(estado.claims).toBe(0);
    expect(modal()).toBeNull();
    estado.lista = [anuncio({ auto_open: false, state: 'completed' })];
    await montar();
    expect(estado.claims).toBe(0);
  });

  it('antes de perfil e permissões chegarem: não faz nada', async () => {
    estado.workspaceOk = false;
    await montar();
    expect(estado.claims).toBe(0);
    estado.workspaceOk = true;
    estado.me = undefined;
    await montar();
    expect(estado.claims).toBe(0);
  });

  it('outro modal crítico aberto (boas-vindas, Studio): espera; fechou, aparece', async () => {
    const outro = document.createElement('div');
    outro.setAttribute('role', 'dialog');
    outro.setAttribute('aria-modal', 'true');
    document.body.appendChild(outro);
    await montar();
    expect(estado.claims).toBe(0);
    outro.remove();
    // a nova tentativa (3 s) re-arma a espera de 1,2 s: dois passos, porque o React aplica o estado no fim de cada act
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
    expect(estado.claims).toBe(1);
    expect(modal()).not.toBeNull();
  });

  it('com tutorial guiado em andamento: não abre por cima', async () => {
    estado.tourAtivo = true;
    await montar();
    expect(estado.claims).toBe(0);
  });

  it('"Explorar depois", o X e o Esc fecham e gravam como dispensado', async () => {
    await montar();
    act(() => botao('Explorar depois').click());
    expect(modal()).toBeNull();
    expect(estado.mutacoes).toEqual([{ key: 'communication_hub_launch_v1', event: 'dismissed' }]);
  });

  it('Esc fecha', async () => {
    await montar();
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(modal()).toBeNull();
    expect(estado.mutacoes.at(-1)?.event).toBe('dismissed');
  });

  it('"Conhecer a novidade" fecha o modal e começa o tutorial do anúncio', async () => {
    await montar();
    act(() => botao('Conhecer a novidade').click());
    expect(modal()).toBeNull();
    expect(estado.iniciados).toEqual(['communication_hub_v1']);
  });

  it('falha de rede na reivindicação: não abre (e não quebra a tela)', async () => {
    estado.claim = new Error('sem rede');
    await montar();
    expect(modal()).toBeNull();
  });
});

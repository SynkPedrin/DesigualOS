import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', () => ({
  apiFetch: apiFetchMock,
  ApiRequestError: class ApiRequestError extends Error {
    constructor(message: string, public readonly status: number) { super(message); }
  },
}));
vi.mock('@/stores/toast-store', () => ({ toast: vi.fn() }));

import { useUpdateTask, type WorkTaskWire } from './use-work';

const tarefa = { id: 't1', key: 'DT-1', title: 'Arte', assigneeIds: [] as string[], version: 1 } as unknown as WorkTaskWire;

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryData(['work', 'detail', 't1'], { task: tarefa });
  qc.setQueryData(['work', 'tasks', { listId: 'L' }], { rows: [tarefa], total: 1 });
  let hook!: ReturnType<typeof useUpdateTask>;
  function Sonda() { hook = useUpdateTask(); return null; }
  const el = document.createElement('div');
  document.body.appendChild(el);
  act(() => createRoot(el).render(<QueryClientProvider client={qc}><Sonda /></QueryClientProvider>));
  return { qc, mutar: (p: Parameters<typeof hook.mutate>[0]) => hook.mutateAsync(p) };
}

const detalhe = (qc: QueryClient) => (qc.getQueryData(['work', 'detail', 't1']) as { task: WorkTaskWire }).task;
const naLista = (qc: QueryClient) => (qc.getQueryData(['work', 'tasks', { listId: 'L' }]) as { rows: WorkTaskWire[] }).rows[0]!;

afterEach(() => { apiFetchMock.mockReset(); document.body.innerHTML = ''; });

describe('atualização de tarefa: a tela muda na hora, em ordem', () => {
  it('o responsável aparece marcado ANTES de o servidor responder, no detalhe e na lista', async () => {
    let responder!: (v: unknown) => void;
    apiFetchMock.mockImplementation(() => new Promise((r) => { responder = r; }));
    const { qc, mutar } = montar();
    let fim!: Promise<unknown>;
    await act(async () => { fim = mutar({ id: 't1', expectedVersion: 1, assigneeIds: ['u-gui'] }); await Promise.resolve(); });
    expect(detalhe(qc).assigneeIds).toEqual(['u-gui']);
    expect(naLista(qc).assigneeIds).toEqual(['u-gui']);
    await act(async () => { responder({}); await fim; });
  });

  it('o status novo aparece ANTES de o servidor responder, com nome e cor do espaço', async () => {
    let responder!: (v: unknown) => void;
    apiFetchMock.mockImplementation(() => new Promise((r) => { responder = r; }));
    const { qc, mutar } = montar();
    qc.setQueryData(['work', 'statuses', 'S'], { statuses: [{ id: 'st-pronto', name: 'Pronto', color: '#0f0', category: 'done', position: 3, isInitial: false, isFinal: true }] });
    let fim!: Promise<unknown>;
    await act(async () => { fim = mutar({ id: 't1', expectedVersion: 1, statusId: 'st-pronto' }); await Promise.resolve(); });
    expect(naLista(qc).statusId).toBe('st-pronto');
    expect(detalhe(qc).status).toEqual({ id: 'st-pronto', name: 'Pronto', color: '#0f0', category: 'done', isFinal: true });
    await act(async () => { responder({}); await fim; });
  });

  it('dois cliques seguidos vão ao servidor um de cada vez, na ordem', async () => {
    const ordem: string[] = [];
    const pendentes: Array<() => void> = [];
    apiFetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') ordem.push(JSON.parse(String(init.body)).assigneeIds.join(','));
      return new Promise((r) => pendentes.push(() => r({})));
    });
    const { mutar } = montar();
    let a!: Promise<unknown>; let b!: Promise<unknown>;
    await act(async () => { a = mutar({ id: 't1', expectedVersion: 1, assigneeIds: ['u-ana'] }); b = mutar({ id: 't1', expectedVersion: 1, assigneeIds: ['u-ana', 'u-gui'] }); await Promise.resolve(); });
    expect(ordem).toEqual(['u-ana']); // o segundo espera o primeiro
    await act(async () => { pendentes.shift()!(); await a; });
    await vi.waitFor(() => expect(ordem).toEqual(['u-ana', 'u-ana,u-gui']));
    await act(async () => { pendentes.shift()!(); await b; });
  });

  it('se o servidor recusa, a tela volta ao que era', async () => {
    apiFetchMock.mockRejectedValue(new Error('fora do ar'));
    const { qc, mutar } = montar();
    await act(async () => { await mutar({ id: 't1', expectedVersion: 1, assigneeIds: ['u-gui'] }).catch(() => undefined); });
    expect(detalhe(qc).assigneeIds).toEqual([]);
    expect(naLista(qc).assigneeIds).toEqual([]);
  });

  it('abrir uma tarefa enquanto outra salva: a busca do detalhe NÃO é cancelada (o "Carregando…" eterno)', async () => {
    let entregarDetalhe!: (v: unknown) => void;
    apiFetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/work/tasks/t3/detail') return new Promise((r) => { entregarDetalhe = r; });
      return new Promise(() => {}); // o salvamento fica pendurado
      void init;
    });
    const { qc, mutar } = montar();
    let busca!: Promise<unknown>;
    await act(async () => {
      // A subtarefa t3 acabou de ser aberta (ainda sem dado) e alguém mexe nela pela lista no mesmo instante.
      busca = qc.fetchQuery({ queryKey: ['work', 'detail', 't3'], queryFn: () => apiFetchMock('/work/tasks/t3/detail') }).catch((e: unknown) => e);
      void mutar({ id: 't3', expectedVersion: 1, assigneeIds: ['u-gui'] });
      await Promise.resolve();
    });
    await act(async () => { entregarDetalhe({ task: { id: 't3' } }); await busca; });
    expect(qc.getQueryData(['work', 'detail', 't3'])).toEqual({ task: { id: 't3' } });
  });
});

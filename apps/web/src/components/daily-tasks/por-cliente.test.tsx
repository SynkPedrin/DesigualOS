import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkTaskWire } from '@/hooks/use-work';

const recebidas = vi.hoisted(() => [] as Array<{ listId: string | null; titulos: string[]; agrupar: boolean }>);
vi.mock('./list-view', () => ({
  ListView: (p: { listId: string | null; tarefas: WorkTaskWire[]; agrupar?: boolean }) => { recebidas.push({ listId: p.listId, titulos: p.tarefas.map((t) => t.title), agrupar: Boolean(p.agrupar) }); return null; },
}));
vi.mock('./cliente', () => ({
  useListIndex: () => new Map([
    ['L-cos', { nome: 'Cosentino', espaco: 'Espaço DESIGUAL', espacoId: 's', pasta: 'CLIENTES ATIVOS', clientId: null }],
    ['L-dc', { nome: '[EX-CLIENTE 2026-08-14] D. Carvalho', espaco: 'Espaço DESIGUAL', espacoId: 's', pasta: 'CLIENTES ATIVOS', clientId: null }],
  ]),
  LogoDoCliente: () => null,
  nomeLimpo: (n: string) => n.replace(/^\s*\[[^\]]*\]\s*/, '').trim() || n,
}));

import { PorCliente } from './por-cliente';

const t = (id: string, listId: string) => ({ id, title: id, listId } as WorkTaskWire);

afterEach(() => { document.body.innerHTML = ''; recebidas.length = 0; });

describe('tarefas de uma pessoa divididas por cliente', () => {
  it('um bloco por cliente, em ordem alfabética, cada um com a própria lista e agrupado por status', () => {
    const el = document.createElement('div'); document.body.appendChild(el);
    act(() => createRoot(el).render(
      <PorCliente tarefas={[t('Banner', 'L-cos'), t('Motion Dia do Trigo', 'L-dc'), t('Flyer', 'L-cos')]} statuses={[]} membros={[]}
        actions={{} as never} onNovoStatus={() => {}} expandirTudo={false} arquivadas={false} selecionadas={new Set()} onSelecionadas={() => {}} />,
    ));
    expect([...el.querySelectorAll('section')].map((s) => s.getAttribute('aria-label'))).toEqual(['Cliente Cosentino', 'Cliente D. Carvalho']);
    expect(el.textContent).toContain('CLIENTES ATIVOS');
    expect(recebidas).toEqual([
      { listId: 'L-cos', titulos: ['Banner', 'Flyer'], agrupar: true },
      { listId: 'L-dc', titulos: ['Motion Dia do Trigo'], agrupar: true },
    ]);
  });

  it('sem tarefas, diz que não há nada com esses filtros', () => {
    const el = document.createElement('div'); document.body.appendChild(el);
    act(() => createRoot(el).render(
      <PorCliente tarefas={[]} statuses={[]} membros={[]} actions={{} as never} onNovoStatus={() => {}} expandirTudo={false} arquivadas={false} selecionadas={new Set()} onSelecionadas={() => {}} />,
    ));
    expect(el.textContent).toContain('Nenhuma tarefa com esses filtros');
  });
});

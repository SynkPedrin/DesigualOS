import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { WorkTreeSpace } from '@/hooks/use-work';
import { Arvore, pastasDoDaily } from './tree';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const lista = (id: string, name: string, folderId: string | null, openTaskCount = 0, archived = false) => ({ id, name, folderId, projectId: null, clientId: null, archived, openTaskCount });
const espacos: WorkTreeSpace[] = [
  {
    id: 'S1', name: 'Espaço DESIGUAL', color: null, icon: null, archived: false, projects: [],
    folders: [
      { id: 'FA', name: 'CLIENTES ATIVOS', archived: false },
      { id: 'FP', name: 'Clientes Pontuais', archived: false },
      { id: 'FI', name: 'CLIENTES INATIVOS', archived: false },
    ],
    lists: [lista('colpar', 'Colpar', 'FA', 4), lista('elite', 'Elite', 'FA', 9), lista('bio', 'BIO FIT', 'FP', 1), lista('colpar-br', 'Colpar Brasil', 'FI'), lista('imp', 'Clientes Importados operand', null, 728)],
  },
  {
    id: 'S2', name: 'Citável', color: null, icon: null, archived: false, projects: [],
    folders: [{ id: 'FC', name: '👥 Clientes Ativos', archived: false }],
    lists: [lista('case', 'Case #0', 'FC', 3)],
  } as WorkTreeSpace,
];

function montar(onPick = vi.fn()) {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const qc = new QueryClient();
  act(() => createRoot(div).render(<QueryClientProvider client={qc}><Arvore spaces={espacos} listId={null} onPick={onPick} arquivados={false} onArquivados={() => undefined} /></QueryClientProvider>));
  const nomes = () => [...div.querySelectorAll('li button[title]')].map((b) => b.getAttribute('title'));
  const buscar = (t: string) => act(() => {
    const el = div.querySelector('input[aria-label="Buscar cliente"]') as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, t);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return { div, nomes, buscar, onPick };
}

describe('painel do Daily: só clientes ativos e pontuais, com busca', () => {
  it('separa as duas pastas pelo nome; a pasta com emoji da Citável e o resto ficam de fora', () => {
    const { ativos, pontuais, outras } = pastasDoDaily(espacos);
    expect(ativos.map((l) => l.id)).toEqual(['colpar', 'elite']);
    expect(pontuais.map((l) => l.id)).toEqual(['bio']);
    expect(outras.map((l) => l.id).sort()).toEqual(['case', 'colpar-br', 'imp']);
  });

  it('mostra só as duas pastas', () => {
    const { div, nomes } = montar();
    expect(div.textContent).toContain('Clientes ativos');
    expect(div.textContent).toContain('Clientes pontuais');
    expect(nomes()).toEqual(['Colpar', 'Elite', 'BIO FIT']);
  });

  it('a busca filtra sem acento e acha também quem está em outras pastas', () => {
    const { div, nomes, buscar } = montar();
    buscar('colpar');
    expect(nomes()).toEqual(['Colpar', 'Colpar Brasil']);
    expect(div.textContent).toContain('Em outras pastas');
    buscar('zzz');
    expect(div.textContent).toContain('Nenhum cliente com “zzz”');
  });

  it('Enter abre o primeiro cliente achado', () => {
    const { div, buscar, onPick } = montar();
    buscar('eli');
    act(() => { div.querySelector('input[aria-label="Buscar cliente"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(onPick).toHaveBeenCalledWith('elite', 'S1');
  });
});

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { diaEmSaoPaulo } from '@/lib/prazo';
import { pintarAgendas } from '@/components/calendar/cores-das-agendas';
import type { WorkTaskWire } from '@/hooks/use-work';

/**
 * Pedido do Pedro, 03/11/2026: "tanto no calendário normal tanto dentro do Daily eu quero ver todos os calendários,
 * uma aba pra eu ver calendário da Desigual, calendário da Manada Filmes". Este teste trava o lado do Daily.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hoje = diaEmSaoPaulo(new Date());
const agendas = pintarAgendas([{ external_calendar_id: 'ag' }, { external_calendar_id: 'mf' }], [{ id: 'ag', name: 'Calendário', is_default: true }, { id: 'mf', name: 'Manada Filmes' }]);
const evento = (id: string, calendar_id: string | null, title: string, de: string, ate: string, extra: Record<string, unknown> = {}) => ({
  id, calendar_id, title, start_at: new Date(`${hoje}T${de}:00-03:00`).toISOString(), end_at: new Date(`${hoje}T${ate}:00-03:00`).toISOString(),
  client_id: null, timezone: 'America/Sao_Paulo', status: 'confirmed', visible: true, description: null, location: null, meeting_url: null, source: 'microsoft', created_by: 'eu', ...extra,
});
const eventos = [
  evento('e1', 'ag', 'Reunião com a Colormaq', '14:00', '15:00', { meeting_url: 'https://teams.microsoft.com/l/x' }),
  evento('e2', 'mf', 'Gravação Manada', '09:00', '12:00'),
  evento('e3', 'mf', 'Cancelada', '16:00', '17:00', { status: 'cancelled' }),
  evento('e4', null, 'Criado aqui no OS', '17:00', '18:00'),
];
const tarefa = { id: 't1', key: 'T-1', title: 'Entregar roteiro', dueAt: new Date(`${hoje}T12:00:00-03:00`).toISOString(), completedAt: null, priority: 0, status: null, assigneeIds: [], clientId: null, listId: 'l1' } as unknown as WorkTaskWire;
const adicionar = vi.fn();

vi.mock('@/hooks/use-me', () => ({ useMe: () => ({ data: { id: 'eu' } }) }));
vi.mock('@/hooks/use-calendar', () => ({ useCalendarEvents: () => ({ data: eventos }) }));
vi.mock('@/components/calendar/microsoft-calendar-connect', () => ({
  useAgendas: () => ({ agendas, paraAdicionar: [{ id: 'fer', nome: 'Feriados no Brasil' }], adicionar, adicionando: false }),
}));
vi.mock('./cliente', () => ({ useListIndex: () => new Map(), useClientIndex: () => new Map(), LogoDoCliente: () => null, nomeLimpo: (n: string) => n }));

const { CalendarView } = await import('./calendar-view');

let root: ReturnType<typeof createRoot> | null = null;
let container: HTMLDivElement | null = null;

function montar() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<CalendarView tarefas={[tarefa]} actions={{ abrir: vi.fn(), atualizar: vi.fn(), criar: vi.fn() } as never} />));
}

beforeEach(() => {
  try { localStorage.clear(); } catch { /* sem armazenamento */ }
  adicionar.mockReset();
  montar();
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

const aba = (nome: string) => Array.from(container!.querySelectorAll<HTMLButtonElement>('[role=tab]')).find((b) => b.textContent?.startsWith(nome))!;
const celulaDeHoje = () => Array.from(container!.querySelectorAll<HTMLElement>('[role=gridcell]')).find((c) => c.getAttribute('aria-selected') === 'true')!;
const painel = () => container!.querySelector<HTMLElement>('aside')!;
const clicar = (el: HTMLElement) => act(() => { el.click(); });

describe('calendário do Daily com as agendas', () => {
  it('abas Todas, Desigual, Manada Filmes e Só tarefas, com quantos compromissos cada uma tem (cancelado não conta)', () => {
    expect(Array.from(container!.querySelectorAll('[role=tab]')).map((b) => b.textContent)).toEqual(['Todas3', 'Desigual2', 'Manada Filmes1', 'Só tarefas']);
  });

  it('em Todas, o dia mostra os compromissos das duas agendas e guarda lugar para a tarefa; o resto vira "+N no dia"', () => {
    const texto = celulaDeHoje().textContent!;
    expect(texto).toContain('Gravação Manada');
    expect(texto).toContain('Reunião com a Colormaq');
    expect(texto).toContain('Entregar roteiro');
    expect(texto).toContain('+1 no dia');
    expect(texto).not.toContain('Cancelada');
  });

  it('a aba da Manada Filmes mostra só os compromissos dela; a tarefa continua', () => {
    clicar(aba('Manada Filmes'));
    const texto = celulaDeHoje().textContent!;
    expect(texto).toContain('Gravação Manada');
    expect(texto).not.toContain('Reunião com a Colormaq');
    expect(texto).not.toContain('Criado aqui');
    expect(texto).toContain('Entregar roteiro');
  });

  it('Só tarefas esconde todos os compromissos', () => {
    clicar(aba('Só tarefas'));
    expect(celulaDeHoje().textContent).not.toContain('Gravação');
    expect(painel().querySelector('[aria-label="Compromissos do dia"]')).toBeNull();
    expect(painel().textContent).toContain('Entregar roteiro');
  });

  it('o painel do dia lista o compromisso com horário, agenda e o link da reunião', () => {
    const compromissos = painel().querySelector<HTMLElement>('[aria-label="Compromissos do dia"]')!;
    expect(compromissos.textContent).toContain('14:00 às 15:00 · Desigual');
    expect(compromissos.textContent).toContain('09:00 às 12:00 · Manada Filmes');
    expect(compromissos.textContent).toContain('17:00 às 18:00 · Desigual');
    expect(compromissos.querySelector('a')!.getAttribute('href')).toBe('https://teams.microsoft.com/l/x');
  });

  it('+ Agenda oferece as agendas da conta ainda não vinculadas', () => {
    clicar(container!.querySelector<HTMLButtonElement>('button[aria-label="Adicionar agenda"]')!);
    const item = Array.from(container!.querySelectorAll<HTMLElement>('[role=menuitem]')).find((i) => i.textContent === 'Feriados no Brasil')!;
    clicar(item);
    expect(adicionar).toHaveBeenCalledWith('fer');
  });

  it('a aba escolhida fica lembrada ao voltar', () => {
    clicar(aba('Manada Filmes'));
    act(() => root!.unmount());
    container!.remove();
    montar();
    expect(aba('Manada Filmes').getAttribute('aria-selected')).toBe('true');
  });
});

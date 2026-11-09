import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/api/client';

/**
 * Os botões do topo da conversa (Buscar, Ligar, Chamada de vídeo, Mais opções) existiam sem fazer nada até 30/10/2026.
 * Este teste trava que cada um faz o que diz.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView = vi.fn();

const ME = 'u-eu';
let thread: Record<string, unknown>;
const assign = vi.fn();
const updateStatus = vi.fn();
const videoCall = vi.fn();
const mensagens = [
  { id: 'm1', direction: 'inbound', content: 'Bom dia, segue o orçamento', attachmentUrl: null, attachmentFilename: null, deliveryStatus: 'delivered', createdAt: '2026-10-30T12:00:00Z' },
  { id: 'm2', direction: 'outbound', content: 'Recebido, obrigado!', attachmentUrl: null, attachmentFilename: null, deliveryStatus: 'read', createdAt: '2026-10-30T12:01:00Z' },
  { id: 'm3', direction: 'inbound', content: 'Qual o prazo do ORÇAMENTO?', attachmentUrl: null, attachmentFilename: null, deliveryStatus: 'delivered', createdAt: '2026-10-30T12:02:00Z' },
];

vi.mock('@/hooks/use-inbox', () => ({
  useInboxThread: () => ({ data: thread }),
  useInboxMessages: () => ({ data: mensagens, isPending: false }),
  useSendInboxMessage: () => ({ mutate: vi.fn(), error: null }),
  useSendInboxMedia: () => ({ mutate: vi.fn(), error: null }),
  useSendInboxSticker: () => ({ mutate: vi.fn() }),
  useMarkInboxRead: () => ({ mutate: vi.fn() }),
  useInboxMentionables: () => ({ data: [] }),
  useAssignInboxThread: () => ({ mutate: assign }),
  useUpdateInboxStatus: () => ({ mutate: updateStatus }),
  useCreateInboxVideoCall: () => ({ mutate: videoCall, isPending: false }),
}));
vi.mock('@/hooks/use-me', () => ({ useMe: () => ({ data: { id: ME } }) }));

const { ThreadChat } = await import('./thread-chat');

let root: ReturnType<typeof createRoot> | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  thread = { id: 't1', kind: 'individual', channel: 'whatsapp', contactName: 'Maria', contactPhone: '5518996326160', externalChatId: '5518996326160@c.us', status: 'open', assignedToUserId: null, unreadCount: 0 };
  for (const f of [assign, updateStatus, videoCall]) f.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<ThreadChat threadId="t1" />));
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

const botao = (nome: string) => container!.querySelector<HTMLButtonElement>(`button[aria-label="${nome}"]`)!;
const itens = () => Array.from(container!.querySelectorAll<HTMLElement>('[role=menuitem]'));
const item = (texto: string) => itens().find((i) => i.textContent === texto)!;
const clicar = (el: HTMLElement) => act(() => { el.click(); });
const bolhas = () => Array.from(container!.querySelectorAll('p.whitespace-pre-wrap')).map((p) => p.textContent);

function digitar(input: HTMLInputElement | HTMLTextAreaElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!;
  act(() => {
    setter.call(input, valor);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('cabeçalho da conversa', () => {
  it('Buscar filtra as mensagens sem diferenciar maiúscula e diz quantas sobraram', () => {
    clicar(botao('Buscar na conversa'));
    digitar(container!.querySelector<HTMLInputElement>('input[aria-label="Buscar nesta conversa"]')!, 'orçamento');
    expect(bolhas()).toEqual(['Bom dia, segue o orçamento', 'Qual o prazo do ORÇAMENTO?']);
    expect(container!.textContent).toContain('2 de 3');
    clicar(botao('Fechar busca'));
    expect(bolhas()).toHaveLength(3);
  });

  it('Buscar sem resultado diz que não achou, em vez de lista vazia muda', () => {
    clicar(botao('Buscar na conversa'));
    digitar(container!.querySelector<HTMLInputElement>('input[aria-label="Buscar nesta conversa"]')!, 'boleto');
    expect(container!.textContent).toContain('Nada com “boleto” nas últimas 3 mensagens.');
  });

  it('Ligar oferece o WhatsApp e o celular do contato', () => {
    clicar(botao('Ligar'));
    expect(item('Ligar pelo WhatsApp').getAttribute('href')).toBe('https://wa.me/5518996326160');
    expect(item('Ligar pelo celular').getAttribute('href')).toBe('tel:+5518996326160');
  });

  it('Ligar em grupo não oferece número nenhum', () => {
    thread = { ...thread, kind: 'group', externalChatId: '1203@g.us', contactPhone: null };
    act(() => root!.render(<ThreadChat threadId="t1" />));
    clicar(botao('Ligar'));
    expect(itens().every((i) => i.tagName === 'BUTTON' && (i as HTMLButtonElement).disabled)).toBe(true);
  });

  it('Chamada de vídeo põe o link do Teams no campo, sem enviar', () => {
    videoCall.mockImplementation((_: unknown, opts: { onSuccess: (r: { join_url: string }) => void }) => opts.onSuccess({ join_url: 'https://teams.microsoft.com/l/x' }));
    clicar(botao('Chamada de vídeo'));
    expect(container!.querySelector('textarea')!.value).toBe('Vamos falar por vídeo? Entre por aqui: https://teams.microsoft.com/l/x');
    expect(container!.textContent).toContain('Revise e envie');
  });

  it('Chamada de vídeo sem agenda Microsoft explica o que fazer', () => {
    videoCall.mockImplementation((_: unknown, opts: { onError: (e: unknown) => void }) => opts.onError(new ApiRequestError('Conecte sua agenda Microsoft em Configurações para criar chamadas de vídeo.', 409)));
    clicar(botao('Chamada de vídeo'));
    expect(container!.querySelector('[role=status]')!.textContent).toContain('Conecte sua agenda Microsoft');
    expect(container!.querySelector('textarea')!.value).toBe('');
  });

  it('Mais opções: atender, encerrar e abrir no WhatsApp', () => {
    clicar(botao('Mais opções'));
    clicar(item('Atender esta conversa'));
    expect(assign).toHaveBeenCalledWith(ME);
    clicar(botao('Mais opções'));
    clicar(item('Encerrar atendimento'));
    expect(updateStatus).toHaveBeenCalledWith('archived');
    clicar(botao('Mais opções'));
    expect(item('Abrir no WhatsApp').getAttribute('href')).toBe('https://wa.me/5518996326160');
  });

  it('Mais opções mostra o inverso quando a conversa já é minha e está encerrada', () => {
    thread = { ...thread, assignedToUserId: ME, status: 'archived' };
    act(() => root!.render(<ThreadChat threadId="t1" />));
    clicar(botao('Mais opções'));
    clicar(item('Deixar de atender'));
    expect(assign).toHaveBeenCalledWith(null);
    clicar(botao('Mais opções'));
    clicar(item('Reabrir conversa'));
    expect(updateStatus).toHaveBeenCalledWith('open');
  });
});

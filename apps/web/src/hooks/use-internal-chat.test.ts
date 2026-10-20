import { QueryClient, type InfiniteData } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn(), apiUploadWithProgress: vi.fn() }));

import { applyInternalChatEvent, flattenMessages, setOpenConversation, type ChatConversation, type ChatMessage } from './use-internal-chat';

type Page = { messages: ChatMessage[]; has_more: boolean };

function mensagem(id: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id, conversation_id: 'c-dm', sender_id: 'ana', sender_name: 'Ana', sender_avatar_url: null, content: `oi ${id}`,
    client_message_id: `cm-${id}`, reply_to: null, mentions: [], created_at: '2026-10-20T12:00:00.000Z', edited_at: null,
    deleted: false, attachments: [], reactions: [], ...extra,
  };
}

function conversa(id: string, kind: ChatConversation['kind'], unread = 0, at = '2026-10-20T10:00:00.000Z'): ChatConversation {
  return { id, kind, title: id, partner: null, last_message: { content: 'x', deleted: false, has_attachment: false, sender_id: 'x', created_at: at }, unread_count: unread, muted: false };
}

function montar() {
  const qc = new QueryClient();
  qc.setQueryData<ChatConversation[]>(['internal-chat', 'conversations'], [conversa('c-geral', 'general'), conversa('c-outra', 'direct', 0, '2026-10-20T11:00:00.000Z'), conversa('c-dm', 'direct')]);
  qc.setQueryData<number>(['internal-chat', 'unread'], 0);
  qc.setQueryData<InfiniteData<Page>>(['internal-chat', 'messages', 'c-dm'], { pages: [{ messages: [mensagem('m1')], has_more: false }], pageParams: [null] });
  return qc;
}

describe('eventos ao vivo da Comunicação', () => {
  it('mensagem de outra pessoa entra na conversa, soma não lida e sobe a privada (o #Geral fica no topo)', () => {
    const qc = montar();
    setOpenConversation(null);
    applyInternalChatEvent(qc, { event: 'message.created', conversation_id: 'c-dm', message: mensagem('m2', { created_at: '2026-10-20T12:30:00.000Z' }) }, 'eu');
    const lista = qc.getQueryData<ChatConversation[]>(['internal-chat', 'conversations'])!;
    expect(lista.map((c) => c.id)).toEqual(['c-geral', 'c-dm', 'c-outra']);
    expect(lista.find((c) => c.id === 'c-dm')!.unread_count).toBe(1);
    expect(qc.getQueryData(['internal-chat', 'unread'])).toBe(1);
    expect(flattenMessages(qc.getQueryData(['internal-chat', 'messages', 'c-dm'])).map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('a própria mensagem (outra aba) não conta como não lida, e substitui a bolha otimista em vez de duplicar', () => {
    const qc = montar();
    qc.setQueryData<InfiniteData<Page>>(['internal-chat', 'messages', 'c-dm'], { pages: [{ messages: [mensagem('local-x', { sender_id: 'eu', client_message_id: 'cm-x', local_status: 'sending' })], has_more: false }], pageParams: [null] });
    applyInternalChatEvent(qc, { event: 'message.created', conversation_id: 'c-dm', message: mensagem('real-x', { sender_id: 'eu', client_message_id: 'cm-x' }) }, 'eu');
    const msgs = flattenMessages(qc.getQueryData(['internal-chat', 'messages', 'c-dm']));
    expect(msgs.map((m) => m.id)).toEqual(['real-x']);
    expect(msgs[0]!.local_status).toBeUndefined();
    expect(qc.getQueryData(['internal-chat', 'unread'])).toBe(0);
  });

  it('o mesmo evento chegando duas vezes não duplica a mensagem', () => {
    const qc = montar();
    const evento = { event: 'message.created', conversation_id: 'c-dm', message: mensagem('m2') };
    applyInternalChatEvent(qc, evento, 'eu');
    applyInternalChatEvent(qc, evento, 'eu');
    expect(flattenMessages(qc.getQueryData(['internal-chat', 'messages', 'c-dm'])).filter((m) => m.id === 'm2')).toHaveLength(1);
  });

  it('conversa que a tela ainda não conhece (privada nova) busca a lista de novo', () => {
    const qc = montar();
    const invalidar = vi.spyOn(qc, 'invalidateQueries');
    applyInternalChatEvent(qc, { event: 'message.created', conversation_id: 'c-nova', message: mensagem('m9', { conversation_id: 'c-nova' }) }, 'eu');
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ['internal-chat', 'conversations'] });
  });

  it('edição/remoção/reação atualizam a mensagem no lugar; leitura em outra aba zera o contador', () => {
    const qc = montar();
    applyInternalChatEvent(qc, { event: 'message.created', conversation_id: 'c-dm', message: mensagem('m2') }, 'eu');
    applyInternalChatEvent(qc, { event: 'message.updated', conversation_id: 'c-dm', message: mensagem('m2', { deleted: true, content: null }) }, 'eu');
    expect(flattenMessages(qc.getQueryData(['internal-chat', 'messages', 'c-dm'])).find((m) => m.id === 'm2')!.deleted).toBe(true);
    applyInternalChatEvent(qc, { event: 'conversation.read', conversation_id: 'c-dm' }, 'eu');
    expect(qc.getQueryData<ChatConversation[]>(['internal-chat', 'conversations'])!.find((c) => c.id === 'c-dm')!.unread_count).toBe(0);
    expect(qc.getQueryData(['internal-chat', 'unread'])).toBe(0);
  });

  it('conversa silenciada conta na lista mas não no número da barra lateral', () => {
    const qc = montar();
    qc.setQueryData<ChatConversation[]>(['internal-chat', 'conversations'], (l) => l!.map((c) => (c.id === 'c-dm' ? { ...c, muted: true } : c)));
    applyInternalChatEvent(qc, { event: 'message.created', conversation_id: 'c-dm', message: mensagem('m2') }, 'eu');
    expect(qc.getQueryData<ChatConversation[]>(['internal-chat', 'conversations'])!.find((c) => c.id === 'c-dm')!.unread_count).toBe(1);
    expect(qc.getQueryData(['internal-chat', 'unread'])).toBe(0);
  });
});

import { http, HttpResponse } from 'msw';

/**
 * COMUNICAÇÃO DA DEMO — #Geral com algumas mensagens e uma privada. Só modo
 * mock: no ar, tudo vem de /internal-chat na API (ver internal-chat/routes.ts).
 */

const ME = 'user-admin-master';
const M = 60_000;
const agora = Date.now();

const membros = [
  { id: ME, name: 'Pedro Gabriel', avatar_url: null, is_me: true, online: true },
  { id: 'user-ana', name: 'Ana Ribeiro', avatar_url: null, is_me: false, online: true },
  { id: 'user-bruno', name: 'Bruno Lima', avatar_url: null, is_me: false, online: false },
];

type Msg = Record<string, unknown> & { id: string; conversation_id: string; created_at: string };

function msg(id: string, conversation_id: string, sender_id: string, content: string, minutosAtras: number): Msg {
  const autor = membros.find((m) => m.id === sender_id)!;
  return {
    id, conversation_id, sender_id, sender_name: autor.name, sender_avatar_url: null, content,
    client_message_id: `demo-${id}`, reply_to: null, mentions: [], created_at: new Date(agora - minutosAtras * M).toISOString(),
    edited_at: null, deleted: false, attachments: [], reactions: [],
  };
}

const mensagens: Msg[] = [
  msg('im-1', 'ic-geral', 'user-ana', 'Bom dia, time! Reunião de pauta às 10h.', 90),
  msg('im-2', 'ic-geral', 'user-bruno', 'Fechado. Levo os números da Cosentino.', 80),
  msg('im-3', 'ic-ana', 'user-ana', 'Pedro, consegue revisar o carrossel antes das 15h?', 20),
];

function conversas() {
  const ultima = (id: string) => mensagens.filter((m) => m.conversation_id === id).at(-1);
  const resumo = (id: string) => { const u = ultima(id); return u ? { content: u.content, deleted: false, has_attachment: false, sender_id: u.sender_id, created_at: u.created_at } : null; };
  return [
    { id: 'ic-geral', kind: 'general', title: 'Geral', partner: null, last_message: resumo('ic-geral'), unread_count: 0, muted: false },
    { id: 'ic-ana', kind: 'direct', title: 'Ana Ribeiro', partner: { id: 'user-ana', name: 'Ana Ribeiro', avatar_url: null, online: true }, last_message: resumo('ic-ana'), unread_count: 1, muted: false },
  ];
}

export const internalChatHandlers = [
  http.get('/internal-chat/conversations', () => HttpResponse.json({ conversations: conversas() })),
  http.get('/internal-chat/unread', () => HttpResponse.json({ unread: 1 })),
  http.get('/internal-chat/members', () => HttpResponse.json({ members: membros })),
  http.get('/internal-chat/attachment-policy', () => HttpResponse.json({
    extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'txt', 'mp4', 'mov', 'zip'],
    max_bytes: { image: 25 * 1024 * 1024, document: 25 * 1024 * 1024, archive: 25 * 1024 * 1024, video: 100 * 1024 * 1024 },
  })),
  http.get('/internal-chat/conversations/:id/messages', ({ params }) =>
    HttpResponse.json({ messages: mensagens.filter((m) => m.conversation_id === params.id), has_more: false })),
  http.post('/internal-chat/conversations/:id/messages', async ({ params, request }) => {
    const body = (await request.json()) as { content: string | null; clientMessageId: string; attachmentIds?: string[] };
    const nova = { ...msg(`im-${Date.now()}`, String(params.id), ME, body.content ?? '', 0), client_message_id: body.clientMessageId };
    mensagens.push(nova);
    return HttpResponse.json(nova, { status: 201 });
  }),
  http.post('/internal-chat/conversations/:id/read', () => HttpResponse.json({ ok: true })),
  http.post('/internal-chat/conversations/:id/typing', () => HttpResponse.json({ ok: true })),
  http.post('/internal-chat/conversations/:id/mute', async ({ request }) => HttpResponse.json({ ok: true, ...((await request.json()) as object) })),
  http.post('/internal-chat/conversations/direct', () => HttpResponse.json({ id: 'ic-ana' })),
  http.get('/internal-chat/conversations/:id/attachments', () => HttpResponse.json({ files: [] })),
  http.get('/internal-chat/search', ({ request }) => {
    const q = (new URL(request.url).searchParams.get('q') ?? '').toLowerCase();
    return HttpResponse.json({ results: mensagens.filter((m) => String(m.content).toLowerCase().includes(q)).reverse() });
  }),
];

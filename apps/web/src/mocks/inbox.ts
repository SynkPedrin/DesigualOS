import type { InboxMessageWire, InboxThreadWire } from '@/lib/api/contracts';

/**
 * INBOX DA DEMO (07/10/2026) — "um dia real de operação da agência", mesmos
 * clientes de `mocks/clients.ts`. 12 conversas: 4 com cliente (Cosentino, G4
 * Educação, Clínica Belá, Autovisual) + 8 internas (time + prospect + os
 * três agentes IA), pra bater o "Todas 12" do mockup. Nunca produção: o
 * adapter real de WhatsApp está BLOCKED_EXTERNAL (ver progress doc).
 */

const M = 60_000;
const D = 86_400_000;

export const mockInboxThreads: InboxThreadWire[] = [
  {
    id: 'thread-cosentino',
    client_id: 'client-cosentino',
    client_name: 'Cosentino',
    contact_id: 'contact-cosentino',
    contact_name: 'Cosentino',
    contact_phone: '5511912340001',
    channel: 'whatsapp',
    status: 'waiting_agency',
    assigned_to_user_id: 'user-admin-master',
    last_message_at: new Date(Date.now() - 18 * M).toISOString(),
    last_message_preview: 'Te envio as variações até hoje 17h. Qualquer ajuste me chama por aqui.',
    unread_count: 2,
  },
  {
    id: 'thread-g4-educacao',
    client_id: 'client-g4-educacao',
    client_name: 'G4 Educação',
    contact_id: 'contact-g4',
    contact_name: 'G4 Educação',
    contact_phone: '5511912340002',
    channel: 'whatsapp',
    status: 'waiting_agency',
    assigned_to_user_id: 'user-admin-master',
    last_message_at: new Date(Date.now() - 42 * M).toISOString(),
    last_message_preview: 'Consegue nos enviar as variações do criativo para amanhã?',
    unread_count: 1,
  },
  {
    id: 'thread-clinica-bela',
    client_id: 'client-clinica-bela',
    client_name: 'Clínica Belá',
    contact_id: 'contact-clinica-bela',
    contact_name: 'Clínica Belá',
    contact_phone: '5511912340003',
    channel: 'whatsapp',
    status: 'open',
    assigned_to_user_id: 'user-admin-master',
    last_message_at: new Date(Date.now() - 1 * D).toISOString(),
    last_message_preview: 'Precisamos de 3 artes para a campanha da semana que vem.',
    unread_count: 0,
  },
  {
    id: 'thread-autovisual',
    client_id: 'client-autovisual',
    client_name: 'Autovisual',
    contact_id: 'contact-autovisual',
    contact_name: 'Autovisual',
    contact_phone: '5511912340004',
    channel: 'whatsapp',
    status: 'open',
    assigned_to_user_id: 'user-admin-master',
    last_message_at: new Date(Date.now() - 1 * D).toISOString(),
    last_message_preview: 'Confirma se o cronograma de vídeos segue mantido?',
    unread_count: 0,
  },
  {
    id: 'thread-matheus',
    client_id: null,
    client_name: null,
    contact_id: 'contact-matheus',
    contact_name: 'Matheus Rial',
    contact_phone: null,
    channel: 'internal',
    status: 'open',
    assigned_to_user_id: 'user-colaborador-1',
    last_message_at: new Date(Date.now() - 1 * D).toISOString(),
    last_message_preview: 'Blz, vou revisar e te retorno',
    unread_count: 0,
  },
  {
    id: 'thread-tami',
    client_id: null,
    client_name: null,
    contact_id: 'contact-tami',
    contact_name: 'Tami Alves',
    contact_phone: null,
    channel: 'internal',
    status: 'open',
    assigned_to_user_id: 'user-colaborador-2',
    last_message_at: new Date(Date.now() - 3 * D).toISOString(),
    last_message_preview: 'O cliente aprovou a direção',
    unread_count: 0,
  },
  {
    id: 'thread-julia',
    client_id: null,
    client_name: null,
    contact_id: 'contact-julia',
    contact_name: 'Julia Prado',
    contact_phone: null,
    channel: 'internal',
    status: 'open',
    assigned_to_user_id: 'user-colaborador-3',
    last_message_at: new Date(Date.now() - 3 * D).toISOString(),
    last_message_preview: 'Pode subir as variações?',
    unread_count: 0,
  },
  {
    id: 'thread-alinhamento-interno',
    client_id: null,
    client_name: null,
    contact_id: 'contact-alinhamento',
    contact_name: 'Alinhamento Interno',
    contact_phone: null,
    channel: 'internal',
    status: 'open',
    assigned_to_user_id: null,
    last_message_at: new Date(Date.now() - 3 * D).toISOString(),
    last_message_preview: 'Você: Ótimo, vamos seguir assim!',
    unread_count: 0,
  },
  {
    id: 'thread-novo-cliente-estetica',
    client_id: null,
    client_name: null,
    contact_id: 'contact-prospect-estetica',
    contact_name: 'Novo cliente — Estética',
    contact_phone: '5511912340099',
    channel: 'whatsapp',
    status: 'open',
    assigned_to_user_id: null,
    last_message_at: new Date(Date.now() - 4 * D).toISOString(),
    last_message_preview: 'Qual o investimento para começar?',
    unread_count: 0,
  },
  {
    id: 'thread-jarbas',
    client_id: null,
    client_name: null,
    contact_id: 'contact-jarbas-ia',
    contact_name: 'Jarbas (IA)',
    contact_phone: null,
    channel: 'internal',
    status: 'open',
    assigned_to_user_id: null,
    last_message_at: new Date(Date.now() - 4 * D).toISOString(),
    last_message_preview: 'Mídia liberada para subir',
    unread_count: 0,
  },
  {
    id: 'thread-suzy',
    client_id: null,
    client_name: null,
    contact_id: 'contact-suzy-ia',
    contact_name: 'Suzy (IA)',
    contact_phone: null,
    channel: 'internal',
    status: 'open',
    assigned_to_user_id: null,
    last_message_at: new Date(Date.now() - 4 * D).toISOString(),
    last_message_preview: '23 novos leads qualificados',
    unread_count: 0,
  },
  {
    id: 'thread-otto',
    client_id: null,
    client_name: null,
    contact_id: 'contact-otto-ia',
    contact_name: 'Otto (IA)',
    contact_phone: null,
    channel: 'internal',
    status: 'open',
    assigned_to_user_id: null,
    last_message_at: new Date(Date.now() - 5 * D).toISOString(),
    last_message_preview: '3 copies geradas para revisão',
    unread_count: 0,
  },
];

export const mockInboxMessages: Record<string, InboxMessageWire[]> = {
  'thread-cosentino': [
    { id: 'msg-cos-1', direction: 'inbound', sender_contact_id: 'contact-cosentino', sender_user_id: null, content: 'Precisamos ajustar o direcionamento da campanha de outubro.', attachment_url: null, delivery_status: 'delivered', created_at: new Date(Date.now() - 24 * M).toISOString() },
    { id: 'msg-cos-2', direction: 'inbound', sender_contact_id: 'contact-cosentino', sender_user_id: null, content: 'Os resultados da última semana não foram como esperávamos e queremos revisar o criativo.', attachment_url: null, delivery_status: 'delivered', created_at: new Date(Date.now() - 23 * M).toISOString() },
    { id: 'msg-cos-3', direction: 'outbound', sender_contact_id: null, sender_user_id: 'user-admin-master', content: 'Perfeito, vou analisar os dados e já te retorno com algumas sugestões.', attachment_url: null, delivery_status: 'read', created_at: new Date(Date.now() - 21 * M).toISOString() },
    { id: 'msg-cos-4', direction: 'inbound', sender_contact_id: 'contact-cosentino', sender_user_id: null, content: 'Consegue também incluir uma variação focada no público de arquitetos?', attachment_url: null, delivery_status: 'delivered', created_at: new Date(Date.now() - 17 * M).toISOString() },
    { id: 'msg-cos-5', direction: 'inbound', sender_contact_id: 'contact-cosentino', sender_user_id: null, content: 'Referência campanha.pdf', attachment_url: '/docs/referencia-campanha.pdf', delivery_status: 'delivered', created_at: new Date(Date.now() - 16 * M).toISOString() },
    { id: 'msg-cos-6', direction: 'inbound', sender_contact_id: 'contact-cosentino', sender_user_id: null, content: null, attachment_url: 'https://cdn.example.com/mock/audio/mensagem-de-voz.ogg', delivery_status: 'delivered', created_at: new Date(Date.now() - 13 * M).toISOString() },
    { id: 'msg-cos-7', direction: 'inbound', sender_contact_id: 'contact-cosentino', sender_user_id: null, content: 'Ótimo! Aguardamos o material. Qual o prazo para envio?', attachment_url: null, delivery_status: 'delivered', created_at: new Date(Date.now() - 10 * M).toISOString() },
    { id: 'msg-cos-8', direction: 'outbound', sender_contact_id: null, sender_user_id: 'user-admin-master', content: 'Te envio as variações até hoje 17h. Qualquer ajuste me chama por aqui.', attachment_url: null, delivery_status: 'read', created_at: new Date(Date.now() - 18 * M).toISOString() },
  ],
  'thread-g4-educacao': [
    { id: 'msg-g4-1', direction: 'inbound', sender_contact_id: 'contact-g4', sender_user_id: null, content: 'Consegue nos enviar as variações do criativo para amanhã?', attachment_url: null, delivery_status: 'delivered', created_at: new Date(Date.now() - 42 * M).toISOString() },
  ],
  'thread-clinica-bela': [
    { id: 'msg-cb-1', direction: 'inbound', sender_contact_id: 'contact-clinica-bela', sender_user_id: null, content: 'Precisamos de 3 artes para a campanha da semana que vem.', attachment_url: null, delivery_status: 'delivered', created_at: new Date(Date.now() - 1 * D).toISOString() },
  ],
  'thread-autovisual': [
    { id: 'msg-av-1', direction: 'inbound', sender_contact_id: 'contact-autovisual', sender_user_id: null, content: 'Confirma se o cronograma de vídeos segue mantido?', attachment_url: null, delivery_status: 'delivered', created_at: new Date(Date.now() - 1 * D).toISOString() },
  ],
  'thread-matheus': [
    { id: 'msg-mat-1', direction: 'inbound', sender_contact_id: 'contact-matheus', sender_user_id: null, content: 'Blz, vou revisar e te retorno', attachment_url: null, delivery_status: 'delivered', created_at: new Date(Date.now() - 1 * D).toISOString() },
  ],
  'thread-tami': [
    { id: 'msg-tami-1', direction: 'inbound', sender_contact_id: 'contact-tami', sender_user_id: null, content: 'O cliente aprovou a direção', attachment_url: null, delivery_status: 'delivered', created_at: new Date(Date.now() - 3 * D).toISOString() },
  ],
  'thread-julia': [
    { id: 'msg-julia-1', direction: 'inbound', sender_contact_id: 'contact-julia', sender_user_id: null, content: 'Pode subir as variações?', attachment_url: null, delivery_status: 'delivered', created_at: new Date(Date.now() - 3 * D).toISOString() },
  ],
  'thread-alinhamento-interno': [
    { id: 'msg-alin-1', direction: 'outbound', sender_contact_id: null, sender_user_id: 'user-admin-master', content: 'Ótimo, vamos seguir assim!', attachment_url: null, delivery_status: 'read', created_at: new Date(Date.now() - 3 * D).toISOString() },
  ],
  'thread-novo-cliente-estetica': [
    { id: 'msg-prospect-1', direction: 'inbound', sender_contact_id: 'contact-prospect-estetica', sender_user_id: null, content: 'Qual o investimento para começar?', attachment_url: null, delivery_status: 'delivered', created_at: new Date(Date.now() - 4 * D).toISOString() },
  ],
  'thread-jarbas': [
    { id: 'msg-jarbas-1', direction: 'inbound', sender_contact_id: 'contact-jarbas-ia', sender_user_id: null, content: 'Mídia liberada para subir', attachment_url: null, delivery_status: 'delivered', created_at: new Date(Date.now() - 4 * D).toISOString() },
  ],
  'thread-suzy': [
    { id: 'msg-suzy-1', direction: 'inbound', sender_contact_id: 'contact-suzy-ia', sender_user_id: null, content: '23 novos leads qualificados', attachment_url: null, delivery_status: 'delivered', created_at: new Date(Date.now() - 4 * D).toISOString() },
  ],
  'thread-otto': [
    { id: 'msg-otto-1', direction: 'inbound', sender_contact_id: 'contact-otto-ia', sender_user_id: null, content: '3 copies geradas para revisão', attachment_url: null, delivery_status: 'delivered', created_at: new Date(Date.now() - 5 * D).toISOString() },
  ],
};

let proximoId = 100;

export function addInboxMessage(threadId: string, message: InboxMessageWire): void {
  const lista = mockInboxMessages[threadId] ?? [];
  mockInboxMessages[threadId] = [...lista, message];
  const thread = mockInboxThreads.find((t) => t.id === threadId);
  if (thread) {
    thread.last_message_at = message.created_at;
    thread.status = message.direction === 'outbound' ? 'waiting_client' : 'waiting_agency';
  }
}

export function nextInboxMessageId(): string {
  return `msg-mock-${++proximoId}`;
}

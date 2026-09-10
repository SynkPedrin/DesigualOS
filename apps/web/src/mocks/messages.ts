import type { MessageThreadPrefsWire, MessageWire, UpdateMessageThreadPrefsRequestWire } from '@/lib/api/contracts';

let counter = 0;
function nextId() {
  counter += 1;
  return `mock-message-${counter}`;
}

export const messageStore: MessageWire[] = [
  {
    id: nextId(),
    sender_id: 'user-colaborador-1',
    recipient_id: 'user-admin-master',
    content: 'Oi! Consegue revisar o briefing da Clínica X hoje?',
    attachment_url: null,
    attachment_type: null,
    attachment_filename: null,
    read: false,
    created_at: new Date(Date.now() - 40 * 60_000).toISOString(),
  },
];

export function createMessage(input: {
  senderId: string;
  recipientId: string;
  content: string | null;
  attachmentUrl?: string | null;
  attachmentType?: string | null;
  attachmentFilename?: string | null;
}): MessageWire {
  const message: MessageWire = {
    id: nextId(),
    sender_id: input.senderId,
    recipient_id: input.recipientId,
    content: input.content,
    attachment_url: input.attachmentUrl ?? null,
    attachment_type: input.attachmentType ?? null,
    attachment_filename: input.attachmentFilename ?? null,
    read: false,
    created_at: new Date().toISOString(),
  };
  messageStore.push(message);
  return message;
}

export function listThreadMessages(meId: string, partnerId: string): MessageWire[] {
  return messageStore
    .filter(
      (m) =>
        (m.sender_id === meId && m.recipient_id === partnerId) ||
        (m.sender_id === partnerId && m.recipient_id === meId),
    )
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

export function markThreadRead(meId: string, partnerId: string) {
  for (const message of messageStore) {
    if (message.sender_id === partnerId && message.recipient_id === meId) {
      message.read = true;
    }
  }
}

export function listThreadPartnerIds(meId: string): string[] {
  const ids = new Set<string>();
  for (const message of messageStore) {
    if (message.sender_id === meId) ids.add(message.recipient_id);
    if (message.recipient_id === meId) ids.add(message.sender_id);
  }
  return Array.from(ids);
}

// Preferências de thread (favorito/arquivado) do mockMe, espelhando a tabela
// direct_message_thread_prefs. Chaveada por partnerId porque o mock só tem um
// "eu" (mockMe).
const threadPrefsStore = new Map<string, MessageThreadPrefsWire>();

export function getThreadPrefs(meId: string, partnerId: string): MessageThreadPrefsWire {
  return (
    threadPrefsStore.get(partnerId) ?? {
      user_id: meId,
      partner_id: partnerId,
      favorited: false,
      archived: false,
      favorited_at: null,
      archived_at: null,
      updated_at: new Date().toISOString(),
    }
  );
}

export function updateThreadPrefs(meId: string, partnerId: string, input: UpdateMessageThreadPrefsRequestWire): MessageThreadPrefsWire {
  const current = getThreadPrefs(meId, partnerId);
  const now = new Date().toISOString();
  const next: MessageThreadPrefsWire = {
    ...current,
    ...(input.favorite !== undefined
      ? { favorited: input.favorite, favorited_at: input.favorite ? now : null }
      : {}),
    ...(input.archived !== undefined
      ? { archived: input.archived, archived_at: input.archived ? now : null }
      : {}),
    updated_at: now,
  };
  threadPrefsStore.set(partnerId, next);
  return next;
}

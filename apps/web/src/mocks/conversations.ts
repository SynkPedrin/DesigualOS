import type { AgentName } from '@desigual-os/types';
import type { ConversationMessageWire, ConversationSummaryWire } from '@/lib/api/contracts';
import { mockClients } from './clients';

function minutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

interface MockConversation {
  summary: ConversationSummaryWire;
  messages: ConversationMessageWire[];
}

let conversationSeq = 0;
function nextConversationId(): string {
  conversationSeq += 1;
  return `conv-${conversationSeq}`;
}

function buildSeedConversation(
  agent: AgentName,
  clientId: string | null,
  updatedMinutesAgo: number,
  exchanges: Array<{ user: string; assistant: string }>,
): MockConversation {
  const id = nextConversationId();
  const messages: ConversationMessageWire[] = [];
  let cursor = updatedMinutesAgo + exchanges.length * 2;
  for (const exchange of exchanges) {
    messages.push({
      id: `${id}-u${messages.length}`,
      role: 'user',
      agent: null,
      content: exchange.user,
      created_at: minutesAgo(cursor),
    });
    cursor -= 1;
    messages.push({
      id: `${id}-a${messages.length}`,
      role: 'assistant',
      agent,
      content: exchange.assistant,
      created_at: minutesAgo(cursor),
    });
    cursor -= 1;
  }

  const lastExchange = exchanges[exchanges.length - 1];
  const createdAt = minutesAgo(updatedMinutesAgo + exchanges.length * 2);
  return {
    summary: {
      id,
      client_id: clientId,
      title: null,
      status: 'open',
      last_agent: agent,
      last_message_preview: lastExchange?.assistant.slice(0, 96) ?? null,
      created_at: createdAt,
      updated_at: minutesAgo(updatedMinutesAgo),
    },
    messages,
  };
}

const seedPlan: MockConversation[] = [
  buildSeedConversation('jarbas', mockClients[0]?.id ?? null, 15, [
    {
      user: 'Como está a campanha de setembro?',
      assistant: 'O CPA está dentro da meta e o ROAS acumulado do período segue estável, dá pra escalar o orçamento com segurança.',
    },
  ]),
  buildSeedConversation('suzy', mockClients[1]?.id ?? null, 60, [
    {
      user: 'Quais leads precisam de follow-up hoje?',
      assistant: 'Separei 4 leads quentes que responderam nas últimas 24h, sugiro priorizar o contato ainda hoje.',
    },
  ]),
  buildSeedConversation('bento', null, 180, [
    {
      user: 'Qual o processo pra pedir reembolso?',
      assistant: 'O processo está documentado no ClickUp, é só abrir uma tarefa na lista "Financeiro" com o comprovante anexado.',
    },
  ]),
  buildSeedConversation('studio', mockClients[2]?.id ?? null, 300, [
    {
      user: 'Preciso de um carrossel pra divulgar o novo produto',
      assistant: 'Preparei um briefing de criativo usando o Brand Kit do cliente, recomendo três variações pra teste A/B.',
    },
  ]),
  buildSeedConversation('jarbas', mockClients[0]?.id ?? null, 720, [
    {
      user: 'Faz um relatório da campanha do mês passado',
      assistant: 'Relatório pronto: investimento total dentro do orçado, CPA 8% abaixo da meta.',
    },
  ]),
];

export const conversationStore = new Map<string, MockConversation>(seedPlan.map((c) => [c.summary.id, c]));

export function listConversations(agent: AgentName | null): ConversationSummaryWire[] {
  return Array.from(conversationStore.values())
    .filter((c) => !agent || c.summary.last_agent === agent)
    .sort((a, b) => new Date(b.summary.updated_at).getTime() - new Date(a.summary.updated_at).getTime())
    .map((c) => c.summary);
}

export function getConversationMessages(id: string): ConversationMessageWire[] | null {
  return conversationStore.get(id)?.messages ?? null;
}

let messageSeq = 0;
function nextMessageId(): string {
  messageSeq += 1;
  return `msg-${messageSeq}`;
}

/** POST /chat with no conversation_id starts a new one; with one, appends to it (confirmed
 * real behavior, 2026-09-01). Returns the conversation id either way. */
export function appendUserMessage(
  conversationId: string | null,
  clientId: string | null,
  message: string,
): string {
  const now = new Date().toISOString();
  if (conversationId && conversationStore.has(conversationId)) {
    const conversation = conversationStore.get(conversationId)!;
    conversation.messages.push({ id: nextMessageId(), role: 'user', agent: null, content: message, created_at: now });
    conversation.summary.updated_at = now;
    return conversationId;
  }

  const id = nextConversationId();
  conversationStore.set(id, {
    summary: {
      id,
      client_id: clientId,
      title: null,
      status: 'open',
      last_agent: null,
      last_message_preview: null,
      created_at: now,
      updated_at: now,
    },
    messages: [{ id: nextMessageId(), role: 'user', agent: null, content: message, created_at: now }],
  });
  return id;
}

export function appendAssistantMessage(conversationId: string, agent: AgentName, content: string) {
  const conversation = conversationStore.get(conversationId);
  if (!conversation) return;
  const now = new Date().toISOString();
  conversation.messages.push({ id: nextMessageId(), role: 'assistant', agent, content, created_at: now });
  conversation.summary.last_agent = agent;
  conversation.summary.last_message_preview = content.slice(0, 96);
  conversation.summary.updated_at = now;
}

'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import type { AgentName } from '@desigual-os/types';
import { AgentSelector } from './agent-selector';
import { ClientSelector } from './client-selector';
import { Composer } from './composer';
import { ConversationSidebar } from './conversation-sidebar';
import { ChatMessage, type ChatUiMessage } from './chat-message';
import { useSendChatMessage } from '@/hooks/use-send-chat-message';
import { useExecution } from '@/hooks/use-executions';
import { useClients } from '@/hooks/use-clients';
import { apiFetch } from '@/lib/api/client';
import { AGENT_META, FEATURED_AGENTS } from '@/lib/agent-meta';
import { useHoverSound } from '@/hooks/use-hover-sound';
import { useTeamMembers } from '@/hooks/use-team-members';
import { useSendMessage } from '@/hooks/use-messages';
import { useMe } from '@/hooks/use-me';
import { cn } from '@/lib/utils';
import {
  AGENT_SELECTIONS,
  mapConversationMessage,
  type AgentSelection,
  type ConversationMessageWire,
} from '@/lib/api/contracts';

let localMessageSeq = 0;
function nextLocalId() {
  localMessageSeq += 1;
  return `local-${localMessageSeq}`;
}

function isAgentName(value: string | null): value is AgentName {
  return value !== null && (AGENT_SELECTIONS as readonly string[]).includes(value) && value !== 'auto';
}

export function ChatThread() {
  const searchParams = useSearchParams();
  const agentFromQuery = searchParams.get('agent');
  const initialAgent: AgentSelection = isAgentName(agentFromQuery) ? agentFromQuery : 'auto';
  const queryClient = useQueryClient();
  const playHoverSound = useHoverSound();

  const [agentSelection, setAgentSelection] = useState<AgentSelection>(initialAgent);
  const [clientId, setClientId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatUiMessage[]>([]);
  const [pendingExecutionId, setPendingExecutionId] = useState<string | null>(null);
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: clients } = useClients();
  const clientName = clients?.find((c) => c.id === clientId)?.name ?? null;

  const sendMessage = useSendChatMessage();
  const { data: execution } = useExecution(pendingExecutionId);
  const { data: me } = useMe();
  const { data: teamMembers } = useTeamMembers();
  const forwardTargets = teamMembers?.filter((member) => member.id !== me?.id) ?? [];
  const forwardMessage = useSendMessage();

  useEffect(() => {
    if (!execution || !pendingMessageId) return;
    if (execution.status === 'completed' || execution.status === 'failed') {
      // steps[0] pegava o PRIMEIRO agente de um workflow multi-etapa, não o resultado
      // final — at(-1) é a última etapa, que é o que de fato aparece no balão do chat.
      const step = execution.steps.at(-1);
      setMessages((current) =>
        current.map((m) =>
          m.id === pendingMessageId
            ? {
                ...m,
                status: execution.status,
                content: step?.answer ?? '',
                sources: step?.sources ?? [],
              }
            : m,
        ),
      );
      setPendingExecutionId(null);
      setPendingMessageId(null);
    } else if (execution.status !== messages.find((m) => m.id === pendingMessageId)?.status) {
      setMessages((current) =>
        current.map((m) => (m.id === pendingMessageId ? { ...m, status: execution.status } : m)),
      );
    }
  }, [execution, pendingMessageId]); // messages intentionally excluded: this effect writes to it

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  function handleNewConversation() {
    setActiveConversationId(null);
    setMessages([]);
    setPendingExecutionId(null);
    setPendingMessageId(null);
  }

  /** Explicit, one-shot load: deliberately not a reactive query tied to activeConversationId,
   * so a fresh conversation created mid-send (see handleSend) never has its optimistic
   * thinking-steps UI clobbered by a background refetch of the same id. */
  async function handleSelectConversation(id: string) {
    setActiveConversationId(id);
    setPendingExecutionId(null);
    setPendingMessageId(null);
    const wire = await queryClient.fetchQuery({
      queryKey: ['conversations', id, 'messages'],
      queryFn: () => apiFetch<{ conversation_id: string; messages: ConversationMessageWire[] }>(
        `/conversations/${id}/messages`,
      ),
    });
    setMessages(
      wire.messages.map(mapConversationMessage).map((m) => ({
        id: m.id,
        role: m.role,
        agent: m.agent ?? undefined,
        content: m.content,
        status: m.role === 'assistant' ? 'completed' : undefined,
        sources: [],
      })),
    );
  }

  // Deep link de notificação ("Jarbas respondeu" -> /chat?agent=jarbas&conversation=<id>):
  // abre a conversa certa direto, uma vez só, ao montar. Sem isso a notificação levava só
  // pra tela do agente com a lista de conversas, sem abrir a conversa que de fato terminou.
  const didOpenFromQuery = useRef(false);
  useEffect(() => {
    if (didOpenFromQuery.current) return;
    didOpenFromQuery.current = true;
    const conversationFromQuery = searchParams.get('conversation');
    if (conversationFromQuery) {
      void handleSelectConversation(conversationFromQuery);
    }
    // Deliberately mount-only ([]): a one-shot "open from a link" action, not a synced state —
    // searchParams/handleSelectConversation intentionally excluded from deps.
  }, []);

  function handleForward(message: ChatUiMessage, recipientId: string) {
    const agentLabel = message.agent ? AGENT_META[message.agent].label : 'agente';
    forwardMessage.mutate({
      recipientId,
      content: `Encaminhado do chat com ${agentLabel}:\n\n${message.content}`,
    });
  }

  async function handleSend(text: string) {
    const userMessage: ChatUiMessage = { id: nextLocalId(), role: 'user', content: text };
    const assistantMessage: ChatUiMessage = {
      id: nextLocalId(),
      role: 'assistant',
      content: '',
      status: 'queued',
      clientName,
    };
    setMessages((current) => [...current, userMessage, assistantMessage]);

    try {
      const result = await sendMessage.mutateAsync({
        message: text,
        clientId,
        agentSelection,
        conversationId: activeConversationId,
      });

      setActiveConversationId(result.conversationId);
      setMessages((current) =>
        current.map((m) => (m.id === assistantMessage.id ? { ...m, agent: result.agent } : m)),
      );
      setPendingExecutionId(result.executionId);
      setPendingMessageId(assistantMessage.id);
    } catch {
      // Without this, the placeholder stays stuck on "queued" forever — the request never
      // got an execution id to poll, so nothing would ever move it out of that state.
      setMessages((current) =>
        current.map((m) => (m.id === assistantMessage.id ? { ...m, status: 'failed' } : m)),
      );
    }
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      <ConversationSidebar
        agentFilter={isAgentName(agentFromQuery) ? agentFromQuery : null}
        clientFilter={clientId}
        activeConversationId={activeConversationId}
        onSelect={handleSelectConversation}
        onNewConversation={handleNewConversation}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-grafite-elevado pb-4">
          <AgentSelector value={agentSelection} onChange={setAgentSelection} />
          <ClientSelector value={clientId} onChange={setClientId} />
        </div>

        <div ref={scrollRef} className="flex-1 space-y-6 overflow-y-auto pb-4 pr-1">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-8 text-center">
              <div className="flex gap-4">
                {FEATURED_AGENTS.map((agent) => {
                  const meta = AGENT_META[agent];
                  const active = agentSelection === agent;
                  return (
                    <button
                      key={agent}
                      type="button"
                      onClick={() => setAgentSelection(agent)}
                      onMouseEnter={playHoverSound}
                      className={cn(
                        'flex w-28 flex-col items-center gap-2 rounded-lg border p-4 transition-all hover:scale-[1.04] active:scale-[0.97]',
                        active
                          ? 'border-roxo-eletrico bg-roxo-eletrico/10 shadow-glow'
                          : 'border-grafite-elevado bg-grafite hover:border-roxo-eletrico/40 hover:shadow-glow',
                      )}
                    >
                      <div className="relative size-14 overflow-hidden rounded-full ring-1 ring-white/10">
                        <Image src={meta.photoSrc!} alt={meta.label} fill sizes="56px" className="object-cover" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-branco-cru">{meta.label}</p>
                        <p className="font-mono text-[10px] uppercase tracking-wider text-nevoa">{meta.role}</p>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div>
                <p className="font-display text-3xl font-black uppercase tracking-tight text-branco-cru">
                  O que vamos fazer hoje?
                </p>
                <p className="max-w-sm text-sm text-nevoa">
                  Descreva o que você precisa, o AUTO decide qual agente trata melhor o pedido.
                </p>
              </div>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {messages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                >
                  <ChatMessage
                    message={message}
                    forwardTargets={message.role === 'assistant' ? forwardTargets : []}
                    onForward={(recipientId) => handleForward(message, recipientId)}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>

        <Composer
          onSend={handleSend}
          disabled={Boolean(pendingExecutionId) || sendMessage.isPending}
          agentSelection={agentSelection}
        />
      </div>
    </div>
  );
}

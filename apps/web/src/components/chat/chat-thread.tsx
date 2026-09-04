'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from 'framer-motion';
import { ArrowLeft, FolderClosed, MessageCircle } from 'lucide-react';
import type { AgentName, ExecutionStatus } from '@desigual-os/types';
import { ClientSelector } from './client-selector';
import { Composer } from './composer';
import { ChatMessage, type ChatUiMessage } from './chat-message';
import { ConversationSidebar } from './conversation-sidebar';
import { ConversationVisibilityToggle } from './conversation-visibility-toggle';
import { AgentCard, AgentChip, TRAVEL_SPRING, useAgentNodeStatuses } from './agent-spotlight';
import { ChatAmbient } from './chat-ambient';
import { Skeleton } from '@/components/ui/skeleton';
import { useSendChatMessage } from '@/hooks/use-send-chat-message';
import { useExecution } from '@/hooks/use-executions';
import { useClients } from '@/hooks/use-clients';
import { useConversationMessages, useConversations } from '@/hooks/use-conversations';
import { useProjects } from '@/hooks/use-projects';
import { AGENT_META, FEATURED_AGENTS } from '@/lib/agent-meta';
import { useTeamMembers } from '@/hooks/use-team-members';
import { useSendMessage } from '@/hooks/use-messages';
import { useMe } from '@/hooks/use-me';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { AGENT_SELECTIONS, type AgentSelection } from '@/lib/api/contracts';

let localMessageSeq = 0;
function nextLocalId() {
  localMessageSeq += 1;
  return `local-${localMessageSeq}`;
}

function isAgentName(value: string | null): value is AgentName {
  return value !== null && (AGENT_SELECTIONS as readonly string[]).includes(value) && value !== 'auto';
}

/** Chips do topo da thread: AUTO + os 3 agentes de conversa. Studio fica fora
 * do chat (é geração de mídia, não QA por texto). */
const CHAT_CHIP_SELECTIONS = ['auto', ...FEATURED_AGENTS] as const satisfies readonly AgentSelection[];

/**
 * Envio em andamento. O par otimista (pergunta + balão de thinking) vive aqui
 * até o histórico PERSISTIDO (GET /conversations/:id/messages) alcançar a
 * resposta — a partir daí quem renderiza é o banco, nunca o estado local.
 * Por isso refresh e reabrir a conversa sempre mostram tudo.
 */
interface PendingExchange {
  /** null até o POST /chat responder (conversa nova ainda não existe). */
  conversationId: string | null;
  userLocalId: string;
  assistantLocalId: string;
  userText: string;
  agent: AgentName | undefined;
  executionId: string | null;
  status: ExecutionStatus;
  answer: string;
  sources: string[];
  clientName: string | null;
  /** Marca de quando o envio começou, pra casar com created_at das mensagens persistidas. */
  sentAt: number;
}

/**
 * Dois estados dentro do MESMO LayoutGroup:
 *  - vazio (home): cards grandes + saudação + composer herói, centrados;
 *  - conversa: os MESMOS elementos (layoutId `agent-card-*` e `chat-composer`)
 *    docam como chips no topo e composer no rodapé — o framer mede a caixa do
 *    elemento saindo e anima o entrante a partir dela (movimento físico,
 *    transform/opacity only). Saudação e disclaimer saem em fade/slide.
 */
export function ChatThread() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const agentFromQuery = searchParams.get('agent');
  const initialAgent: AgentSelection = isAgentName(agentFromQuery) ? agentFromQuery : 'auto';
  const queryClient = useQueryClient();

  const [agentSelection, setAgentSelection] = useState<AgentSelection>(initialAgent);
  const [clientId, setClientId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingExchange | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);

  const conversationFromQuery = searchParams.get('conversation');
  const projectFromQuery = searchParams.get('project');
  const newChatNonce = searchParams.get('new');

  const { data: clients } = useClients();
  const clientName = clients?.find((c) => c.id === clientId)?.name ?? null;

  // Deep link de projeto (/chat?project=<id>, vindo da seção PROJETOS da sidebar
  // global): a thread vira a lista de conversas do projeto. Sem o param, a query
  // cai na MESMA key do useConversations(null) da sidebar — cache compartilhado,
  // nenhum request extra.
  const { data: projects } = useProjects();
  const { data: projectConversations, isPending: projectConversationsPending } = useConversations(
    null,
    null,
    projectFromQuery,
  );
  const activeProject = projectFromQuery ? (projects ?? []).find((p) => p.id === projectFromQuery) : null;
  const sortedProjectConversations = [...(projectConversations ?? [])].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  const sendMessage = useSendChatMessage();
  const { data: execution } = useExecution(pending?.executionId ?? null);
  const { data: persistedMessages } = useConversationMessages(activeConversationId);
  const { data: me } = useMe();
  const { data: teamMembers } = useTeamMembers();
  const forwardTargets = teamMembers?.filter((member) => member.id !== me?.id) ?? [];
  const forwardMessage = useSendMessage();
  const agentStatuses = useAgentNodeStatuses();
  const reduceMotion = useReducedMotion();

  // Microparallax dos cards: motion values + spring (transform-only), desligado
  // com reduced-motion e ignorado em pointer coarse (touch) dentro do handler.
  const parallaxX = useMotionValue(0);
  const parallaxY = useMotionValue(0);
  const parallaxSpringX = useSpring(parallaxX, { stiffness: 120, damping: 18 });
  const parallaxSpringY = useSpring(parallaxY, { stiffness: 120, damping: 18 });

  function handleCardsMouseMove(event: React.MouseEvent<HTMLDivElement>) {
    if (reduceMotion || !window.matchMedia('(pointer: fine)').matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    parallaxX.set((event.clientX - rect.left) / rect.width - 0.5);
    parallaxY.set((event.clientY - rect.top) / rect.height - 0.5);
  }

  function handleCardsMouseLeave() {
    parallaxX.set(0);
    parallaxY.set(0);
  }

  /** A conversa aberta mora na URL (?conversation=): refresh reabre a thread
   * do banco em vez de cair na tela vazia (bug "refresh apaga a conversa"). */
  function syncConversationParam(conversationId: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (conversationId) {
      params.set('conversation', conversationId);
    } else {
      params.delete('conversation');
    }
    const query = params.toString();
    router.replace(`/chat${query ? `?${query}` : ''}`, { scroll: false });
  }

  // Deep link (notificação "Jarbas respondeu" -> /chat?agent=jarbas&conversation=<id>)
  // e refresh: abre a conversa da URL uma vez, ao montar. O carregamento em si é
  // do useConversationMessages — sem fetch manual aqui.
  const didOpenFromQuery = useRef(false);
  useEffect(() => {
    if (didOpenFromQuery.current) return;
    didOpenFromQuery.current = true;
    const conversationFromQuery = searchParams.get('conversation');
    if (conversationFromQuery) {
      setActiveConversationId(conversationFromQuery);
    }
    // Deliberately mount-only ([]): one-shot "open from the URL", not a synced state.
  }, []);

  // Execution em andamento: atualiza o status do balão de thinking e, ao
  // concluir, preenche a resposta na hora (execution.steps) E invalida o
  // histórico persistido, que assume a renderização assim que alcança.
  useEffect(() => {
    if (!execution || !pending?.executionId) return;
    if (pending.status === 'completed' || pending.status === 'failed') return;
    if (execution.status === 'completed' || execution.status === 'failed') {
      // steps[0] pegava o PRIMEIRO agente de um workflow multi-etapa, não o resultado
      // final — at(-1) é a última etapa, que é o que de fato aparece no balão do chat.
      const step = execution.steps.at(-1);
      setPending((current) =>
        current
          ? { ...current, status: execution.status, answer: step?.answer ?? '', sources: step?.sources ?? [] }
          : current,
      );
      if (pending.conversationId) {
        queryClient.invalidateQueries({ queryKey: ['conversations', pending.conversationId, 'messages'] });
      }
    } else if (execution.status !== pending.status) {
      setPending((current) => (current ? { ...current, status: execution.status } : current));
    }
  }, [execution, pending, queryClient]);

  // Quando o banco alcança (mensagem do assistente persistida depois do envio),
  // aposenta o par otimista: a thread passa a renderizar só o histórico.
  useEffect(() => {
    if (!pending || pending.status !== 'completed' || !persistedMessages) return;
    const caughtUp = persistedMessages.some(
      (message) => message.role === 'assistant' && new Date(message.createdAt).getTime() >= pending.sentAt,
    );
    if (caughtUp) setPending(null);
  }, [persistedMessages, pending]);

  const persistedUi: ChatUiMessage[] = (persistedMessages ?? []).map((message) => ({
    id: message.id,
    role: message.role,
    agent: message.agent ?? undefined,
    content: message.content,
    status: message.role === 'assistant' ? 'completed' : undefined,
    sources: [],
  }));

  let messages = persistedUi;
  if (pending && pending.conversationId === activeConversationId) {
    const userAlreadyPersisted = persistedUi.some(
      (message) => message.role === 'user' && message.content === pending.userText,
    );
    const assistantAlreadyPersisted = persistedUi.some(
      (message) => message.role === 'assistant' && pending.status === 'completed' && message.content === pending.answer,
    );
    messages = [...persistedUi];
    if (!userAlreadyPersisted) {
      messages.push({ id: pending.userLocalId, role: 'user', content: pending.userText });
    }
    if (!assistantAlreadyPersisted) {
      messages.push({
        id: pending.assistantLocalId,
        role: 'assistant',
        agent: pending.agent,
        content: pending.answer,
        status: pending.status,
        sources: pending.sources,
        clientName: pending.clientName,
      });
    }
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, pending?.status]);

  function handleNewConversation() {
    setActiveConversationId(null);
    syncConversationParam(null);
  }

  function handleSelectConversation(id: string) {
    if (id === activeConversationId) return;
    setActiveConversationId(id);
    syncConversationParam(id);
  }

  function handleForward(message: ChatUiMessage, recipientId: string) {
    const agentLabel = message.agent ? AGENT_META[message.agent].label : 'agente';
    forwardMessage.mutate({
      recipientId,
      content: `Encaminhado do chat com ${agentLabel}:\n\n${message.content}`,
    });
  }

  async function handleSend(text: string) {
    const sentAt = Date.now();
    const exchange: PendingExchange = {
      conversationId: activeConversationId,
      userLocalId: nextLocalId(),
      assistantLocalId: nextLocalId(),
      userText: text,
      agent: undefined,
      executionId: null,
      status: 'queued',
      answer: '',
      sources: [],
      clientName,
      sentAt,
    };
    setPending(exchange);

    try {
      const result = await sendMessage.mutateAsync({
        message: text,
        clientId,
        agentSelection,
        conversationId: activeConversationId,
      });

      setPending((current) =>
        current && current.userLocalId === exchange.userLocalId
          ? { ...current, conversationId: result.conversationId, executionId: result.executionId, agent: result.agent }
          : current,
      );
      if (result.conversationId !== activeConversationId) {
        setActiveConversationId(result.conversationId);
        syncConversationParam(result.conversationId);
      }
      // POST /chat já gravou a pergunta no banco antes de responder: refetch
      // imediato substitui a mensagem otimista do usuário pela persistida.
      queryClient.invalidateQueries({ queryKey: ['conversations', result.conversationId, 'messages'] });
    } catch {
      // Sem execution id pra pollar, nada tiraria o placeholder do estado
      // "queued" — falha honesta no balão.
      setPending((current) => (current ? { ...current, status: 'failed' } : current));
    }
  }

  const isExchangeActive =
    pending !== null &&
    pending.conversationId === activeConversationId &&
    pending.status !== 'completed' &&
    pending.status !== 'failed';

  const composerDisabled = sendMessage.isPending || isExchangeActive;

  /** Chip que mostra o pulso "pensando…": agente resolvido pelo POST /chat, ou
   * a seleção atual enquanto a resposta não chega. */
  const processingSelection: AgentSelection | null = isExchangeActive
    ? (pending.agent ?? agentSelection)
    : null;

  const hasMessages = messages.length > 0;
  const firstName = me?.name?.trim().split(/\s+/)[0] || 'Time';

  return (
    <LayoutGroup>
      <div className="flex h-[calc(100vh-8rem)] gap-4">
        <ConversationSidebar
          agentFilter={isAgentName(agentFromQuery) ? agentFromQuery : null}
          clientFilter={clientId}
          activeConversationId={activeConversationId}
          onSelect={handleSelectConversation}
          onNewConversation={handleNewConversation}
          onDeleteConversation={(id) => {
            if (id === activeConversationId) handleNewConversation();
          }}
        />

        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <ChatAmbient dimmed={hasMessages} />

        <AnimatePresence initial={false}>
          {!hasMessages && (
            <motion.div
              key="chat-home"
              className="relative flex flex-1 flex-col items-center justify-center gap-8 px-4"
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
            >
              <div
                className="flex flex-wrap items-center justify-center gap-4 sm:gap-6"
                onMouseMove={handleCardsMouseMove}
                onMouseLeave={handleCardsMouseLeave}
              >
                {FEATURED_AGENTS.map((agent, index) => (
                  <AgentCard
                    key={agent}
                    agent={agent}
                    index={index}
                    selected={agentSelection === agent}
                    status={agentStatuses?.[agent] ?? null}
                    parallaxX={parallaxSpringX}
                    parallaxY={parallaxSpringY}
                    onSelect={setAgentSelection}
                  />
                ))}
              </div>

              <div className="max-w-2xl text-center">
                <h1 className="font-display text-5xl font-black uppercase leading-none tracking-tight text-branco-cru md:text-6xl">
                  Pode falar,{' '}
                  <span className="bg-gradient-to-r from-roxo-eletrico to-magenta-spark bg-clip-text text-transparent">
                    {firstName}
                  </span>
                </h1>
                <p className="mt-3 text-sm text-nevoa md:text-base">
                  Descreva o que você precisa — o AUTO roteia para o agente certo, ou escolha um especialista acima.
                </p>
              </div>

              <motion.div layoutId="chat-composer" transition={TRAVEL_SPRING} className="w-full max-w-3xl">
                <Composer
                  onSend={handleSend}
                  disabled={composerDisabled}
                  agentSelection={agentSelection}
                  variant="hero"
                  showDisclaimer={false}
                />
              </motion.div>

              <p className="text-xs text-nevoa">
                Desigual OS pode cometer erros. Sempre valide informações críticas.
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {hasMessages && (
          <div className="relative flex min-h-0 flex-1 flex-col">
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: 'easeOut', delay: 0.1 }}
              className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                {CHAT_CHIP_SELECTIONS.map((selection) => (
                  <AgentChip
                    key={selection}
                    selection={selection}
                    selected={agentSelection === selection}
                    processing={processingSelection === selection}
                    onSelect={setAgentSelection}
                  />
                ))}
              </div>
              <div className="flex items-center gap-3">
                {activeConversationId && <ConversationVisibilityToggle conversationId={activeConversationId} />}
                <ClientSelector value={clientId} onChange={setClientId} />
              </div>
            </motion.div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto pb-4 pr-1">
              <div className="mx-auto max-w-3xl space-y-6">
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
              </div>
            </div>

            <motion.div
              layoutId="chat-composer"
              transition={TRAVEL_SPRING}
              className="mx-auto w-full max-w-3xl shrink-0"
            >
              <Composer onSend={handleSend} disabled={composerDisabled} agentSelection={agentSelection} />
            </motion.div>
          </div>
        )}
        </div>
      </div>
    </LayoutGroup>
  );
}

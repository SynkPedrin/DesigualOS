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
import { ProjectOverviewPanel } from './project-overview-panel';
import { ProjectFilesSection } from './project-files-section';
import { AgentCard, AgentChip, TRAVEL_SPRING, useAgentNodeStatuses } from './agent-spotlight';
import { ChatAmbient } from './chat-ambient';
import { Skeleton } from '@/components/ui/skeleton';
import { realtimeClient, type MessageDeltaPayload } from '@/lib/realtime/ws-client';
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
import { AGENT_SELECTIONS, type AgentSelection, type ChatAttachmentWire } from '@/lib/api/contracts';

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
 * resposta - a partir daí quem renderiza é o banco, nunca o estado local.
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
  /** Anexos enviados junto com a pergunta (já hospedados via POST /uploads), até 10. */
  attachments: ChatAttachmentWire[];
  /** Fases reais reportadas pelo agent loop via WS (Agentic V2). */
  liveSteps?: string[] | undefined;
  /** Marca de quando o envio começou, pra casar com created_at das mensagens persistidas. */
  sentAt: number;
  /** Watchdog disparou (execution ativa além do teto). Trava o poll da
   * execution: worker morto não atualiza o status no servidor, então o poll
   * seguiria voltando "running" pra sempre e ressuscitaria o balão. */
  watchdogFired?: boolean;
}

/** Se a execution seguir ativa por mais de 6 minutos, o worker provavelmente
 * morreu no meio: o balão vira falha com retry em vez de "pensando" eterno. */
const EXECUTION_WATCHDOG_MS = 6 * 60 * 1000;

/**
 * Dois estados dentro do MESMO LayoutGroup:
 *  - vazio (home): cards grandes + saudação + composer herói, centrados;
 *  - conversa: os MESMOS elementos (layoutId `agent-card-*` e `chat-composer`)
 *    docam como chips no topo e composer no rodapé - o framer mede a caixa do
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
  // cai na MESMA key do useConversations(null) da sidebar - cache compartilhado,
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
  const { data: execution } = useExecution(
    pending?.executionId && !pending.watchdogFired ? pending.executionId : null,
  );
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

  // A conversa aberta segue o ?conversation= da URL: deep link (notificação
  // "Jarbas respondeu" -> /chat?agent=jarbas&conversation=<id>), refresh E a
  // troca de conversa pela sidebar global, que navega na MESMA rota - um efeito
  // mount-only não reagiria. O ref guarda o último valor aplicado pra não
  // derrubar o par otimista quando o próprio handleSend sincroniza a URL.
  // O carregamento em si é do useConversationMessages - sem fetch manual aqui.
  const lastQueryConversation = useRef<string | null>(null);
  useEffect(() => {
    if (conversationFromQuery === lastQueryConversation.current) return;
    lastQueryConversation.current = conversationFromQuery;
    if (conversationFromQuery !== activeConversationId) {
      // Conversa diferente (ou saída pra home/projeto): o par otimista pertence
      // à thread anterior e não pode vazar pra nova.
      setPending(null);
      setActiveConversationId(conversationFromQuery);
    }
  }, [conversationFromQuery, activeConversationId]);

  // "Novo chat" da sidebar global navega pra /chat?new=<nonce>: mesma rota não
  // remonta o ChatThread, então o nonce é o gatilho real de reset - limpa a
  // thread (mensagens derivam de activeConversationId + pending) e foca o
  // composer. O param some da URL em seguida pra não sujar o histórico.
  const lastHandledNewChat = useRef<string | null>(null);
  useEffect(() => {
    if (!newChatNonce || newChatNonce === lastHandledNewChat.current) return;
    lastHandledNewChat.current = newChatNonce;
    lastQueryConversation.current = null;
    setPending(null);
    setActiveConversationId(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete('new');
    params.delete('conversation');
    const query = params.toString();
    router.replace(`/chat${query ? `?${query}` : ''}`, { scroll: false });
    // Foco depois do commit: o reset troca pro composer hero da tela vazia.
    requestAnimationFrame(() => composerTextareaRef.current?.focus());
  }, [newChatNonce, searchParams, router]);

  // Execution em andamento: atualiza o status do balão de thinking e, ao
  // concluir, preenche a resposta na hora (execution.steps) E invalida o
  // histórico persistido, que assume a renderização assim que alcança.
  useEffect(() => {
    if (!execution || !pending?.executionId) return;
    // Só 'completed' é terminal. 'failed' NÃO travava aqui antes, e isso congelava a bolha:
    // quando a 1ª tentativa falhava (ex: timeout) e a 2ª respondia certo, o latch já tinha
    // marcado 'failed' e nenhuma atualização posterior repintava o balão - o usuário ficava com
    // uma bolha vazia pra sempre, mesmo com a resposta real salva em `messages` segundos depois
    // (defeito medido ao vivo em 08/09/2026, briefing da Fratelli pro Otto).
    if (pending.status === 'completed') return;
    if (execution.status === 'completed' || execution.status === 'failed') {
      // steps[0] pegava o PRIMEIRO agente de um workflow multi-etapa, não o resultado
      // final - at(-1) é a última etapa, que é o que de fato aparece no balão do chat.
      const step = execution.steps.at(-1);
      const nextAnswer = step?.answer ?? '';
      const nextSources = step?.sources ?? [];
      // Guarda de repintura: sem ela, uma execução que fica em 'failed' dispararia setPending a
      // cada render (o objeto novo muda a identidade e realimenta o efeito).
      if (pending.status === execution.status && pending.answer === nextAnswer) return;
      setPending((current) =>
        current
          ? { ...current, status: execution.status, answer: nextAnswer, sources: nextSources }
          : current,
      );
      if (pending.conversationId) {
        queryClient.invalidateQueries({ queryKey: ['conversations', pending.conversationId, 'messages'] });
      }
      // Custo/tokens: invalidado globalmente pelo evento WS execution.completed
      // (use-realtime-events.ts), que cobre qualquer aba aberta - não só esta.
    } else if (execution.status !== pending.status) {
      setPending((current) => (current ? { ...current, status: execution.status } : current));
    }
  }, [execution, pending, queryClient]);

  // Watchdog de execution travada (worker morreu sem atualizar o status no
  // servidor): passado o teto, o balão vira falha com opção de tentar de novo.
  // A recuperação tardia segue possível via message.delta (WS), que não lê
  // `watchdogFired` e repinta o balão se a resposta real chegar depois.
  useEffect(() => {
    if (!pending || pending.status === 'completed' || pending.status === 'failed') return;
    const fail = () =>
      setPending((current) =>
        current && current.status !== 'completed' && current.status !== 'failed'
          ? {
              ...current,
              status: 'failed',
              answer: 'O agente demorou demais pra responder. Tente novamente.',
              watchdogFired: true,
            }
          : current,
      );
    const remaining = pending.sentAt + EXECUTION_WATCHDOG_MS - Date.now();
    if (remaining <= 0) {
      fail();
      return;
    }
    const timeout = setTimeout(fail, remaining);
    return () => clearTimeout(timeout);
  }, [pending?.sentAt, pending?.status, pending?.watchdogFired]);

  // Texto ao vivo via WS (message.delta, ver publishMessageDelta no worker):
  // pinta o balão assim que o texto existe, sem esperar o refetch que
  // `execution.completed` dispara (use-realtime-events.ts) nem o próximo
  // tick do poll de 700ms acima. `delta` é sempre o texto ACUMULADO (nunca
  // um diff), então aplicar direto é seguro mesmo se um evento chegar fora
  // de ordem ou duplicado. Hoje chega um único evento por execução (o Chat
  // ainda não tem nenhum agente com streaming token a token de verdade); o
  // mesmo handler já serve pra quando um agente passar a mandar vários
  // eventos com `done: false` no meio.
  useEffect(() => {
    if (!pending?.executionId) return;
    const executionId = pending.executionId;
    return realtimeClient.subscribe((event) => {
      if (event.type !== 'message.delta') return;
      const payload = event.payload as unknown as MessageDeltaPayload;
      if (payload.execution_id !== executionId) return;
      setPending((current) =>
        current && current.executionId === executionId && current.status !== 'completed'
          ? { ...current, answer: payload.delta, status: payload.done ? 'completed' : 'running' }
          : current,
      );
      if (payload.done) {
        queryClient.invalidateQueries({ queryKey: ['conversations', payload.conversation_id, 'messages'] });
      }
    });
  }, [pending?.executionId, queryClient]);

  // Fases REAIS do agent loop (Agentic V2, evento agent.phase): cada
  // transição que o backend executa de verdade vira um passo no indicador de
  // atividade, substituindo as etapas genéricas por intervalo assim que a
  // primeira fase chega (spec V2 seção 61: nunca inventar etapas).
  useEffect(() => {
    if (!pending?.executionId) return;
    const executionId = pending.executionId;
    return realtimeClient.subscribe((event) => {
      if (event.type !== 'agent.phase') return;
      const payload = event.payload as { execution_id?: string; label?: unknown; phase?: string };
      if (payload.execution_id !== executionId || typeof payload.label !== 'string' || payload.label.length === 0) return;
      const label: string = payload.label;
      setPending((current) => {
        if (!current || current.executionId !== executionId) return current;
        const steps = current.liveSteps ?? [];
        if (steps[steps.length - 1] === label) return current;
        return { ...current, liveSteps: [...steps, label] };
      });
    });
  }, [pending?.executionId]);

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
    attachments: message.attachments.map((attachment) => ({
      url: attachment.url,
      type: attachment.contentType,
      filename: attachment.filename,
    })),
    createdAt: message.createdAt,
  }));

  let messages = persistedUi;
  if (pending && pending.conversationId === activeConversationId) {
    // Comparação por TEMPO, não por conteúdo — mesmo padrão do "caughtUp" do efeito de
    // aposentadoria acima (linha ~241). Corrida real medida em código (09/09/2026): o evento WS
    // de execution.completed invalida `persistedMessages` e ele já chega com a resposta real,
    // mas `pending.status` só muda no próximo tick do poll de 700ms — nessa janela, a checagem
    // antiga (`pending.status === 'completed' && message.content === pending.answer`) dava falso
    // e a bolha otimista era empurrada JUNTO com a mensagem persistida real: duas bolhas com o
    // mesmo conteúdo na tela ao mesmo tempo. Comparar por `createdAt >= pending.sentAt` não
    // depende do estado local do poll: existe no máximo UM exchange pendente por vez (o composer
    // fica desabilitado enquanto `isExchangeActive`), então "mensagem do papel certo criada depois
    // do envio" identifica a mensagem deste exchange sem ambiguidade.
    //
    // Comparar por CONTEÚDO tinha um segundo defeito, mais raro: se o usuário já tinha mandado o
    // mesmo texto antes na conversa ("ok", "oi"), a linha ANTIGA batia no `.some()` e a bolha
    // otimista da mensagem NOVA sumia da tela até o histórico realmente alcançar.
    const userAlreadyPersisted = persistedUi.some(
      (message) => message.role === 'user' && new Date(message.createdAt ?? 0).getTime() >= pending.sentAt,
    );
    const assistantAlreadyPersisted = persistedUi.some(
      (message) => message.role === 'assistant' && new Date(message.createdAt ?? 0).getTime() >= pending.sentAt,
    );
    messages = [...persistedUi];
    if (!userAlreadyPersisted) {
      messages.push({
        id: pending.userLocalId,
        role: 'user',
        content: pending.userText,
        attachments: pending.attachments.map((attachment) => ({
          url: attachment.url,
          type: attachment.contentType,
          filename: attachment.filename,
        })),
        createdAt: new Date(pending.sentAt).toISOString(),
      });
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
        liveSteps: pending.liveSteps,
        createdAt: new Date(pending.sentAt).toISOString(),
      });
    }
  }

  // pending.answer entra nas deps porque o texto cresce via message.delta sem
  // mudar messages.length - sem ele o scroll não acompanhava o streaming.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, pending?.status, pending?.answer]);

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

  async function handleSend(
    text: string,
    options?: { projectId?: string | null | undefined; attachments?: ChatAttachmentWire[] | undefined },
  ) {
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
      attachments: options?.attachments ?? [],
      sentAt,
    };
    setPending(exchange);

    try {
      const result = await sendMessage.mutateAsync({
        message: text,
        clientId,
        agentSelection,
        conversationId: activeConversationId,
        // Só entra numa conversa NOVA (activeConversationId nulo): "abrir um
        // chat dentro do projeto" a partir da tela de Projeto.
        projectId: activeConversationId ? null : options?.projectId,
        attachments: options?.attachments ?? [],
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
      // "queued" - falha honesta no balão.
      setPending((current) => (current ? { ...current, status: 'failed' } : current));
    }
  }

  /** Reenvia a mesma pergunta do exchange que falhou (balão "Tentar
   * novamente"). Reusa os anexos já hospedados, sem reupload. */
  function handleRetry() {
    if (!pending || pending.status !== 'failed') return;
    void handleSend(pending.userText, { attachments: pending.attachments });
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
          {!hasMessages && projectFromQuery !== null && (
            <motion.div
              key="chat-project"
              className="relative flex flex-1 flex-col overflow-y-auto px-4"
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
            >
              <div className="mx-auto w-full max-w-3xl py-10">
                <Link
                  href="/chat"
                  className="inline-flex items-center gap-1.5 rounded-md text-sm text-nevoa transition-colors hover:text-branco-cru"
                >
                  <ArrowLeft size={14} />
                  Voltar pro chat
                </Link>

                <div className="mt-6 flex items-center gap-3">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-grafite-elevado bg-grafite text-sinal">
                    <FolderClosed size={18} />
                  </span>
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-nevoa">Projeto</p>
                    <h1 className="truncate font-display text-3xl font-black uppercase leading-tight tracking-tight text-branco-cru">
                      {activeProject?.name ?? 'Projeto'}
                    </h1>
                  </div>
                </div>

                {activeProject?.clientId && <div className="mt-8"><ProjectOverviewPanel clientId={activeProject.clientId} /></div>}

                <div className="mb-8">
                  <ProjectFilesSection projectId={projectFromQuery} />
                </div>

                <div className="mt-2">
                  <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-nevoa">Nova conversa neste projeto</p>
                  <Composer
                    onSend={(text, attachments) => handleSend(text, { projectId: projectFromQuery, attachments })}
                    disabled={composerDisabled}
                    agentSelection={agentSelection}
                    variant="docked"
                    showDisclaimer={false}
                  />
                </div>

                <p className="mb-2 mt-8 font-mono text-[10px] uppercase tracking-wider text-nevoa">Conversas</p>
                <div className="space-y-1">
                  {projectConversationsPending ? (
                    <>
                      <Skeleton className="h-11" />
                      <Skeleton className="h-11" />
                      <Skeleton className="h-11" />
                    </>
                  ) : sortedProjectConversations.length === 0 ? (
                    <p className="rounded-md border border-dashed border-grafite-elevado px-4 py-6 text-center text-sm text-nevoa">
                      Nenhuma conversa neste projeto ainda.
                    </p>
                  ) : (
                    sortedProjectConversations.map((conversation) => (
                      <Link
                        key={conversation.id}
                        href={`/chat?conversation=${conversation.id}`}
                        className="flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-grafite"
                      >
                        {conversation.lastAgent ? (
                          <span
                            className={cn('size-1.5 shrink-0 rounded-full', AGENT_META[conversation.lastAgent].bgClass)}
                          />
                        ) : (
                          <MessageCircle size={14} className="shrink-0 text-nevoa" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-sm text-branco-cru">
                          {conversation.title ?? conversation.lastMessagePreview ?? 'Nova conversa'}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-nevoa">
                          {formatRelativeTime(conversation.updatedAt)}
                        </span>
                      </Link>
                    ))
                  )}
                </div>
              </div>
            </motion.div>
          )}
          {!hasMessages && projectFromQuery === null && (
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
                  Descreva o que você precisa - o AUTO roteia para o agente certo, ou escolha um especialista acima.
                </p>
              </div>

              <motion.div layoutId="chat-composer" transition={TRAVEL_SPRING} className="w-full max-w-3xl">
                <Composer
                  onSend={(text, attachments) => handleSend(text, { attachments })}
                  disabled={composerDisabled}
                  agentSelection={agentSelection}
                  variant="hero"
                  showDisclaimer={false}
                  textareaRef={composerTextareaRef}
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
                        onRetry={
                          pending && message.id === pending.assistantLocalId && message.status === 'failed'
                            ? handleRetry
                            : undefined
                        }
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
              <Composer
                onSend={(text, attachments) => handleSend(text, { attachments })}
                disabled={composerDisabled}
                agentSelection={agentSelection}
                textareaRef={composerTextareaRef}
              />
            </motion.div>
          </div>
        )}
        </div>
      </div>
    </LayoutGroup>
  );
}

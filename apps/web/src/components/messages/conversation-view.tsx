'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowUp,
  Check,
  CheckCheck,
  Copy,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Search,
  Star,
  X,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { CollaboratorAvatar } from './collaborator-avatar';
import { MessageAttachment } from './message-attachment';
import { useMessageThread, useSendMessage } from '@/hooks/use-messages';
import { useUpdateThreadPrefs } from '@/hooks/use-update-thread-prefs';
import { useMe } from '@/hooks/use-me';
import { ApiRequestError } from '@/lib/api/client';
import type { Message, MessageThread } from '@/lib/api/contracts';
import { isOnlineNow } from '@/lib/presence';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Parceiro de conversa já resolvido (thread ou diretório de colaboradores). */
export interface ConversationPartner {
  id: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  lastSeenAt: string | null;
  clickup: { username: string; color: string | null; initials: string | null } | null;
}

/** Menu de overflow (mesmo padrão do conversation-sidebar: fecha clicando fora). */
function useOverflowMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);
  return { open, setOpen, ref };
}

function dateSeparatorLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  if (startOfDate === startOfToday) return 'Hoje';
  if (startOfDate === startOfToday - 86_400_000) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function ConversationHeader({
  partner,
  thread,
  searching,
  onToggleSearch,
  onBack,
}: {
  partner: ConversationPartner;
  thread: MessageThread | undefined;
  searching: boolean;
  onToggleSearch: () => void;
  onBack: () => void;
}) {
  const updatePrefs = useUpdateThreadPrefs();
  const menu = useOverflowMenu();
  const [copied, setCopied] = useState(false);
  const online = isOnlineNow(partner.lastSeenAt);

  const title = [
    partner.name,
    partner.email,
    partner.clickup ? `ClickUp: ${partner.clickup.username}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  function handleCopyEmail() {
    if (!partner.email) return;
    navigator.clipboard.writeText(partner.email);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
    menu.setOpen(false);
  }

  return (
    <div className="relative z-10 mb-3 flex items-center gap-3 border-b border-white/5 pb-3">
      <button
        type="button"
        onClick={onBack}
        aria-label="Voltar para a lista"
        className="flex size-9 shrink-0 items-center justify-center rounded-md text-nevoa transition-colors hover:bg-grafite hover:text-branco-cru lg:hidden"
      >
        <ArrowLeft size={17} />
      </button>

      <CollaboratorAvatar
        name={partner.name}
        avatarUrl={partner.avatarUrl}
        clickupColor={partner.clickup?.color}
        clickupInitials={partner.clickup?.initials}
        online={online}
        size="lg"
      />

      <div className="min-w-0 flex-1" title={title}>
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-branco-cru">{partner.name}</p>
          <span className="shrink-0 rounded border border-grafite-elevado bg-grafite px-1 font-mono text-[9px] uppercase tracking-wider text-nevoa">
            {partner.clickup ? 'Colaborador · ClickUp' : 'Colaborador'}
          </span>
        </div>
        {online ? (
          <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-sucesso">
            <span className="size-1.5 rounded-full bg-sucesso" />
            Online
          </p>
        ) : partner.lastSeenAt ? (
          <p className="mt-0.5 font-mono text-[10px] text-nevoa">
            Visto por último {formatRelativeTime(partner.lastSeenAt).toLowerCase()}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onToggleSearch}
          aria-label="Buscar nesta conversa"
          title="Buscar nesta conversa"
          className={cn(
            'flex size-9 items-center justify-center rounded-md transition-colors',
            searching ? 'bg-grafite text-branco-cru' : 'text-nevoa hover:bg-grafite hover:text-branco-cru',
          )}
        >
          <Search size={16} />
        </button>
        <button
          type="button"
          onClick={() => updatePrefs.mutate({ partnerId: partner.id, favorite: !(thread?.favorited ?? false) })}
          aria-label={thread?.favorited ? 'Remover dos favoritos' : 'Favoritar conversa'}
          title={thread?.favorited ? 'Remover dos favoritos' : 'Favoritar conversa'}
          className={cn(
            'flex size-9 items-center justify-center rounded-md transition-colors',
            thread?.favorited ? 'text-sinal hover:bg-grafite' : 'text-nevoa hover:bg-grafite hover:text-branco-cru',
          )}
        >
          <Star size={16} fill={thread?.favorited ? 'currentColor' : 'none'} />
        </button>
        <button
          type="button"
          onClick={() => {
            updatePrefs.mutate({ partnerId: partner.id, archived: !(thread?.archived ?? false) });
            if (!thread?.archived) onBack();
          }}
          aria-label={thread?.archived ? 'Desarquivar conversa' : 'Arquivar conversa'}
          title={thread?.archived ? 'Desarquivar conversa' : 'Arquivar conversa'}
          className="flex size-9 items-center justify-center rounded-md text-nevoa transition-colors hover:bg-grafite hover:text-branco-cru"
        >
          {thread?.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
        </button>
        {partner.email && (
          <div ref={menu.ref} className="relative">
            <button
              type="button"
              onClick={() => menu.setOpen(!menu.open)}
              aria-label="Mais opções"
              className="flex size-9 items-center justify-center rounded-md text-nevoa transition-colors hover:bg-grafite hover:text-branco-cru"
            >
              <MoreHorizontal size={16} />
            </button>
            {menu.open && (
              <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-md border border-grafite-elevado bg-grafite-elevado p-1 shadow-elevated">
                <button
                  type="button"
                  onClick={handleCopyEmail}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-branco-cru transition-colors hover:bg-carbono"
                >
                  {copied ? <Check size={12} className="text-sucesso" /> : <Copy size={12} />}
                  {copied ? 'E-mail copiado' : 'Copiar e-mail'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  isMine,
  showReadState,
  partner,
}: {
  message: Message;
  isMine: boolean;
  /** Só a MINHA última mensagem mostra o estado de leitura (flag real `read`). */
  showReadState: boolean;
  partner: ConversationPartner;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className={cn('flex items-end gap-2', isMine ? 'justify-end' : 'justify-start')}
    >
      {!isMine && (
        <CollaboratorAvatar
          name={partner.name}
          avatarUrl={partner.avatarUrl}
          clickupColor={partner.clickup?.color}
          clickupInitials={partner.clickup?.initials}
          size="sm"
        />
      )}
      <div
        className={cn(
          'max-w-[70%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
          isMine
            ? 'rounded-br-md bg-roxo-eletrico text-branco-cru'
            : 'rounded-bl-md border border-white/5 bg-grafite/80 text-branco-cru backdrop-blur-sm',
        )}
      >
        {message.content && <p className="whitespace-pre-wrap break-words">{message.content}</p>}
        <MessageAttachment message={message} />
        <p className={cn('mt-1 flex items-center gap-1 font-mono text-[10px]', isMine ? 'justify-end text-branco-cru/60' : 'text-nevoa')}>
          {formatTime(message.createdAt)}
          {isMine && showReadState && (
            <span className="ml-1 inline-flex items-center gap-1">
              {message.read ? (
                <>
                  <CheckCheck size={11} />
                  Lida
                </>
              ) : (
                <>
                  <Check size={11} />
                  Enviada
                </>
              )}
            </span>
          )}
        </p>
      </div>
    </motion.div>
  );
}

/**
 * Thread aberta: header com presença real (last_seen_at), mensagens com
 * separadores de data e o composer de envio real (texto + 1 anexo multipart,
 * Enter envia / Shift+Enter quebra linha, erro inline com retry).
 */
export function ConversationView({
  partner,
  thread,
  onBack,
}: {
  partner: ConversationPartner;
  thread: MessageThread | undefined;
  onBack: () => void;
}) {
  const { data: me } = useMe();
  const { data: messages, isPending, isError, refetch } = useMessageThread(partner.id);
  const sendMessage = useSendMessage();

  const [content, setContent] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [threadQuery, setThreadQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Busca na thread é filtro client-side das mensagens já carregadas.
  const visibleMessages = useMemo(() => {
    const list = messages ?? [];
    const query = threadQuery.trim().toLowerCase();
    if (!query) return list;
    return list.filter((message) => (message.content ?? '').toLowerCase().includes(query));
  }, [messages, threadQuery]);

  const lastMineId = useMemo(() => {
    const list = messages ?? [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (list[i]!.senderId === me?.id) return list[i]!.id;
    }
    return null;
  }, [messages, me?.id]);

  useEffect(() => {
    if (threadQuery.trim()) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [visibleMessages.length, threadQuery]);

  function handleSend() {
    if (sendMessage.isPending || (!content.trim() && !file)) return;
    sendMessage.mutate(
      { recipientId: partner.id, content: content.trim(), file },
      { onSuccess: () => { setContent(''); setFile(null); } },
    );
  }

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <ConversationHeader
        partner={partner}
        thread={thread}
        searching={searchOpen}
        onToggleSearch={() => {
          setSearchOpen((current) => !current);
          if (searchOpen) setThreadQuery('');
        }}
        onBack={onBack}
      />

      {searchOpen && (
        <div className="relative mb-3">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-nevoa" />
          <input
            autoFocus
            type="text"
            value={threadQuery}
            onChange={(event) => setThreadQuery(event.target.value)}
            placeholder="Buscar nesta conversa..."
            aria-label="Buscar nesta conversa"
            className="w-full rounded-md border border-grafite-elevado bg-grafite py-2 pl-9 pr-8 text-sm text-branco-cru placeholder:text-nevoa focus:border-roxo-eletrico/60 focus:outline-none"
          />
          {threadQuery && (
            <button
              type="button"
              onClick={() => setThreadQuery('')}
              aria-label="Limpar busca"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-nevoa transition-colors hover:text-branco-cru"
            >
              <X size={13} />
            </button>
          )}
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pb-2 pr-1">
        {isPending ? (
          <div className="space-y-3 pt-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className={cn('h-12', i % 2 === 0 ? 'w-2/3' : 'ml-auto w-1/2')} />
            ))}
          </div>
        ) : isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-branco-cru">Não foi possível carregar esta conversa.</p>
            <button
              type="button"
              onClick={() => refetch()}
              className="rounded-md border border-grafite-elevado bg-grafite px-3 py-1.5 text-xs font-medium text-branco-cru transition-colors hover:border-roxo-eletrico/50"
            >
              Tentar novamente
            </button>
          </div>
        ) : visibleMessages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <MessageCircle size={20} className="text-nevoa" />
            <p className="text-sm text-nevoa">
              {threadQuery.trim() ? `Nenhuma mensagem com "${threadQuery.trim()}".` : 'Nenhuma mensagem ainda. Diga oi!'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence initial={false}>
              {visibleMessages.map((message, index) => {
                const isMine = message.senderId === me?.id;
                const previous = index > 0 ? visibleMessages[index - 1]! : null;
                const showSeparator =
                  !previous ||
                  dateSeparatorLabel(previous.createdAt) !== dateSeparatorLabel(message.createdAt);
                return (
                  <div key={message.id}>
                    {showSeparator && (
                      <div className="my-4 flex items-center gap-3">
                        <span className="h-px flex-1 bg-grafite-elevado" />
                        <span className="font-mono text-[10px] uppercase tracking-wider text-nevoa">
                          {dateSeparatorLabel(message.createdAt)}
                        </span>
                        <span className="h-px flex-1 bg-grafite-elevado" />
                      </div>
                    )}
                    <MessageBubble
                      message={message}
                      isMine={isMine}
                      showReadState={message.id === lastMineId && !threadQuery.trim()}
                      partner={partner}
                    />
                  </div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      <div className="mt-3 shrink-0 border-t border-white/5 pt-3">
        {sendMessage.isError && (
          <div className="mb-2 flex items-center gap-2 text-xs text-erro">
            <span>
              {sendMessage.error instanceof ApiRequestError ? sendMessage.error.message : 'Não foi possível enviar a mensagem.'}
            </span>
            <button
              type="button"
              onClick={handleSend}
              className="shrink-0 rounded border border-erro/40 px-2 py-0.5 font-medium transition-colors hover:bg-erro/10"
            >
              Tentar novamente
            </button>
          </div>
        )}
        {file && (
          <div className="mb-2 flex items-center gap-2 rounded-md border border-grafite-elevado bg-grafite px-3 py-1.5 text-xs text-nevoa">
            <Paperclip size={12} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{file.name}</span>
            <button type="button" onClick={() => setFile(null)} aria-label="Remover anexo" className="transition-colors hover:text-branco-cru">
              <X size={14} />
            </button>
          </div>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleSend();
          }}
          className="flex items-end gap-2 rounded-xl border border-grafite-elevado bg-grafite p-2 transition-[border-color,box-shadow] duration-300 focus-within:border-roxo-eletrico/60 focus-within:shadow-glow"
        >
          <input
            ref={fileInputRef}
            type="file"
            hidden
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Anexar arquivo"
            className="flex size-9 shrink-0 items-center justify-center rounded-md text-nevoa transition-colors hover:bg-grafite-elevado hover:text-branco-cru"
          >
            <Paperclip size={16} />
          </button>
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                handleSend();
              }
            }}
            rows={1}
            placeholder={`Mensagem para ${partner.name.split(/\s+/)[0]}...`}
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-sm text-branco-cru placeholder:text-nevoa focus:outline-none"
          />
          <button
            type="submit"
            disabled={sendMessage.isPending || (!content.trim() && !file)}
            aria-label="Enviar"
            className="flex size-9 shrink-0 items-center justify-center rounded-md bg-roxo-eletrico text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:opacity-40 disabled:hover:shadow-none"
          >
            <ArrowUp size={17} />
          </button>
        </form>
      </div>
    </div>
  );
}

'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { File, MessageCircle, Paperclip, Plus, Send, X } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { AgentAvatar } from '@/components/ui/agent-avatar';
import { useMe } from '@/hooks/use-me';
import { useMessageThread, useMessageThreads, useSendMessage } from '@/hooks/use-messages';
import { useTeamMembers } from '@/hooks/use-team-members';
import { ApiRequestError } from '@/lib/api/client';
import type { Message } from '@/lib/api/contracts';
import { AGENT_META, FEATURED_AGENTS } from '@/lib/agent-meta';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

function Avatar({ name, avatarUrl, size = 36 }: { name: string; avatarUrl: string | null; size?: number }) {
  return (
    <div
      className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-roxo-eletrico font-mono text-sm font-semibold text-branco-cru"
      style={{ width: size, height: size }}
    >
      {avatarUrl ? (
        <Image src={avatarUrl} alt={name} fill sizes={`${size}px`} unoptimized className="object-cover" />
      ) : (
        name.charAt(0).toUpperCase()
      )}
    </div>
  );
}

function Attachment({ message }: { message: Message }) {
  if (!message.attachmentUrl) return null;
  const type = message.attachmentType ?? '';

  if (type.startsWith('image/')) {
    return (
      <a href={message.attachmentUrl} target="_blank" rel="noreferrer" className="mt-2 block">
        <Image
          src={message.attachmentUrl}
          alt={message.attachmentFilename ?? 'imagem'}
          width={240}
          height={180}
          unoptimized
          className="h-auto max-w-[240px] rounded-md border border-grafite-elevado object-cover"
        />
      </a>
    );
  }

  if (type.startsWith('audio/')) {
    return <audio controls src={message.attachmentUrl} className="mt-2 h-9 max-w-[240px]" />;
  }

  if (type.startsWith('video/')) {
    return (
      <video controls src={message.attachmentUrl} className="mt-2 max-w-[240px] rounded-md border border-grafite-elevado" />
    );
  }

  return (
    <a
      href={message.attachmentUrl}
      target="_blank"
      rel="noreferrer"
      className="mt-2 flex max-w-[240px] items-center gap-2 rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-xs text-nevoa hover:border-roxo-eletrico/50 hover:text-branco-cru"
    >
      <File size={14} className="shrink-0" />
      <span className="truncate">{message.attachmentFilename ?? 'arquivo'}</span>
    </a>
  );
}

export default function MessagesPage() {
  return (
    <Suspense fallback={null}>
      <MessagesPageContent />
    </Suspense>
  );
}

function MessagesPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: me } = useMe();
  const { data: threads, isPending: threadsPending } = useMessageThreads();
  const { data: members } = useTeamMembers();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(searchParams.get('to'));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [content, setContent] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: messages, isPending: messagesPending } = useMessageThread(selectedUserId);
  const sendMessage = useSendMessage();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const selectedPerson = useMemo(() => {
    const fromThread = threads?.find((t) => t.user.id === selectedUserId)?.user;
    if (fromThread) return fromThread;
    return members?.find((m) => m.id === selectedUserId) ?? null;
  }, [threads, members, selectedUserId]);

  function handleSend() {
    if (!selectedUserId || sendMessage.isPending || (!content.trim() && !file)) return;
    sendMessage.mutate(
      { recipientId: selectedUserId, content: content.trim(), file },
      { onSuccess: () => { setContent(''); setFile(null); } },
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <PageHeader eyebrow="Comunicação" title="Mensagens" description="Converse com outros usuários e envie anexos." />

      <div className="flex min-h-0 flex-1 gap-4">
        <aside className="flex w-72 shrink-0 flex-col border-r border-grafite-elevado pr-4">
          <div className="mb-3">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-nevoa">
              Chat privado com a IA
            </p>
            <div className="flex gap-2">
              {FEATURED_AGENTS.map((agent) => {
                const meta = AGENT_META[agent];
                return (
                  <button
                    key={agent}
                    type="button"
                    onClick={() => router.push(`/chat?agent=${agent}`)}
                    title={`Conversar com ${meta.label}`}
                    className="flex flex-1 flex-col items-center gap-1 rounded-md border border-grafite-elevado bg-grafite py-2 transition-colors hover:border-roxo-eletrico/50 hover:bg-grafite-elevado"
                  >
                    <AgentAvatar agent={agent} size="sm" />
                    <span className="truncate text-[11px] text-nevoa">{meta.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className="mb-3 flex items-center justify-center gap-2 rounded-md border border-grafite-elevado bg-grafite py-2 text-sm font-medium text-branco-cru transition-colors hover:border-roxo-eletrico/50"
          >
            <Plus size={15} />
            Nova mensagem
          </button>

          {pickerOpen && (
            <div className="mb-3 max-h-48 space-y-1 overflow-y-auto rounded-md border border-grafite-elevado bg-carbono p-2">
              {members
                ?.filter((m) => m.id !== me?.id)
                .map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => { setSelectedUserId(member.id); setPickerOpen(false); }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-nevoa hover:bg-grafite hover:text-branco-cru"
                  >
                    <Avatar name={member.name} avatarUrl={member.avatarUrl} size={24} />
                    <span className="truncate">{member.name}</span>
                  </button>
                ))}
            </div>
          )}

          <div className="flex-1 space-y-1 overflow-y-auto">
            {threadsPending ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)
            ) : !threads || threads.length === 0 ? (
              <EmptyState icon={MessageCircle} title="Nenhuma conversa" description="Comece uma nova mensagem." />
            ) : (
              threads.map((thread) => (
                <button
                  key={thread.user.id}
                  type="button"
                  onClick={() => setSelectedUserId(thread.user.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2.5 text-left transition-colors',
                    selectedUserId === thread.user.id ? 'bg-grafite-elevado' : 'hover:bg-grafite',
                  )}
                >
                  <Avatar name={thread.user.name} avatarUrl={thread.user.avatarUrl} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm text-branco-cru">{thread.user.name}</p>
                      {thread.unreadCount > 0 && (
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-sinal font-mono text-[10px] font-semibold text-carbono">
                          {thread.unreadCount}
                        </span>
                      )}
                    </div>
                    <p className="truncate font-mono text-[10px] text-nevoa">
                      {thread.lastMessage.content ?? thread.lastMessage.attachmentFilename ?? 'Anexo'}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {!selectedUserId || !selectedPerson ? (
            <EmptyState icon={MessageCircle} title="Selecione uma conversa" description="Escolha alguém para conversar." />
          ) : (
            <>
              <div className="mb-3 flex items-center gap-2.5 border-b border-grafite-elevado pb-3">
                <Avatar name={selectedPerson.name} avatarUrl={selectedPerson.avatarUrl} size={28} />
                <p className="text-sm font-medium text-branco-cru">{selectedPerson.name}</p>
              </div>

              <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto pr-1">
                {messagesPending ? (
                  Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-2/3" />)
                ) : (
                  messages?.map((message) => {
                    const isMine = message.senderId === me?.id;
                    return (
                      <div key={message.id} className={cn('flex', isMine ? 'justify-end' : 'justify-start')}>
                        <div
                          className={cn(
                            'max-w-[70%] rounded-lg px-3 py-2 text-sm',
                            isMine ? 'bg-roxo-eletrico text-branco-cru' : 'bg-grafite text-branco-cru',
                          )}
                        >
                          {message.content && <p className="whitespace-pre-wrap">{message.content}</p>}
                          <Attachment message={message} />
                          <p className="mt-1 font-mono text-[10px] opacity-60">{formatRelativeTime(message.createdAt)}</p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="mt-3 border-t border-grafite-elevado pt-3">
                {sendMessage.isError && (
                  <p className="mb-2 text-xs text-erro">
                    {sendMessage.error instanceof ApiRequestError ? sendMessage.error.message : 'Não foi possível enviar a mensagem.'}
                  </p>
                )}
                {file && (
                  <div className="mb-2 flex items-center gap-2 rounded-md border border-grafite-elevado bg-grafite px-3 py-1.5 text-xs text-nevoa">
                    <Paperclip size={12} />
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    <button type="button" onClick={() => setFile(null)} aria-label="Remover anexo">
                      <X size={14} />
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-2">
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
                    className="flex size-9 shrink-0 items-center justify-center rounded-md text-nevoa transition-colors hover:bg-grafite hover:text-branco-cru"
                  >
                    <Paperclip size={16} />
                  </button>
                  <input
                    type="text"
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') handleSend(); }}
                    placeholder="Escreva uma mensagem..."
                    className="flex-1 rounded-md border border-grafite-elevado bg-grafite px-3 py-2 text-sm text-branco-cru placeholder:text-nevoa focus:border-roxo-eletrico/60 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={sendMessage.isPending || (!content.trim() && !file)}
                    aria-label="Enviar"
                    className="flex size-9 shrink-0 items-center justify-center rounded-md bg-roxo-eletrico text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:opacity-50 disabled:hover:shadow-none"
                  >
                    <Send size={16} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

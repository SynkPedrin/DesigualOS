'use client';

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, Bell, BellOff, CornerUpLeft, FolderOpen, Hash, Loader2, Pencil, RotateCcw, SmilePlus, Trash2 } from 'lucide-react';
import {
  flattenMessages,
  setOpenConversation,
  useChatMessages,
  useDeleteChatMessage,
  useEditChatMessage,
  useMarkChatRead,
  useMuteChat,
  useReactChatMessage,
  useSendChatMessage,
  useTypingUsers,
  type ChatConversation,
  type ChatMember,
  type ChatMessage,
} from '@/hooks/use-internal-chat';
import { InboxAvatar } from '@/components/inbox/inbox-avatar';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from '@/stores/toast-store';
import { AnexosDaMensagem } from './anexos';
import { Composer, type ComposerHandle } from './composer';
import { cn } from '@/lib/utils';

const REACOES_RAPIDAS = ['👍', '❤️', '😂', '🎉', '👀', '✅'];
const JANELA_DE_AGRUPAMENTO_MS = 5 * 60_000;

function rotuloDoDia(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(); ontem.setDate(hoje.getDate() - 1);
  if (d.toDateString() === hoje.toDateString()) return 'Hoje';
  if (d.toDateString() === ontem.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: d.getFullYear() === hoje.getFullYear() ? undefined : 'numeric' });
}

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** Texto com links clicáveis e @menções destacadas. */
function TextoDaMensagem({ texto, nomesMencionados, meuNome }: { texto: string; nomesMencionados: string[]; meuNome: string | null }) {
  const partes = useMemo(() => {
    const nomes = nomesMencionados.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const padrao = new RegExp(`(https?://[^\\s]+${nomes.length ? `|@(?:${nomes.join('|')})` : ''})`, 'g');
    return texto.split(padrao);
  }, [texto, nomesMencionados]);
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-branco-cru">
      {partes.map((p, i) => {
        if (/^https?:\/\//.test(p)) return <a key={i} href={p} target="_blank" rel="noreferrer noopener" className="text-roxo-eletrico underline underline-offset-2">{p}</a>;
        if (p.startsWith('@') && nomesMencionados.includes(p.slice(1))) {
          return <span key={i} className={cn('rounded px-0.5 font-medium', p.slice(1) === meuNome ? 'bg-sinal/20 text-sinal' : 'bg-roxo-eletrico/20 text-roxo-eletrico')}>{p}</span>;
        }
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </p>
  );
}

function Mensagem({ m, agrupada, souEu, me, membros, destacada, onReply, onRetry, onEdit, onDelete, onReact, onJump }: {
  m: ChatMessage;
  agrupada: boolean;
  souEu: boolean;
  me: { id: string; name: string | null };
  membros: Map<string, ChatMember>;
  destacada: boolean;
  onReply: () => void;
  onRetry: () => void;
  onEdit: (content: string) => void;
  onDelete: () => void;
  onReact: (emoji: string) => void;
  onJump: (id: string) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(m.content ?? '');
  const [reagindo, setReagindo] = useState(false);
  const local = m.id.startsWith('local-');
  const nomesMencionados = m.mentions.map((id) => membros.get(id)?.name).filter((n): n is string => Boolean(n));

  return (
    <div
      id={`msg-${m.id}`}
      className={cn('group relative flex gap-3 rounded-md px-4 transition-colors hover:bg-grafite-elevado/30', agrupada ? 'py-0.5' : 'mt-2 pt-1.5 pb-0.5', destacada && 'bg-roxo-eletrico/15')}
    >
      <div className="w-9 shrink-0">
        {!agrupada && <InboxAvatar name={m.sender_name ?? 'Colaborador'} photoUrl={m.sender_avatar_url} size="md" />}
        {agrupada && <span className="hidden pt-1 font-mono text-[10px] text-nevoa/60 group-hover:block">{hora(m.created_at)}</span>}
      </div>
      <div className="min-w-0 flex-1">
        {!agrupada && (
          <p className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-branco-cru">{souEu ? 'Você' : m.sender_name ?? 'Colaborador'}</span>
            <span className="font-mono text-[11px] text-nevoa">{hora(m.created_at)}</span>
          </p>
        )}
        {m.reply_to && (
          <button type="button" onClick={() => onJump(m.reply_to!.id)} className="mb-1 mt-0.5 block max-w-full truncate rounded border-l-2 border-nevoa/40 bg-grafite-elevado/40 px-2 py-0.5 text-left text-xs text-nevoa hover:text-branco-cru">
            <span className="font-semibold">{m.reply_to.sender_name ?? 'Colaborador'}:</span> {m.reply_to.deleted ? 'mensagem apagada' : m.reply_to.content || 'arquivo'}
          </button>
        )}
        {m.deleted ? (
          <p className="text-sm italic text-nevoa">Mensagem apagada</p>
        ) : editando ? (
          <div className="mt-1">
            <textarea
              autoFocus
              value={rascunho}
              onChange={(e) => setRascunho(e.target.value)}
              aria-label="Editar mensagem"
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setEditando(false); setRascunho(m.content ?? ''); }
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (rascunho.trim() || m.attachments.length) { onEdit(rascunho.trim()); setEditando(false); } }
              }}
              className="w-full resize-none rounded-md border border-roxo-eletrico/60 bg-carbono/40 px-2 py-1.5 text-sm text-branco-cru focus:outline-none"
              rows={Math.min(6, Math.max(1, rascunho.split('\n').length))}
            />
            <p className="font-mono text-[10px] text-nevoa">Enter salva · Esc cancela</p>
          </div>
        ) : (
          <>
            {m.content && <TextoDaMensagem texto={m.content} nomesMencionados={nomesMencionados} meuNome={me.name} />}
            <AnexosDaMensagem anexos={m.attachments} />
            {m.edited_at && <span className="font-mono text-[10px] text-nevoa/70">(editada)</span>}
          </>
        )}
        {m.local_status === 'sending' && <p className="font-mono text-[10px] text-nevoa">Enviando…</p>}
        {m.local_status === 'failed' && (
          <p className="flex items-center gap-2 font-mono text-[11px] text-erro">
            Não enviada.
            <button type="button" onClick={onRetry} className="flex items-center gap-1 underline"><RotateCcw size={11} /> Tentar de novo</button>
          </p>
        )}
        {m.reactions.length > 0 && !m.deleted && (
          <div className="mt-1 flex flex-wrap gap-1">
            {m.reactions.map((r) => {
              const minha = r.user_ids.includes(me.id);
              const quem = r.user_ids.map((id) => (id === me.id ? 'você' : membros.get(id)?.name ?? 'alguém')).join(', ');
              return (
                <button key={r.emoji} type="button" onClick={() => onReact(r.emoji)} title={quem} aria-pressed={minha} className={cn('flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs', minha ? 'border-roxo-eletrico/60 bg-roxo-eletrico/15 text-branco-cru' : 'border-grafite-elevado text-nevoa hover:border-nevoa/40')}>
                  <span>{r.emoji}</span><span className="font-mono">{r.user_ids.length}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {!m.deleted && !local && !editando && (
        <div className="absolute -top-3 right-4 hidden items-center gap-0.5 rounded-md border border-grafite-elevado bg-grafite p-0.5 shadow-lg group-hover:flex group-focus-within:flex">
          <div className="relative">
            <button type="button" onClick={() => setReagindo((v) => !v)} aria-label="Reagir" title="Reagir" className="flex size-7 items-center justify-center rounded text-nevoa hover:bg-grafite-elevado hover:text-branco-cru"><SmilePlus size={14} /></button>
            {reagindo && (
              <div className="absolute right-0 top-full z-20 mt-1 flex gap-0.5 rounded-md border border-grafite-elevado bg-grafite p-1 shadow-xl">
                {REACOES_RAPIDAS.map((e) => <button key={e} type="button" onClick={() => { onReact(e); setReagindo(false); }} className="rounded p-1 text-base hover:bg-grafite-elevado">{e}</button>)}
              </div>
            )}
          </div>
          <button type="button" onClick={onReply} aria-label="Responder" title="Responder" className="flex size-7 items-center justify-center rounded text-nevoa hover:bg-grafite-elevado hover:text-branco-cru"><CornerUpLeft size={14} /></button>
          {souEu && (
            <>
              <button type="button" onClick={() => { setRascunho(m.content ?? ''); setEditando(true); }} aria-label="Editar" title="Editar" className="flex size-7 items-center justify-center rounded text-nevoa hover:bg-grafite-elevado hover:text-branco-cru"><Pencil size={13} /></button>
              <button type="button" onClick={onDelete} aria-label="Apagar" title="Apagar" className="flex size-7 items-center justify-center rounded text-nevoa hover:bg-grafite-elevado hover:text-erro"><Trash2 size={13} /></button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function PainelDaConversa({ conversa, me, membros, focoMensagemId, onBack, onOpenFiles }: {
  conversa: ChatConversation;
  me: { id: string; name: string | null };
  membros: ChatMember[];
  focoMensagemId: string | null;
  onBack: () => void;
  onOpenFiles: () => void;
}) {
  const consulta = useChatMessages(conversa.id);
  const mensagens = useMemo(() => flattenMessages(consulta.data), [consulta.data]);
  const enviar = useSendChatMessage(conversa.id, me);
  const editar = useEditChatMessage(conversa.id);
  const apagar = useDeleteChatMessage(conversa.id);
  const reagir = useReactChatMessage(conversa.id);
  const marcarLida = useMarkChatRead();
  const silenciar = useMuteChat();
  const digitando = useTypingUsers(conversa.id);
  const [respondendo, setRespondendo] = useState<ChatMessage | null>(null);
  const [paraApagar, setParaApagar] = useState<ChatMessage | null>(null);
  const [destaque, setDestaque] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [longeDoFim, setLongeDoFim] = useState(false);
  const rolagem = useRef<HTMLDivElement>(null);
  const composer = useRef<ComposerHandle>(null);
  const alturaAntes = useRef<number | null>(null);
  const colarNoFim = useRef(true);
  const mapaDeMembros = useMemo(() => new Map(membros.map((m) => [m.id, m])), [membros]);

  useEffect(() => {
    setOpenConversation(conversa.id);
    setRespondendo(null);
    colarNoFim.current = true;
    return () => setOpenConversation(null);
  }, [conversa.id]);

  // Lida enquanto está na tela: ao abrir, a cada mensagem nova e ao voltar para a aba.
  const ultimaId = mensagens.at(-1)?.id;
  const naoLidas = conversa.unread_count;
  useEffect(() => {
    if (!ultimaId || ultimaId.startsWith('local-')) return;
    if (document.visibilityState !== 'visible') return;
    marcarLida.mutate(conversa.id);
  }, [conversa.id, ultimaId]);
  useEffect(() => {
    function aoVoltar() { if (document.visibilityState === 'visible' && naoLidas > 0) marcarLida.mutate(conversa.id); }
    document.addEventListener('visibilitychange', aoVoltar);
    return () => document.removeEventListener('visibilitychange', aoVoltar);
  }, [conversa.id, naoLidas]);

  // Rolagem: cola no fim quando a pessoa já está lá; mantém a posição ao carregar as antigas.
  useLayoutEffect(() => {
    const el = rolagem.current;
    if (!el) return;
    if (alturaAntes.current !== null) {
      el.scrollTop += el.scrollHeight - alturaAntes.current;
      alturaAntes.current = null;
      return;
    }
    if (colarNoFim.current) el.scrollTop = el.scrollHeight;
  }, [mensagens]);

  const carregarAntigas = useCallback(async () => {
    if (!consulta.hasNextPage || consulta.isFetchingNextPage) return;
    alturaAntes.current = rolagem.current?.scrollHeight ?? null;
    await consulta.fetchNextPage();
  }, [consulta]);

  function aoRolar() {
    const el = rolagem.current;
    if (!el) return;
    const distancia = el.scrollHeight - el.scrollTop - el.clientHeight;
    colarNoFim.current = distancia < 80;
    setLongeDoFim(distancia > 400);
    if (el.scrollTop < 120) void carregarAntigas();
  }

  const irPara = useCallback(async (id: string) => {
    // Mensagem antiga: carrega páginas até achar (com limite, para não baixar a conversa inteira).
    for (let i = 0; i < 15 && !document.getElementById(`msg-${id}`); i++) {
      if (!consulta.hasNextPage) break;
      alturaAntes.current = rolagem.current?.scrollHeight ?? null;
      await consulta.fetchNextPage();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    const alvo = document.getElementById(`msg-${id}`);
    if (!alvo) { toast('Essa mensagem não está mais disponível.', 'info'); return; }
    colarNoFim.current = false;
    alvo.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setDestaque(id);
    setTimeout(() => setDestaque((d) => (d === id ? null : d)), 2500);
  }, [consulta]);

  useEffect(() => {
    if (focoMensagemId && consulta.isSuccess) void irPara(focoMensagemId);
  }, [focoMensagemId, consulta.isSuccess, conversa.id]);

  function aoEnviar(input: Parameters<typeof enviar.mutate>[0]) {
    colarNoFim.current = true;
    enviar.mutate(input);
    setRespondendo(null);
  }

  const titulo = conversa.kind === 'general' ? 'Geral' : conversa.title;

  return (
    <section
      aria-label={`Conversa ${titulo}`}
      className="relative flex h-full min-h-0 flex-col"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setArrastando(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setArrastando(false); }}
      onDrop={(e) => { e.preventDefault(); setArrastando(false); if (e.dataTransfer.files.length) composer.current?.addFiles(e.dataTransfer.files); }}
    >
      <header className="flex items-center gap-3 border-b border-grafite-elevado px-4 py-2.5">
        <button type="button" onClick={onBack} aria-label="Voltar para conversas" className="text-nevoa hover:text-branco-cru lg:hidden"><ArrowLeft size={18} /></button>
        {conversa.kind === 'general' ? (
          <span className="flex size-9 items-center justify-center rounded-md bg-roxo-eletrico/20 text-roxo-eletrico"><Hash size={18} /></span>
        ) : (
          <span className="relative">
            <InboxAvatar name={conversa.title} photoUrl={conversa.partner?.avatar_url} />
            {conversa.partner?.online && <span className="absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-grafite bg-sinal" />}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-heading text-sm font-semibold text-branco-cru">{conversa.kind === 'general' ? '# Geral' : conversa.title}</h2>
          <p className="truncate font-mono text-[11px] text-nevoa">
            {conversa.kind === 'general' ? `Toda a equipe · ${membros.length} pessoas` : conversa.partner?.online ? 'Online' : 'Conversa privada'}
          </p>
        </div>
        <button type="button" onClick={() => silenciar.mutate({ conversationId: conversa.id, muted: !conversa.muted })} aria-label={conversa.muted ? 'Reativar notificações' : 'Silenciar conversa'} title={conversa.muted ? 'Reativar notificações' : 'Silenciar conversa'} className="flex size-8 items-center justify-center rounded-md text-nevoa hover:bg-grafite-elevado hover:text-branco-cru">
          {conversa.muted ? <BellOff size={16} /> : <Bell size={16} />}
        </button>
        <button type="button" onClick={onOpenFiles} aria-label="Arquivos da conversa" title="Arquivos da conversa" className="flex size-8 items-center justify-center rounded-md text-nevoa hover:bg-grafite-elevado hover:text-branco-cru"><FolderOpen size={16} /></button>
      </header>

      <div ref={rolagem} onScroll={aoRolar} className="min-h-0 flex-1 overflow-y-auto py-3" role="log" aria-live="polite" aria-label="Mensagens">
        {consulta.isFetchingNextPage && <p className="flex justify-center py-2 text-nevoa"><Loader2 size={16} className="animate-spin" /></p>}
        {!consulta.hasNextPage && consulta.isSuccess && (
          <div className="px-4 pb-4 pt-6">
            <p className="font-heading text-base font-semibold text-branco-cru">{conversa.kind === 'general' ? 'Início do #Geral' : `Início da conversa com ${conversa.title}`}</p>
            <p className="text-sm text-nevoa">{conversa.kind === 'general' ? 'Todo mundo da equipe lê e escreve aqui.' : 'Só vocês dois veem estas mensagens.'}</p>
          </div>
        )}
        {consulta.isPending && <p className="flex justify-center py-10 text-nevoa"><Loader2 className="animate-spin" /></p>}
        {consulta.isError && (
          <div className="px-4 py-10 text-center text-sm text-erro">
            Não foi possível carregar as mensagens. <button type="button" onClick={() => void consulta.refetch()} className="underline">Tentar de novo</button>
          </div>
        )}
        {mensagens.map((m, i) => {
          const anterior = mensagens[i - 1];
          const novoDia = !anterior || new Date(anterior.created_at).toDateString() !== new Date(m.created_at).toDateString();
          const agrupada = !novoDia && Boolean(anterior) && anterior!.sender_id === m.sender_id && !m.reply_to && new Date(m.created_at).getTime() - new Date(anterior!.created_at).getTime() < JANELA_DE_AGRUPAMENTO_MS;
          return (
            <Fragment key={m.client_message_id + m.sender_id}>
              {novoDia && (
                <div className="my-3 flex items-center gap-3 px-4" role="separator">
                  <span className="h-px flex-1 bg-grafite-elevado" />
                  <span className="font-mono text-[11px] text-nevoa">{rotuloDoDia(m.created_at)}</span>
                  <span className="h-px flex-1 bg-grafite-elevado" />
                </div>
              )}
              <Mensagem
                m={m}
                agrupada={agrupada}
                souEu={m.sender_id === me.id}
                me={me}
                membros={mapaDeMembros}
                destacada={destaque === m.id}
                onReply={() => { setRespondendo(m); composer.current?.focus(); }}
                onRetry={() => aoEnviar({ clientMessageId: m.client_message_id, content: m.content ?? '', attachments: m.attachments, mentions: m.mentions, replyTo: m.reply_to })}
                onEdit={(content) => editar.mutate({ messageId: m.id, content }, { onError: (e) => toast(e.message, 'error') })}
                onDelete={() => setParaApagar(m)}
                onReact={(emoji) => reagir.mutate({ messageId: m.id, emoji }, { onError: (e) => toast(e.message, 'error') })}
                onJump={(id) => void irPara(id)}
              />
            </Fragment>
          );
        })}
      </div>

      {longeDoFim && (
        <button type="button" onClick={() => { const el = rolagem.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); }} aria-label="Ir para as mensagens mais recentes" className="absolute bottom-24 right-6 flex size-9 items-center justify-center rounded-full border border-grafite-elevado bg-grafite text-nevoa shadow-lg hover:text-branco-cru">
          <ArrowDown size={16} />
        </button>
      )}

      <p className="h-5 px-4 font-mono text-[11px] text-nevoa" aria-live="polite">
        {digitando.length === 1 ? `${digitando[0]} está digitando…` : digitando.length > 1 ? `${digitando.slice(0, 2).join(' e ')} estão digitando…` : ''}
      </p>
      <Composer
        ref={composer}
        conversationId={conversa.id}
        members={membros}
        replyTo={respondendo}
        onCancelReply={() => setRespondendo(null)}
        onSend={aoEnviar}
        placeholder={conversa.kind === 'general' ? 'Mensagem para #Geral' : `Mensagem para ${conversa.title}`}
      />

      {arrastando && (
        <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-lg border-2 border-dashed border-roxo-eletrico bg-carbono/80">
          <p className="font-heading text-sm text-branco-cru">Solte para anexar</p>
        </div>
      )}

      {paraApagar && (
        <ConfirmDialog
          title="Apagar mensagem?"
          description="Ela some para todos da conversa, junto com os arquivos anexados. Não dá para desfazer."
          confirmLabel="Apagar"
          isPending={apagar.isPending}
          onCancel={() => setParaApagar(null)}
          onConfirm={() => apagar.mutate(paraApagar.id, { onSettled: () => setParaApagar(null), onError: (e) => toast(e.message, 'error') })}
        />
      )}
    </section>
  );
}

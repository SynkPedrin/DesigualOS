'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BellOff, Hash, Loader2, Paperclip, Search, SquarePen, X } from 'lucide-react';
import { useChatMembers, useChatSearch, useOpenDirectChat, type ChatConversation, type ChatMember, type ChatMessage } from '@/hooks/use-internal-chat';
import { InboxAvatar } from '@/components/inbox/inbox-avatar';
import { toast } from '@/stores/toast-store';
import { cn } from '@/lib/utils';

function quando(iso: string) {
  const d = new Date(iso);
  const hoje = new Date();
  if (d.toDateString() === hoje.toDateString()) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function Previa({ c, meId }: { c: ChatConversation; meId: string }) {
  const u = c.last_message;
  if (!u) return <>{c.kind === 'general' ? 'Canal da equipe toda' : 'Comece a conversa'}</>;
  const prefixo = u.sender_id === meId ? 'Você: ' : '';
  if (u.deleted) return <>{prefixo}<em>mensagem apagada</em></>;
  if (!u.content && u.has_attachment) return <span className="inline-flex items-center gap-1">{prefixo}<Paperclip size={11} /> Arquivo</span>;
  return <>{prefixo}{u.content}</>;
}

function Linha({ c, ativa, meId, onSelect }: { c: ChatConversation; ativa: boolean; meId: string; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} aria-current={ativa ? 'true' : undefined} className={cn('flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-grafite-elevado/60', ativa && 'bg-grafite-elevado')}>
      {c.kind === 'general' ? (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-roxo-eletrico/20 text-roxo-eletrico"><Hash size={17} /></span>
      ) : (
        <span className="relative shrink-0">
          <InboxAvatar name={c.title} photoUrl={c.partner?.avatar_url} />
          {c.partner?.online && <span aria-label="online" className="absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-grafite bg-sinal" />}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={cn('truncate text-sm', c.unread_count > 0 ? 'font-semibold text-branco-cru' : 'font-medium text-branco-cru/90')}>{c.kind === 'general' ? 'Geral' : c.title}</span>
          {c.last_message && <span className="shrink-0 font-mono text-[10px] text-nevoa">{quando(c.last_message.created_at)}</span>}
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className={cn('truncate text-xs', c.unread_count > 0 ? 'text-branco-cru/80' : 'text-nevoa')}><Previa c={c} meId={meId} /></span>
          <span className="flex shrink-0 items-center gap-1">
            {c.muted && <BellOff size={11} className="text-nevoa/70" aria-label="silenciada" />}
            {c.unread_count > 0 && <span className={cn('min-w-[18px] rounded-full px-1.5 text-center font-mono text-[10px] font-semibold leading-[18px]', c.muted ? 'bg-nevoa/30 text-branco-cru' : 'bg-sinal text-grafite')}>{c.unread_count > 99 ? '99+' : c.unread_count}</span>}
          </span>
        </span>
      </span>
    </button>
  );
}

function NovaConversa({ onClose, onOpened }: { onClose: () => void; onOpened: (id: string) => void }) {
  const membros = useChatMembers();
  const abrir = useOpenDirectChat();
  const [busca, setBusca] = useState('');
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => {
    campo.current?.focus();
    function aoTeclar(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [onClose]);
  const lista = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase('pt-BR');
    return (membros.data ?? []).filter((m) => !m.is_me && (!termo || m.name.toLocaleLowerCase('pt-BR').includes(termo)));
  }, [membros.data, busca]);

  function escolher(m: ChatMember) {
    abrir.mutate(m.id, { onSuccess: (r) => { onOpened(r.id); onClose(); }, onError: (e) => toast(e.message, 'error') });
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Nova conversa" onClick={onClose} className="fixed inset-0 z-[100] flex items-start justify-center bg-carbono/80 p-4 pt-[12vh]">
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md overflow-hidden rounded-xl border border-grafite-elevado bg-grafite shadow-2xl">
        <div className="flex items-center justify-between border-b border-grafite-elevado px-4 py-3">
          <h2 className="font-heading text-sm font-semibold text-branco-cru">Nova conversa privada</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="text-nevoa hover:text-branco-cru"><X size={16} /></button>
        </div>
        <div className="p-3">
          <input ref={campo} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar colega pelo nome..." aria-label="Buscar colega" className="w-full rounded-md border border-grafite-elevado bg-carbono/40 px-3 py-2 text-sm text-branco-cru placeholder:text-nevoa/60 focus:border-roxo-eletrico/60 focus:outline-none" />
        </div>
        <ul className="max-h-80 overflow-y-auto pb-2">
          {membros.isPending && <li className="flex justify-center py-6 text-nevoa"><Loader2 className="animate-spin" /></li>}
          {membros.isSuccess && lista.length === 0 && <li className="px-4 py-6 text-center text-sm text-nevoa">Ninguém com esse nome na equipe.</li>}
          {lista.map((m) => (
            <li key={m.id}>
              <button type="button" disabled={abrir.isPending} onClick={() => escolher(m)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-grafite-elevado/60 disabled:opacity-60">
                <span className="relative">
                  <InboxAvatar name={m.name} photoUrl={m.avatar_url} size="sm" />
                  {m.online && <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full border border-grafite bg-sinal" />}
                </span>
                <span className="flex-1 truncate text-sm text-branco-cru">{m.name}</span>
                {m.online && <span className="font-mono text-[10px] text-sinal">online</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ResultadosDaBusca({ termo, conversas, onPick }: { termo: string; conversas: ChatConversation[]; onPick: (conversationId: string, messageId: string) => void }) {
  const busca = useChatSearch(termo);
  const nomeDa = (id: string) => { const c = conversas.find((x) => x.id === id); return c ? (c.kind === 'general' ? '# Geral' : c.title) : 'Conversa'; };
  if (termo.trim().length < 2) return <p className="p-4 text-center text-xs text-nevoa">Digite ao menos 2 letras.</p>;
  if (busca.isPending) return <p className="flex justify-center py-6 text-nevoa"><Loader2 className="animate-spin" /></p>;
  if (busca.isError) return <p className="p-4 text-center text-sm text-erro">A busca falhou.</p>;
  if (!busca.data?.length) return <p className="p-4 text-center text-sm text-nevoa">Nenhuma mensagem com &ldquo;{termo}&rdquo;.</p>;
  return (
    <ul className="divide-y divide-grafite-elevado">
      {busca.data.map((m: ChatMessage) => (
        <li key={m.id}>
          <button type="button" onClick={() => onPick(m.conversation_id, m.id)} className="block w-full px-3 py-2.5 text-left hover:bg-grafite-elevado/60">
            <span className="flex justify-between gap-2 font-mono text-[10px] text-nevoa"><span className="truncate">{nomeDa(m.conversation_id)} · {m.sender_name}</span><span>{quando(m.created_at)}</span></span>
            <span className="line-clamp-2 text-xs text-branco-cru/90">{m.content}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ListaDeConversas({ conversas, carregando, erro, ativaId, meId, onSelect, onPickSearch }: {
  conversas: ChatConversation[];
  carregando: boolean;
  erro: boolean;
  ativaId: string | null;
  meId: string;
  onSelect: (id: string) => void;
  onPickSearch: (conversationId: string, messageId: string) => void;
}) {
  const [busca, setBusca] = useState('');
  const [termo, setTermo] = useState('');
  const [nova, setNova] = useState(false);
  useEffect(() => { const t = setTimeout(() => setTermo(busca), 300); return () => clearTimeout(t); }, [busca]);
  const geral = conversas.filter((c) => c.kind === 'general');
  const privadas = conversas.filter((c) => c.kind === 'direct');
  const buscando = busca.trim().length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-grafite-elevado px-3 py-2.5">
        <h1 className="font-heading text-sm font-semibold text-branco-cru">Comunicação</h1>
        <button type="button" onClick={() => setNova(true)} title="Nova conversa" aria-label="Nova conversa" className="flex size-7 items-center justify-center rounded-md bg-roxo-eletrico text-branco-cru transition-opacity hover:opacity-90"><SquarePen size={14} /></button>
      </div>
      <div className="border-b border-grafite-elevado p-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-nevoa" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nas mensagens..." aria-label="Buscar nas mensagens" className="w-full rounded-md border border-grafite-elevado bg-grafite py-1.5 pl-8 pr-7 text-[13px] text-branco-cru placeholder:text-nevoa/60 focus:border-roxo-eletrico/60 focus:outline-none" />
          {buscando && <button type="button" onClick={() => setBusca('')} aria-label="Limpar busca" className="absolute right-2 top-1/2 -translate-y-1/2 text-nevoa hover:text-branco-cru"><X size={13} /></button>}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {buscando ? (
          <ResultadosDaBusca termo={termo} conversas={conversas} onPick={(c, m) => { setBusca(''); onPickSearch(c, m); }} />
        ) : carregando ? (
          <p className="flex justify-center py-8 text-nevoa"><Loader2 className="animate-spin" /></p>
        ) : erro ? (
          <p className="p-4 text-center text-sm text-erro">Não foi possível carregar as conversas.</p>
        ) : (
          <>
            <p className="px-3 pb-1 pt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-nevoa/60">Canais</p>
            {geral.map((c) => <Linha key={c.id} c={c} ativa={c.id === ativaId} meId={meId} onSelect={() => onSelect(c.id)} />)}
            <p className="px-3 pb-1 pt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-nevoa/60">Privadas</p>
            {privadas.length === 0 && (
              <button type="button" onClick={() => setNova(true)} className="mx-3 mb-2 block w-[calc(100%-1.5rem)] rounded-md border border-dashed border-grafite-elevado px-3 py-3 text-left text-xs text-nevoa hover:border-nevoa/40 hover:text-branco-cru">
                Nenhuma conversa privada ainda. Clique para falar com alguém da equipe.
              </button>
            )}
            {privadas.map((c) => <Linha key={c.id} c={c} ativa={c.id === ativaId} meId={meId} onSelect={() => onSelect(c.id)} />)}
          </>
        )}
      </div>
      {nova && <NovaConversa onClose={() => setNova(false)} onOpened={onSelect} />}
    </div>
  );
}

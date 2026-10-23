'use client';

import { useEffect, useRef, useState } from 'react';
import { Bookmark, BookmarkCheck, CheckSquare, Copy, CornerUpLeft, MessageSquareReply, MoreHorizontal, Pencil, Pin, PinOff, RotateCcw, SmilePlus, Trash2 } from 'lucide-react';
import type { ChatMember, ChatMessage } from '@/hooks/use-internal-chat';
import { InboxAvatar } from '@/components/inbox/inbox-avatar';
import { toast } from '@/stores/toast-store';
import { AnexosDaMensagem } from './anexos';
import { CartaoDeObjeto } from './cartao-de-objeto';
import { TextoFormatado } from './texto-formatado';
import { cn } from '@/lib/utils';

export const REACOES_RAPIDAS = ['👍', '❤️', '😂', '🎉', '👀', '✅', '🙏', '🔥'];

export function hora(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function rotuloDoDia(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(); ontem.setDate(hoje.getDate() - 1);
  if (d.toDateString() === hoje.toDateString()) return 'Hoje';
  if (d.toDateString() === ontem.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: d.getFullYear() === hoje.getFullYear() ? undefined : 'numeric' });
}

function haQuanto(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export interface AcoesDaMensagem {
  onReply?: ((m: ChatMessage) => void) | undefined;
  onThread?: ((m: ChatMessage) => void) | undefined;
  onRetry: (m: ChatMessage) => void;
  onEdit: (m: ChatMessage, content: string) => void;
  onDelete: (m: ChatMessage) => void;
  onReact: (m: ChatMessage, emoji: string) => void;
  onPin?: ((m: ChatMessage) => void) | undefined;
  onSave: (m: ChatMessage) => void;
  onCreateTask?: ((m: ChatMessage) => void) | undefined;
  onJump: (id: string) => void;
}

export function Mensagem({ m, agrupada, me, membros, destacada, podeEscrever, acoes, visto }: {
  m: ChatMessage;
  agrupada: boolean;
  me: { id: string; name: string | null };
  membros: Map<string, ChatMember>;
  destacada: boolean;
  podeEscrever: boolean;
  acoes: AcoesDaMensagem;
  /** "Visto por …" (só na última mensagem minha de privada/grupo). */
  visto?: string | null;
}) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(m.content ?? '');
  const [reagindo, setReagindo] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const local = m.id.startsWith('local-');
  const souEu = m.sender_id === me.id;
  const nomesMencionados = m.mentions.map((id) => membros.get(id)?.name).filter((n): n is string => Boolean(n));

  useEffect(() => {
    if (!menu && !reagindo) return;
    function fora(e: MouseEvent) { if (menuRef.current && !menuRef.current.contains(e.target as Node)) { setMenu(false); setReagindo(false); } }
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [menu, reagindo]);

  if (m.kind === 'system') {
    return (
      <div id={`msg-${m.id}`} className="my-1 px-4 text-center font-mono text-[11px] text-nevoa">
        <span className="font-semibold">{souEu ? 'Você' : m.sender_name ?? 'Alguém'}</span> {m.content} · {hora(m.created_at)}
      </div>
    );
  }

  const respostas = m.reply_count ?? 0;

  return (
    <div
      id={`msg-${m.id}`}
      className={cn('group relative flex gap-3 rounded-md px-4 transition-colors hover:bg-grafite-elevado/30', agrupada ? 'py-0.5' : 'mt-2 pb-0.5 pt-1.5', destacada && 'bg-roxo-eletrico/15', m.pinned && 'border-l-2 border-aviso/70')}
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
            {m.pinned && <span className="inline-flex items-center gap-0.5 font-mono text-[10px] text-aviso"><Pin size={10} /> fixada</span>}
            {m.saved && <span className="inline-flex items-center gap-0.5 font-mono text-[10px] text-roxo-eletrico"><BookmarkCheck size={10} /> salva</span>}
          </p>
        )}
        {m.reply_to && (
          <button type="button" onClick={() => acoes.onJump(m.reply_to!.id)} className="mb-1 mt-0.5 block max-w-full truncate rounded border-l-2 border-nevoa/40 bg-grafite-elevado/40 px-2 py-0.5 text-left text-xs text-nevoa hover:text-branco-cru">
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
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (rascunho.trim() || m.attachments.length) { acoes.onEdit(m, rascunho.trim()); setEditando(false); } }
              }}
              className="w-full resize-none rounded-md border border-roxo-eletrico/60 bg-carbono/40 px-2 py-1.5 text-sm text-branco-cru focus:outline-none"
              rows={Math.min(8, Math.max(1, rascunho.split('\n').length))}
            />
            <p className="font-mono text-[10px] text-nevoa">Enter salva · Esc cancela</p>
          </div>
        ) : (
          <>
            {m.content && <TextoFormatado texto={m.content} mencoes={nomesMencionados} meuNome={me.name} />}
            <AnexosDaMensagem anexos={m.attachments} />
            {(m.objects ?? []).map((o) => <CartaoDeObjeto key={o.id} objeto={o} />)}
            {m.edited_at && <span className="font-mono text-[10px] text-nevoa/70">(editada)</span>}
          </>
        )}
        {m.local_status === 'sending' && <p className="font-mono text-[10px] text-nevoa">Enviando…</p>}
        {m.local_status === 'failed' && (
          <p className="flex items-center gap-2 font-mono text-[11px] text-erro">
            Não enviada.
            <button type="button" onClick={() => acoes.onRetry(m)} className="flex items-center gap-1 underline"><RotateCcw size={11} /> Tentar de novo</button>
          </p>
        )}
        {m.reactions.length > 0 && !m.deleted && (
          <div className="mt-1 flex flex-wrap gap-1">
            {m.reactions.map((r) => {
              const minha = r.user_ids.includes(me.id);
              const quem = r.user_ids.map((id) => (id === me.id ? 'você' : membros.get(id)?.name ?? 'alguém')).join(', ');
              return (
                <button key={r.emoji} type="button" disabled={!podeEscrever} onClick={() => acoes.onReact(m, r.emoji)} title={quem} aria-pressed={minha} aria-label={`${r.emoji} ${r.user_ids.length}`} className={cn('flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs', minha ? 'border-roxo-eletrico/60 bg-roxo-eletrico/15 text-branco-cru' : 'border-grafite-elevado text-nevoa hover:border-nevoa/40')}>
                  <span>{r.emoji}</span><span className="font-mono">{r.user_ids.length}</span>
                </button>
              );
            })}
          </div>
        )}
        {respostas > 0 && acoes.onThread && !m.thread_root_id && (
          <button type="button" onClick={() => acoes.onThread!(m)} className="mt-1 flex items-center gap-2 rounded-md px-1 py-0.5 text-xs text-roxo-eletrico hover:bg-roxo-eletrico/10">
            <span className="flex -space-x-1.5">
              {(m.thread_participants ?? []).slice(0, 3).map((p) => <span key={p.id} className="rounded-full ring-2 ring-grafite"><InboxAvatar name={p.name ?? '?'} photoUrl={p.avatar_url} size="sm" /></span>)}
            </span>
            <span className="font-semibold">{respostas} {respostas === 1 ? 'resposta' : 'respostas'}</span>
            {m.last_reply_at && <span className="text-nevoa">· última {haQuanto(m.last_reply_at)}</span>}
          </button>
        )}
        {visto && <p className="mt-0.5 text-right font-mono text-[10px] text-nevoa">{visto}</p>}
      </div>
      {!m.deleted && !local && !editando && (
        <div ref={menuRef} className={cn('absolute -top-3 right-4 items-center gap-0.5 rounded-md border border-grafite-elevado bg-grafite p-0.5 shadow-lg', menu || reagindo ? 'flex' : 'hidden group-hover:flex group-focus-within:flex')}>
          {podeEscrever && (
            <div className="relative">
              <button type="button" onClick={() => { setReagindo((v) => !v); setMenu(false); }} aria-label="Reagir" title="Reagir" className="flex size-7 items-center justify-center rounded text-nevoa hover:bg-grafite-elevado hover:text-branco-cru"><SmilePlus size={14} /></button>
              {reagindo && (
                <div className="absolute right-0 top-full z-20 mt-1 flex gap-0.5 rounded-md border border-grafite-elevado bg-grafite p-1 shadow-xl">
                  {REACOES_RAPIDAS.map((e) => <button key={e} type="button" onClick={() => { acoes.onReact(m, e); setReagindo(false); }} className="rounded p-1 text-base hover:bg-grafite-elevado">{e}</button>)}
                </div>
              )}
            </div>
          )}
          {podeEscrever && acoes.onThread && !m.thread_root_id && (
            <button type="button" onClick={() => acoes.onThread!(m)} aria-label="Responder em thread" title="Responder em thread" className="flex size-7 items-center justify-center rounded text-nevoa hover:bg-grafite-elevado hover:text-branco-cru"><MessageSquareReply size={14} /></button>
          )}
          {podeEscrever && acoes.onReply && (
            <button type="button" onClick={() => acoes.onReply!(m)} aria-label="Responder citando" title="Responder citando" className="flex size-7 items-center justify-center rounded text-nevoa hover:bg-grafite-elevado hover:text-branco-cru"><CornerUpLeft size={14} /></button>
          )}
          <button type="button" onClick={() => acoes.onSave(m)} aria-label={m.saved ? 'Tirar dos salvos' : 'Salvar para depois'} title={m.saved ? 'Tirar dos salvos' : 'Salvar para depois'} className="flex size-7 items-center justify-center rounded text-nevoa hover:bg-grafite-elevado hover:text-branco-cru">
            {m.saved ? <BookmarkCheck size={14} className="text-roxo-eletrico" /> : <Bookmark size={14} />}
          </button>
          <div className="relative">
            <button type="button" onClick={() => { setMenu((v) => !v); setReagindo(false); }} aria-label="Mais ações" aria-expanded={menu} title="Mais ações" className="flex size-7 items-center justify-center rounded text-nevoa hover:bg-grafite-elevado hover:text-branco-cru"><MoreHorizontal size={14} /></button>
            {menu && (
              <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-52 overflow-hidden rounded-md border border-grafite-elevado bg-grafite py-1 shadow-xl">
                {acoes.onPin && podeEscrever && !m.thread_root_id && (
                  <ItemDoMenu icone={m.pinned ? PinOff : Pin} rotulo={m.pinned ? 'Desafixar' : 'Fixar na conversa'} onClick={() => { setMenu(false); acoes.onPin!(m); }} />
                )}
                {acoes.onCreateTask && podeEscrever && <ItemDoMenu icone={CheckSquare} rotulo="Criar tarefa" onClick={() => { setMenu(false); acoes.onCreateTask!(m); }} />}
                {m.content && <ItemDoMenu icone={Copy} rotulo="Copiar texto" onClick={() => { setMenu(false); void navigator.clipboard?.writeText(m.content ?? '').then(() => toast('Texto copiado.', 'success')).catch(() => undefined); }} />}
                {souEu && podeEscrever && (
                  <>
                    <ItemDoMenu icone={Pencil} rotulo="Editar" onClick={() => { setMenu(false); setRascunho(m.content ?? ''); setEditando(true); }} />
                    <ItemDoMenu icone={Trash2} rotulo="Apagar" perigo onClick={() => { setMenu(false); acoes.onDelete(m); }} />
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ItemDoMenu({ icone: Icone, rotulo, onClick, perigo }: { icone: typeof Pin; rotulo: string; onClick: () => void; perigo?: boolean }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-grafite-elevado', perigo ? 'text-erro' : 'text-branco-cru')}>
      <Icone size={14} className={perigo ? 'text-erro' : 'text-nevoa'} /> {rotulo}
    </button>
  );
}

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AtSign, BellOff, Bookmark, Compass, FolderOpen, GraduationCap, Hash, HelpCircle, Home, Loader2, Lock, MessageSquarePlus, Paperclip, Plus, Search, SquarePen, Users, X } from 'lucide-react';
import { useChatMembers, useOpenDirectChat, type ChatConversation, type ChatMember } from '@/hooks/use-internal-chat';
import { InboxAvatar } from '@/components/inbox/inbox-avatar';
import { toast } from '@/stores/toast-store';
import { IconeDaConversa } from './painel-da-conversa';
import { Modal } from './modais';
import { cn } from '@/lib/utils';

export type Visao = 'inicio' | 'mencoes' | 'salvos' | 'arquivos' | 'busca';

function quando(iso: string) {
  const d = new Date(iso);
  const hoje = new Date();
  if (d.toDateString() === hoje.toDateString()) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function Previa({ c, meId }: { c: ChatConversation; meId: string }) {
  const u = c.last_message;
  if (!u) return <>{c.kind === 'general' ? 'Canal da equipe toda' : c.kind === 'channel' ? (c.description || 'Canal da equipe') : 'Comece a conversa'}</>;
  const quem = u.sender_id === meId ? 'Você' : c.kind === 'direct' ? '' : (u.sender_name ?? '').split(' ')[0];
  const prefixo = quem ? `${quem}: ` : '';
  if (u.kind === 'system') return <em>{prefixo}{u.content}</em>;
  if (u.deleted) return <>{prefixo}<em>mensagem apagada</em></>;
  if (!u.content && u.has_attachment) return <span className="inline-flex items-center gap-1">{prefixo}<Paperclip size={11} /> Arquivo</span>;
  return <>{prefixo}{(u.content ?? 'Item compartilhado').replace(/[*_`~]/g, '')}</>;
}

function Linha({ c, ativa, meId, onSelect }: { c: ChatConversation; ativa: boolean; meId: string; onSelect: () => void }) {
  const naoLida = c.unread_count > 0;
  const mencao = (c.mentions_unread ?? 0) > 0;
  return (
    <button type="button" onClick={onSelect} aria-current={ativa ? 'true' : undefined} data-tour-id={c.kind === 'general' ? 'comunicacao-geral' : undefined} className={cn('flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-grafite-elevado/60', ativa && 'bg-grafite-elevado')}>
      <IconeDaConversa c={c} tamanho="sm" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={cn('truncate text-sm', naoLida ? 'font-semibold text-branco-cru' : 'font-medium text-branco-cru/85')}>{c.kind === 'general' ? 'Geral' : c.title}</span>
          {c.last_message && <span className="shrink-0 font-mono text-[10px] text-nevoa">{quando(c.last_message.created_at)}</span>}
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className={cn('truncate text-xs', naoLida ? 'text-branco-cru/80' : 'text-nevoa')}><Previa c={c} meId={meId} /></span>
          <span className="flex shrink-0 items-center gap-1">
            {c.muted && <BellOff size={11} className="text-nevoa/70" aria-label="silenciada" />}
            {mencao && <span className="rounded-full bg-erro px-1.5 font-mono text-[10px] font-semibold leading-[18px] text-branco-cru" aria-label={`${c.mentions_unread} menções`}>@</span>}
            {naoLida && <span className={cn('min-w-[18px] rounded-full px-1.5 text-center font-mono text-[10px] font-semibold leading-[18px]', c.muted ? 'bg-nevoa/30 text-branco-cru' : 'bg-sinal text-grafite')}>{c.unread_count > 99 ? '99+' : c.unread_count}</span>}
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
  useEffect(() => { campo.current?.focus(); }, []);
  const lista = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase('pt-BR');
    return (membros.data ?? []).filter((m) => !m.is_me && (!termo || m.name.toLocaleLowerCase('pt-BR').includes(termo)));
  }, [membros.data, busca]);
  function escolher(m: ChatMember) {
    abrir.mutate(m.id, { onSuccess: (r) => { onOpened(r.id); onClose(); }, onError: (e) => toast(e.message, 'error') });
  }
  return (
    <Modal titulo="Nova conversa" onClose={onClose}>
      <div className="p-3"><input ref={campo} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar colega pelo nome..." aria-label="Buscar colega" className="w-full rounded-md border border-grafite-elevado bg-carbono/40 px-3 py-2 text-sm text-branco-cru placeholder:text-nevoa/60 focus:border-roxo-eletrico/60 focus:outline-none" /></div>
      <ul className="max-h-80 overflow-y-auto pb-2">
        {membros.isPending && <li className="flex justify-center py-6 text-nevoa"><Loader2 className="animate-spin" /></li>}
        {membros.isSuccess && lista.length === 0 && <li className="px-4 py-6 text-center text-sm text-nevoa">Ninguém com esse nome na equipe.</li>}
        {lista.map((m) => {
          const estado = m.presence ?? (m.online ? 'online' : 'offline');
          return (
            <li key={m.id}>
              <button type="button" disabled={abrir.isPending} onClick={() => escolher(m)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-grafite-elevado/60 disabled:opacity-60">
                <span className="relative"><InboxAvatar name={m.name} photoUrl={m.avatar_url} size="sm" />{estado !== 'offline' && <span className={cn('absolute -bottom-0.5 -right-0.5 size-2 rounded-full border border-grafite', estado === 'away' ? 'bg-aviso' : 'bg-sinal')} />}</span>
                <span className="flex-1 truncate text-sm text-branco-cru">{m.name}</span>
                {estado === 'online' ? <span className="font-mono text-[10px] text-sinal">online</span> : estado === 'away' ? <span className="font-mono text-[10px] text-aviso">ausente</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

function Secao({ titulo, children, acao }: { titulo: string; children: React.ReactNode; acao?: React.ReactNode }) {
  return (
    <div className="pt-3">
      <div className="flex items-center justify-between px-3 pb-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-nevoa/60">{titulo}</p>
        {acao}
      </div>
      {children}
    </div>
  );
}

export function ListaDeConversas({ conversas, carregando, erro, ativaId, visao, meId, onSelect, onVisao, onSearch, onCriarCanal, onCriarGrupo, onProcurarCanais, onConhecer }: {
  conversas: ChatConversation[];
  carregando: boolean;
  erro: boolean;
  ativaId: string | null;
  visao: Visao | null;
  meId: string;
  onSelect: (id: string) => void;
  onVisao: (v: Visao) => void;
  onSearch: (termo: string) => void;
  onCriarCanal: () => void;
  onCriarGrupo: () => void;
  onProcurarCanais: () => void;
  /** Ajuda → Conhecer Comunicação: reabre o tutorial guiado. */
  onConhecer: () => void;
}) {
  const [busca, setBusca] = useState('');
  const [nova, setNova] = useState(false);
  const [menuNovo, setMenuNovo] = useState(false);
  const [menuAjuda, setMenuAjuda] = useState(false);
  const geral = conversas.filter((c) => c.kind === 'general');
  const canais = conversas.filter((c) => c.kind === 'channel');
  const privadas = conversas.filter((c) => c.kind === 'direct' || c.kind === 'group');
  const discussoes = conversas.filter((c) => c.kind === 'discussion');
  const mencoes = conversas.reduce((t, c) => t + (c.mentions_unread ?? 0), 0);

  const itemNav = (v: Visao, rotulo: string, Icone: typeof Home, badge?: number) => (
    <button key={v} type="button" onClick={() => onVisao(v)} aria-current={visao === v ? 'page' : undefined} className={cn('flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-sm transition-colors', visao === v ? 'bg-grafite-elevado text-branco-cru' : 'text-nevoa hover:bg-grafite-elevado/60 hover:text-branco-cru')}>
      <Icone size={15} className="shrink-0" /> <span className="flex-1">{rotulo}</span>
      {badge ? <span className="rounded-full bg-erro px-1.5 font-mono text-[10px] font-semibold leading-[18px] text-branco-cru">{badge}</span> : null}
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-grafite-elevado px-3 py-2.5">
        <h1 className="font-heading text-sm font-semibold text-branco-cru">Comunicação</h1>
        <div className="flex items-center gap-1">
        <div className="relative">
          <button type="button" onClick={() => setMenuAjuda((v) => !v)} title="Ajuda" aria-label="Ajuda" aria-expanded={menuAjuda} className="flex size-7 items-center justify-center rounded-md text-nevoa transition-colors hover:bg-grafite-elevado hover:text-branco-cru"><HelpCircle size={15} /></button>
          {menuAjuda && (
            <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-lg border border-grafite-elevado bg-grafite py-1 shadow-2xl">
              <button type="button" role="menuitem" onClick={() => { setMenuAjuda(false); onConhecer(); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-branco-cru hover:bg-grafite-elevado"><GraduationCap size={15} className="text-nevoa" /> Conhecer Comunicação</button>
            </div>
          )}
        </div>
        <div className="relative">
          <button type="button" onClick={() => setMenuNovo((v) => !v)} title="Nova conversa" aria-label="Nova conversa" aria-expanded={menuNovo} data-tour-id="comunicacao-nova-conversa" className="flex size-7 items-center justify-center rounded-md bg-roxo-eletrico text-branco-cru transition-opacity hover:opacity-90"><SquarePen size={14} /></button>
          {menuNovo && (
            <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-lg border border-grafite-elevado bg-grafite py-1 shadow-2xl">
              {([
                ['Conversa privada', MessageSquarePlus, () => setNova(true)],
                ['Grupo', Users, onCriarGrupo],
                ['Criar canal', Hash, onCriarCanal],
                ['Procurar canais', Compass, onProcurarCanais],
              ] as const).map(([rotulo, Icone, acao]) => (
                <button key={rotulo} type="button" role="menuitem" onClick={() => { setMenuNovo(false); acao(); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-branco-cru hover:bg-grafite-elevado"><Icone size={15} className="text-nevoa" /> {rotulo}</button>
              ))}
            </div>
          )}
        </div>
        </div>
      </div>
      <form className="border-b border-grafite-elevado p-2" onSubmit={(e) => { e.preventDefault(); onSearch(busca); }}>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-nevoa" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nas mensagens..." aria-label="Buscar nas mensagens" className="w-full rounded-md border border-grafite-elevado bg-grafite py-1.5 pl-8 pr-7 text-[13px] text-branco-cru placeholder:text-nevoa/60 focus:border-roxo-eletrico/60 focus:outline-none" />
          {busca && <button type="button" onClick={() => setBusca('')} aria-label="Limpar busca" className="absolute right-2 top-1/2 -translate-y-1/2 text-nevoa hover:text-branco-cru"><X size={13} /></button>}
        </div>
      </form>
      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        <nav aria-label="Seções da Comunicação" className="space-y-0.5 px-1.5 pt-2">
          {itemNav('inicio', 'Início', Home)}
          {itemNav('mencoes', 'Menções', AtSign, mencoes)}
          {itemNav('salvos', 'Salvos', Bookmark)}
          {itemNav('arquivos', 'Arquivos', FolderOpen)}
        </nav>
        {carregando ? (
          <p className="flex justify-center py-8 text-nevoa"><Loader2 className="animate-spin" /></p>
        ) : erro ? (
          <p className="p-4 text-center text-sm text-erro">Não foi possível carregar as conversas.</p>
        ) : (
          <>
            <Secao titulo="Canais" acao={<button type="button" onClick={onCriarCanal} aria-label="Criar canal" title="Criar canal" className="text-nevoa hover:text-branco-cru"><Plus size={13} /></button>}>
              {[...geral, ...canais].map((c) => <Linha key={c.id} c={c} ativa={c.id === ativaId} meId={meId} onSelect={() => onSelect(c.id)} />)}
              <button type="button" onClick={onProcurarCanais} className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs text-nevoa hover:text-branco-cru"><Compass size={14} /> Procurar canais</button>
            </Secao>
            <Secao titulo="Mensagens privadas" acao={<button type="button" onClick={() => setNova(true)} aria-label="Nova conversa privada" title="Nova conversa privada" className="text-nevoa hover:text-branco-cru"><Plus size={13} /></button>}>
              {privadas.length === 0 && (
                <button type="button" onClick={() => setNova(true)} className="mx-3 mb-2 block w-[calc(100%-1.5rem)] rounded-md border border-dashed border-grafite-elevado px-3 py-3 text-left text-xs text-nevoa hover:border-nevoa/40 hover:text-branco-cru">
                  Nenhuma conversa privada ainda. Clique para falar com alguém da equipe.
                </button>
              )}
              {privadas.map((c) => <Linha key={c.id} c={c} ativa={c.id === ativaId} meId={meId} onSelect={() => onSelect(c.id)} />)}
            </Secao>
            {discussoes.length > 0 && (
              <Secao titulo="Discussões">
                {discussoes.map((c) => <Linha key={c.id} c={c} ativa={c.id === ativaId} meId={meId} onSelect={() => onSelect(c.id)} />)}
              </Secao>
            )}
            <p className="mt-3 flex items-center gap-1.5 px-3 font-mono text-[10px] text-nevoa/60"><Lock size={10} /> Privadas e grupos: só quem participa lê.</p>
          </>
        )}
      </div>
      {nova && <NovaConversa onClose={() => setNova(false)} onOpened={onSelect} />}
    </div>
  );
}

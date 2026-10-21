'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Hash, Loader2, Lock, Search, Users, X } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';
import { useAgencyTasks } from '@/hooks/use-tasks';
import { useClients } from '@/hooks/use-clients';
import { useDemands } from '@/hooks/use-demands';
import {
  newClientMessageId,
  useBrowseChannels,
  useChatConversations,
  useChatMembers,
  useConversationActions,
  useCreateChannel,
  useCreateGroup,
  useCreateTaskFromMessage,
  type ChatMember,
  type ChatMessage,
  type ObjectToShare,
} from '@/hooks/use-internal-chat';
import { InboxAvatar } from '@/components/inbox/inbox-avatar';
import { toast } from '@/stores/toast-store';
import { cn } from '@/lib/utils';

/** Moldura comum dos modais da Comunicação: Esc fecha, clique fora fecha. */
export function Modal({ titulo, onClose, children, largura = 'max-w-md' }: { titulo: string; onClose: () => void; children: ReactNode; largura?: string }) {
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={titulo} onClick={onClose} className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-carbono/80 p-4 pt-[10vh]">
      <div onClick={(e) => e.stopPropagation()} className={cn('w-full overflow-hidden rounded-xl border border-grafite-elevado bg-grafite shadow-2xl', largura)}>
        <div className="flex items-center justify-between border-b border-grafite-elevado px-4 py-3">
          <h2 className="font-heading text-sm font-semibold text-branco-cru">{titulo}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="text-nevoa hover:text-branco-cru"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const campo = 'w-full rounded-md border border-grafite-elevado bg-carbono/40 px-3 py-2 text-sm text-branco-cru placeholder:text-nevoa/60 focus:border-roxo-eletrico/60 focus:outline-none';
const botaoPrimario = 'rounded-md bg-roxo-eletrico px-3 py-2 text-sm font-medium text-branco-cru disabled:opacity-50';

/** Lista de colegas com busca e seleção múltipla. */
function EscolherPessoas({ membros, selecionados, onToggle, excluir = [] }: { membros: ChatMember[]; selecionados: Set<string>; onToggle: (id: string) => void; excluir?: string[] }) {
  const [busca, setBusca] = useState('');
  const lista = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase('pt-BR');
    return membros.filter((m) => !m.is_me && !excluir.includes(m.id) && (!termo || m.name.toLocaleLowerCase('pt-BR').includes(termo)));
  }, [membros, busca, excluir]);
  return (
    <div>
      <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar colega pelo nome..." aria-label="Buscar colega" className={campo} />
      <ul className="mt-2 max-h-56 overflow-y-auto">
        {lista.length === 0 && <li className="px-2 py-4 text-center text-xs text-nevoa">Ninguém com esse nome.</li>}
        {lista.map((m) => {
          const marcado = selecionados.has(m.id);
          return (
            <li key={m.id}>
              <button type="button" onClick={() => onToggle(m.id)} aria-pressed={marcado} className={cn('flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-grafite-elevado/60', marcado && 'bg-roxo-eletrico/10')}>
                <InboxAvatar name={m.name} photoUrl={m.avatar_url} size="sm" />
                <span className="flex-1 truncate text-sm text-branco-cru">{m.name}</span>
                {marcado && <Check size={14} className="text-roxo-eletrico" />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function CriarCanal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const membros = useChatMembers();
  const criar = useCreateChannel();
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [privado, setPrivado] = useState(false);
  const [pessoas, setPessoas] = useState<Set<string>>(new Set());
  const nomeLimpo = nome.trim().replace(/^#+/, '').replace(/\s+/g, '-').toLocaleLowerCase('pt-BR');
  return (
    <Modal titulo="Criar canal" onClose={onClose}>
      <form className="space-y-3 p-4" onSubmit={(e) => {
        e.preventDefault();
        criar.mutate({ name: nome, description: descricao, visibility: privado ? 'private' : 'public', memberIds: [...pessoas] }, {
          onSuccess: (r) => { onCreated(r.id); onClose(); },
          onError: (err) => toast(err.message, 'error'),
        });
      }}>
        <label className="block text-xs text-nevoa">Nome
          <div className="relative mt-1"><Hash size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-nevoa" /><input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ex.: criação, tráfego, social-media" maxLength={80} className={cn(campo, 'pl-8')} /></div>
        </label>
        {nomeLimpo && <p className="font-mono text-[11px] text-nevoa">Vai aparecer como #{nomeLimpo}</p>}
        <label className="block text-xs text-nevoa">Descrição (opcional)
          <input value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={500} placeholder="Para que serve este canal" className={cn(campo, 'mt-1')} />
        </label>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Quem pode ver">
          {([[false, 'Público', 'Toda a equipe encontra e entra', Users], [true, 'Privado', 'Só quem for convidado', Lock]] as const).map(([valor, titulo, ajuda, Icone]) => (
            <button key={titulo} type="button" role="radio" aria-checked={privado === valor} onClick={() => setPrivado(valor)} className={cn('rounded-lg border p-2.5 text-left', privado === valor ? 'border-roxo-eletrico bg-roxo-eletrico/10' : 'border-grafite-elevado')}>
              <p className="flex items-center gap-1.5 text-sm font-medium text-branco-cru"><Icone size={14} /> {titulo}</p>
              <p className="text-[11px] text-nevoa">{ajuda}</p>
            </button>
          ))}
        </div>
        <div>
          <p className="mb-1 text-xs text-nevoa">{privado ? 'Convidar' : 'Adicionar agora (opcional)'}{pessoas.size ? ` · ${pessoas.size}` : ''}</p>
          {membros.isPending ? <Loader2 className="mx-auto animate-spin text-nevoa" /> : <EscolherPessoas membros={membros.data ?? []} selecionados={pessoas} onToggle={(id) => setPessoas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })} />}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm text-nevoa hover:text-branco-cru">Cancelar</button>
          <button type="submit" disabled={!nomeLimpo || criar.isPending} className={botaoPrimario}>{criar.isPending ? 'Criando…' : 'Criar canal'}</button>
        </div>
      </form>
    </Modal>
  );
}

export function CriarGrupo({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const membros = useChatMembers();
  const criar = useCreateGroup();
  const [titulo, setTitulo] = useState('');
  const [pessoas, setPessoas] = useState<Set<string>>(new Set());
  return (
    <Modal titulo="Nova conversa em grupo" onClose={onClose}>
      <div className="space-y-3 p-4">
        <label className="block text-xs text-nevoa">Nome do grupo (opcional)
          <input autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={80} placeholder="ex.: Equipe de Criação" className={cn(campo, 'mt-1')} />
        </label>
        <p className="text-xs text-nevoa">Participantes {pessoas.size ? `· ${pessoas.size}` : '(escolha pelo menos 2)'}</p>
        {membros.isPending ? <Loader2 className="mx-auto animate-spin text-nevoa" /> : <EscolherPessoas membros={membros.data ?? []} selecionados={pessoas} onToggle={(id) => setPessoas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })} />}
        <p className="text-[11px] text-nevoa">Grupo é privado: só os participantes leem. Para um assunto da equipe toda, prefira um canal.</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm text-nevoa hover:text-branco-cru">Cancelar</button>
          <button type="button" disabled={pessoas.size < 2 || criar.isPending} onClick={() => criar.mutate({ title: titulo || undefined, memberIds: [...pessoas] }, { onSuccess: (r) => { onCreated(r.id); onClose(); }, onError: (e) => toast(e.message, 'error') })} className={botaoPrimario}>{criar.isPending ? 'Criando…' : 'Criar grupo'}</button>
        </div>
      </div>
    </Modal>
  );
}

export function AdicionarPessoas({ conversationId, jaEstao, onClose }: { conversationId: string; jaEstao: string[]; onClose: () => void }) {
  const membros = useChatMembers();
  const acoes = useConversationActions(conversationId);
  const [pessoas, setPessoas] = useState<Set<string>>(new Set());
  return (
    <Modal titulo="Adicionar pessoas" onClose={onClose}>
      <div className="space-y-3 p-4">
        <EscolherPessoas membros={membros.data ?? []} excluir={jaEstao} selecionados={pessoas} onToggle={(id) => setPessoas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm text-nevoa hover:text-branco-cru">Cancelar</button>
          <button type="button" disabled={pessoas.size === 0 || acoes.addMembers.isPending} onClick={() => acoes.addMembers.mutate([...pessoas], { onSuccess: onClose, onError: (e) => toast(e.message, 'error') })} className={botaoPrimario}>Adicionar</button>
        </div>
      </div>
    </Modal>
  );
}

export function ProcurarCanais({ onClose, onOpen, onCreate }: { onClose: () => void; onOpen: (id: string) => void; onCreate: () => void }) {
  const canais = useBrowseChannels(true);
  const [busca, setBusca] = useState('');
  const lista = (canais.data ?? []).filter((c) => !busca || c.title.includes(busca.toLocaleLowerCase('pt-BR')) || (c.description ?? '').toLocaleLowerCase('pt-BR').includes(busca.toLocaleLowerCase('pt-BR')));
  return (
    <Modal titulo="Canais da equipe" onClose={onClose} largura="max-w-lg">
      <div className="p-4">
        <div className="flex gap-2">
          <div className="relative flex-1"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-nevoa" /><input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar canal" aria-label="Buscar canal" className={cn(campo, 'pl-8')} /></div>
          <button type="button" onClick={() => { onClose(); onCreate(); }} className={botaoPrimario}>Criar canal</button>
        </div>
        <ul className="mt-3 max-h-[50vh] divide-y divide-grafite-elevado overflow-y-auto">
          {canais.isPending && <li className="flex justify-center py-6 text-nevoa"><Loader2 className="animate-spin" /></li>}
          {canais.isSuccess && lista.length === 0 && <li className="py-6 text-center text-sm text-nevoa">Nenhum canal público ainda. Que tal criar o primeiro?</li>}
          {lista.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => { onOpen(c.id); onClose(); }} className="flex w-full items-center gap-3 px-2 py-2.5 text-left hover:bg-grafite-elevado/50">
                <Hash size={16} className="shrink-0 text-nevoa" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-branco-cru">{c.title}{c.archived && <span className="ml-2 font-mono text-[10px] text-nevoa">arquivado</span>}</span>
                  {c.description && <span className="block truncate text-xs text-nevoa">{c.description}</span>}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-nevoa">{c.member_count} {c.member_count === 1 ? 'pessoa' : 'pessoas'}</span>
                <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px]', c.joined ? 'text-sinal' : 'bg-grafite-elevado text-branco-cru')}>{c.joined ? 'Você está' : 'Abrir'}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

export type TipoEscolhivel = 'task' | 'client' | 'demand';

/** Escolher um item da operação para compartilhar (tarefa do ClickUp, cliente, quinzena). */
export function EscolherItem({ tipo, onClose, onPick }: { tipo: TipoEscolhivel; onClose: () => void; onPick: (o: ObjectToShare) => void }) {
  const [busca, setBusca] = useState('');
  const tarefas = useAgencyTasks();
  const clientes = useClients();
  const quinzenas = useDemands({ limit: 200 }, { enabled: tipo === 'demand' });
  const termo = busca.trim().toLocaleLowerCase('pt-BR');
  const casa = (t: string) => !termo || t.toLocaleLowerCase('pt-BR').includes(termo);
  const itens: Array<{ id: string; titulo: string; detalhe: string | null }> =
    tipo === 'task'
      ? (tarefas.data?.tasks ?? []).filter((t) => casa(`${t.name} ${t.client?.name ?? ''}`)).slice(0, 80).map((t) => ({ id: t.id, titulo: t.name, detalhe: [t.client?.name, t.status].filter(Boolean).join(' · ') }))
      : tipo === 'client'
        ? (clientes.data ?? []).filter((c) => casa(c.name)).slice(0, 80).map((c) => ({ id: c.id, titulo: c.name, detalhe: null }))
        : (quinzenas.data ?? []).filter((d) => casa(`${d.title} ${d.clientName ?? ''}`)).slice(0, 80).map((d) => ({ id: d.id, titulo: d.title, detalhe: d.clientName }));
  const carregando = tipo === 'task' ? tarefas.isPending : tipo === 'client' ? clientes.isPending : quinzenas.isPending;
  const erro = tipo === 'task' ? tarefas.error : tipo === 'client' ? clientes.error : quinzenas.error;
  const titulo = tipo === 'task' ? 'Compartilhar tarefa do ClickUp' : tipo === 'client' ? 'Compartilhar cliente' : 'Compartilhar quinzena';
  return (
    <Modal titulo={titulo} onClose={onClose} largura="max-w-lg">
      <div className="p-4">
        <div className="relative"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-nevoa" /><input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pelo nome..." aria-label="Buscar item" className={cn(campo, 'pl-8')} /></div>
        <ul className="mt-3 max-h-[50vh] divide-y divide-grafite-elevado overflow-y-auto">
          {carregando && <li className="flex justify-center py-6 text-nevoa"><Loader2 className="animate-spin" /></li>}
          {erro && <li className="py-4 text-center text-sm text-erro">{erro instanceof Error ? erro.message : 'Não foi possível carregar.'}</li>}
          {!carregando && !erro && itens.length === 0 && <li className="py-6 text-center text-sm text-nevoa">Nada encontrado.</li>}
          {itens.map((i) => (
            <li key={i.id}>
              <button type="button" onClick={() => onPick({ type: tipo, id: i.id, label: i.titulo })} className="block w-full px-2 py-2 text-left hover:bg-grafite-elevado/50">
                <span className="block truncate text-sm text-branco-cru">{i.titulo}</span>
                {i.detalhe && <span className="block truncate text-xs text-nevoa">{i.detalhe}</span>}
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-nevoa">Compartilhar não dá acesso: quem não puder ver o item vê só um aviso no lugar dos dados.</p>
      </div>
    </Modal>
  );
}

interface MembroDoClickUp { id: number; username: string | null; email: string | null }

/** Criar tarefa no ClickUp a partir de uma mensagem. Só diz "criada" depois que o ClickUp confirmou. */
export function CriarTarefa({ conversationId, mensagem, onClose }: { conversationId: string; mensagem: ChatMessage; onClose: () => void }) {
  const clientes = useClients();
  const membros = useQuery({ queryKey: ['clickup', 'members'], queryFn: () => apiFetch<{ members: MembroDoClickUp[] }>('/clickup/members'), staleTime: 5 * 60_000, retry: false });
  const criar = useCreateTaskFromMessage(conversationId);
  const chave = useRef(newClientMessageId());
  const primeiraLinha = (mensagem.content ?? '').split('\n')[0]!.replace(/[*_`~]/g, '').slice(0, 120);
  const [titulo, setTitulo] = useState(primeiraLinha);
  const [descricao, setDescricao] = useState('');
  const [cliente, setCliente] = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [prazo, setPrazo] = useState('');
  const [prioridade, setPrioridade] = useState('3');
  const comLista = (clientes.data ?? []).filter((c) => c.clickupListId);
  return (
    <Modal titulo="Criar tarefa no ClickUp" onClose={onClose} largura="max-w-lg">
      <form className="space-y-3 p-4" onSubmit={(e) => {
        e.preventDefault();
        criar.mutate({
          messageId: mensagem.id, idempotency_key: chave.current, title: titulo, description: descricao || undefined, client_id: cliente,
          assignee_clickup_id: responsavel ? Number(responsavel) : null,
          due_date: prazo ? new Date(`${prazo}T18:00:00`).getTime() : null,
          priority: Number(prioridade) as 1 | 2 | 3 | 4,
        }, {
          onSuccess: (r) => { toast(r.replay ? 'Essa tarefa já tinha sido criada.' : 'Tarefa criada no ClickUp.', 'success'); onClose(); },
          onError: (err) => toast(err.message, 'error'),
        });
      }}>
        <blockquote className="rounded-md border-l-2 border-nevoa/40 bg-grafite-elevado/40 px-3 py-2 text-xs text-nevoa">
          <span className="font-semibold">{mensagem.sender_name}:</span> {(mensagem.content ?? '').slice(0, 300) || 'mensagem com anexo'}
        </blockquote>
        <label className="block text-xs text-nevoa">Título<input autoFocus required minLength={3} value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={250} className={cn(campo, 'mt-1')} /></label>
        <label className="block text-xs text-nevoa">Descrição (opcional — a mensagem de origem vai junto)<textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={3} className={cn(campo, 'mt-1 resize-y')} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-nevoa">Cliente (lista do ClickUp)
            <select required value={cliente} onChange={(e) => setCliente(e.target.value)} className={cn(campo, 'mt-1')}>
              <option value="">Escolha…</option>
              {comLista.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="block text-xs text-nevoa">Responsável
            <select value={responsavel} onChange={(e) => setResponsavel(e.target.value)} className={cn(campo, 'mt-1')}>
              <option value="">Eu mesmo</option>
              {(membros.data?.members ?? []).map((m) => <option key={m.id} value={m.id}>{m.username ?? m.email}</option>)}
            </select>
          </label>
          <label className="block text-xs text-nevoa">Prazo<input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} className={cn(campo, 'mt-1')} /></label>
          <label className="block text-xs text-nevoa">Prioridade
            <select value={prioridade} onChange={(e) => setPrioridade(e.target.value)} className={cn(campo, 'mt-1')}>
              <option value="1">Urgente</option><option value="2">Alta</option><option value="3">Normal</option><option value="4">Baixa</option>
            </select>
          </label>
        </div>
        {clientes.isSuccess && comLista.length === 0 && <p className="text-xs text-aviso">Nenhum cliente tem lista do ClickUp vinculada.</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm text-nevoa hover:text-branco-cru">Cancelar</button>
          <button type="submit" disabled={!cliente || titulo.trim().length < 3 || criar.isPending} className={botaoPrimario}>{criar.isPending ? 'Criando no ClickUp…' : 'Criar tarefa'}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Escolher a conversa onde um item será compartilhado (usado fora da Comunicação: Mídia, Relatórios, Clientes). */
export function EscolherConversa({ onClose, onPick, enviando }: { onClose: () => void; onPick: (conversationId: string, comentario: string) => void; enviando: boolean }) {
  const conversas = useChatConversations();
  const [busca, setBusca] = useState('');
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const [comentario, setComentario] = useState('');
  const termo = busca.trim().toLocaleLowerCase('pt-BR');
  const lista = (conversas.data ?? []).filter((c) => !termo || c.title.toLocaleLowerCase('pt-BR').includes(termo));
  const prefixo = (k: string) => (k === 'general' || k === 'channel' ? '#' : '');
  return (
    <Modal titulo="Compartilhar na Comunicação" onClose={onClose}>
      <div className="space-y-3 p-4">
        <div className="relative"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-nevoa" /><input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Canal, pessoa ou grupo" aria-label="Buscar conversa" className={cn(campo, 'pl-8')} /></div>
        <ul className="max-h-56 overflow-y-auto">
          {conversas.isPending && <li className="flex justify-center py-4 text-nevoa"><Loader2 className="animate-spin" /></li>}
          {lista.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => setEscolhida(c.id)} aria-pressed={escolhida === c.id} className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-grafite-elevado/60', escolhida === c.id && 'bg-roxo-eletrico/10')}>
                <span className="flex-1 truncate text-branco-cru">{prefixo(c.kind)}{c.title}</span>
                <span className="font-mono text-[10px] text-nevoa">{c.kind === 'direct' ? 'privada' : c.kind === 'group' ? 'grupo' : c.kind === 'discussion' ? 'discussão' : c.visibility === 'private' ? 'canal privado' : 'canal'}</span>
                {escolhida === c.id && <Check size={14} className="text-roxo-eletrico" />}
              </button>
            </li>
          ))}
        </ul>
        <label className="block text-xs text-nevoa">Comentário (opcional)<textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2} maxLength={2000} className={cn(campo, 'mt-1 resize-y')} /></label>
        <p className="text-[11px] text-nevoa">Quem não tiver acesso ao item vê só um aviso — compartilhar não libera os dados.</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm text-nevoa hover:text-branco-cru">Cancelar</button>
          <button type="button" disabled={!escolhida || enviando} onClick={() => escolhida && onPick(escolhida, comentario)} className={botaoPrimario}>{enviando ? 'Enviando…' : 'Compartilhar'}</button>
        </div>
      </div>
    </Modal>
  );
}

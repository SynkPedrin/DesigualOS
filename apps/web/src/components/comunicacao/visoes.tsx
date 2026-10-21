'use client';

import { useEffect, useMemo, useState } from 'react';
import { AtSign, Bookmark, BookmarkX, BellOff, Download, FolderOpen, Hash, Loader2, Moon, Search, SlidersHorizontal } from 'lucide-react';
import {
  useChatConversations,
  useChatMembers,
  useChatPreferences,
  useChatSearch,
  useFileLibrary,
  useMentions,
  useSaveMessage,
  useSavedMessages,
  type ChatAttachment,
  type ChatConversation,
  type ChatMessage,
  type SearchFilters,
} from '@/hooks/use-internal-chat';
import { InboxAvatar } from '@/components/inbox/inbox-avatar';
import { toast } from '@/stores/toast-store';
import { IconeDoArquivo, VisualizadorDeAnexo, baixarAnexo, tamanhoLegivel } from './anexos';
import { hora, rotuloDoDia } from './mensagem';
import { TextoFormatado } from './texto-formatado';
import { cn } from '@/lib/utils';

export type Abrir = (conversationId: string, messageId?: string, threadRootId?: string | null) => void;

function Cabecalho({ icone: Icone, titulo, ajuda, children }: { icone: typeof AtSign; titulo: string; ajuda: string; children?: React.ReactNode }) {
  return (
    <header className="border-b border-grafite-elevado px-5 py-3">
      <div className="flex items-center gap-2">
        <Icone size={18} className="text-roxo-eletrico" />
        <h2 className="font-heading text-base font-semibold text-branco-cru">{titulo}</h2>
      </div>
      <p className="text-xs text-nevoa">{ajuda}</p>
      {children}
    </header>
  );
}

function Destaque({ texto, termo }: { texto: string; termo: string }) {
  if (!termo || termo.length < 2) return <>{texto}</>;
  const partes = texto.split(new RegExp(`(${termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return <>{partes.map((p, i) => (p.toLocaleLowerCase('pt-BR') === termo.toLocaleLowerCase('pt-BR') ? <mark key={i} className="rounded bg-aviso/30 px-0.5 text-branco-cru">{p}</mark> : <span key={i}>{p}</span>))}</>;
}

/** Uma mensagem num resultado (menção, salvo, busca): de onde, de quem, quando — e clique leva até ela. */
function ItemDeMensagem({ m, onOpen, termo, acao }: { m: ChatMessage; onOpen: Abrir; termo?: string; acao?: React.ReactNode }) {
  const onde = m.conversation ? (m.conversation.kind === 'general' || m.conversation.kind === 'channel' ? `#${m.conversation.title}` : m.conversation.title) : 'Conversa';
  return (
    <li className="group flex gap-3 px-5 py-3 hover:bg-grafite-elevado/30">
      <InboxAvatar name={m.sender_name ?? '?'} photoUrl={m.sender_avatar_url} />
      <button type="button" onClick={() => onOpen(m.conversation_id, m.id, m.thread_root_id)} className="min-w-0 flex-1 text-left">
        <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="font-semibold text-branco-cru">{m.sender_name ?? 'Colaborador'}</span>
          <span className="text-roxo-eletrico">{onde}{m.thread_root_id ? ' · thread' : ''}</span>
          <span className="font-mono text-nevoa">{rotuloDoDia(m.created_at)} {hora(m.created_at)}</span>
        </p>
        {termo ? (
          <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-sm text-branco-cru/90"><Destaque texto={m.content ?? ''} termo={termo} /></p>
        ) : m.content ? (
          <TextoFormatado texto={m.content.slice(0, 600)} className="mt-0.5 line-clamp-4" />
        ) : (
          <p className="mt-0.5 text-sm text-nevoa">{m.attachments.length ? `${m.attachments.length} arquivo(s)` : (m.objects?.length ? 'Item compartilhado' : '')}</p>
        )}
      </button>
      {acao}
    </li>
  );
}

function Lista({ consulta, vazio, children }: { consulta: { isPending: boolean; isError: boolean; data?: unknown[] | undefined }; vazio: string; children: React.ReactNode }) {
  if (consulta.isPending) return <p className="flex justify-center py-10 text-nevoa"><Loader2 className="animate-spin" /></p>;
  if (consulta.isError) return <p className="p-6 text-center text-sm text-erro">Não foi possível carregar.</p>;
  if (!consulta.data?.length) return <p className="p-10 text-center text-sm text-nevoa">{vazio}</p>;
  return <ul className="divide-y divide-grafite-elevado">{children}</ul>;
}

export function VisaoMencoes({ onOpen }: { onOpen: Abrir }) {
  const mencoes = useMentions(true);
  return (
    <section aria-label="Menções" className="flex h-full min-h-0 flex-col">
      <Cabecalho icone={AtSign} titulo="Menções" ajuda="Onde alguém chamou você com @, nas conversas que você lê." />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Lista consulta={mencoes} vazio="Ninguém mencionou você ainda.">{(mencoes.data ?? []).map((m) => <ItemDeMensagem key={m.id} m={m} onOpen={onOpen} />)}</Lista>
      </div>
    </section>
  );
}

function TirarDosSalvos({ m }: { m: ChatMessage }) {
  const salvar = useSaveMessage(m.conversation_id);
  return (
    <button type="button" onClick={() => salvar.mutate({ message: m, saved: false }, { onError: (e) => toast(e.message, 'error') })} aria-label="Tirar dos salvos" title="Tirar dos salvos" className="self-start text-nevoa opacity-0 hover:text-branco-cru group-hover:opacity-100"><BookmarkX size={16} /></button>
  );
}

export function VisaoSalvos({ onOpen }: { onOpen: Abrir }) {
  const salvos = useSavedMessages(true);
  return (
    <section aria-label="Salvos" className="flex h-full min-h-0 flex-col">
      <Cabecalho icone={Bookmark} titulo="Salvos" ajuda="Mensagens que você guardou para ver depois. Só você vê esta lista." />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Lista consulta={salvos} vazio="Nada salvo. Passe o mouse numa mensagem e toque no marcador para guardar.">
          {(salvos.data ?? []).map((m) => <ItemDeMensagem key={m.id} m={m} onOpen={onOpen} acao={<TirarDosSalvos m={m} />} />)}
        </Lista>
      </div>
    </section>
  );
}

const TIPOS_DE_ARQUIVO = [['', 'Todos'], ['image', 'Imagens'], ['video', 'Vídeos'], ['document', 'Documentos'], ['archive', 'ZIP']] as const;

export function VisaoArquivos({ onOpen }: { onOpen: Abrir }) {
  const [kind, setKind] = useState('');
  const [busca, setBusca] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('recentes');
  const [aberto, setAberto] = useState<ChatAttachment | null>(null);
  useEffect(() => { const t = setTimeout(() => setQ(busca.trim()), 300); return () => clearTimeout(t); }, [busca]);
  const lib = useFileLibrary({ kind, q, sort });
  const arquivos = useMemo(() => (lib.data?.pages ?? []).flatMap((p) => p.files), [lib.data]);
  return (
    <section aria-label="Arquivos compartilhados" className="flex h-full min-h-0 flex-col">
      <Cabecalho icone={FolderOpen} titulo="Arquivos" ajuda="Tudo que foi compartilhado nas conversas que você lê.">
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {TIPOS_DE_ARQUIVO.map(([k, rotulo]) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={cn('rounded-full px-2.5 py-1 text-xs font-medium', kind === k ? 'bg-roxo-eletrico text-branco-cru' : 'text-nevoa hover:bg-grafite-elevado')}>{rotulo}</button>
          ))}
          <div className="relative ml-auto"><Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-nevoa" /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome do arquivo" aria-label="Buscar arquivo pelo nome" className="w-44 rounded-md border border-grafite-elevado bg-grafite py-1 pl-7 pr-2 text-xs text-branco-cru" /></div>
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenar" className="rounded-md border border-grafite-elevado bg-grafite px-2 py-1 text-xs text-branco-cru">
            <option value="recentes">Mais recentes</option><option value="nome">Nome</option><option value="tamanho">Maiores</option>
          </select>
        </div>
      </Cabecalho>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Lista consulta={{ isPending: lib.isPending, isError: lib.isError, data: arquivos }} vazio={q || kind ? 'Nada com esse filtro.' : 'Nenhum arquivo compartilhado ainda.'}>
          {arquivos.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-5 py-2.5">
              <button type="button" onClick={() => (a.kind === 'image' || a.kind === 'video' || a.mimetype === 'application/pdf' ? setAberto(a) : void baixarAnexo(a))} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-grafite-elevado text-nevoa"><IconeDoArquivo anexo={a} /></span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-branco-cru" title={a.filename}>{a.filename}</span>
                  <span className="block truncate font-mono text-[10px] text-nevoa">
                    {a.sender_name ?? 'Colaborador'} · {a.conversation ? (a.conversation.kind === 'general' || a.conversation.kind === 'channel' ? `#${a.conversation.title}` : a.conversation.title) : ''} · {new Date(a.created_at).toLocaleDateString('pt-BR')} · {tamanhoLegivel(a.size_bytes)}
                  </span>
                </span>
              </button>
              {a.message_id && a.conversation_id && <button type="button" onClick={() => onOpen(a.conversation_id!, a.message_id!, a.thread_root_id)} className="shrink-0 text-xs text-roxo-eletrico hover:underline">Ver na conversa</button>}
              <button type="button" onClick={() => void baixarAnexo(a)} aria-label={`Baixar ${a.filename}`} className="shrink-0 text-nevoa hover:text-branco-cru"><Download size={15} /></button>
            </li>
          ))}
        </Lista>
        {lib.hasNextPage && <button type="button" onClick={() => void lib.fetchNextPage()} className="mx-auto my-3 block text-xs text-roxo-eletrico underline">Carregar mais</button>}
      </div>
      {aberto && <VisualizadorDeAnexo anexo={aberto} onClose={() => setAberto(null)} />}
    </section>
  );
}

const PERIODOS = [['', 'Qualquer data'], ['1', 'Últimas 24 h'], ['7', 'Últimos 7 dias'], ['30', 'Últimos 30 dias'], ['90', 'Últimos 90 dias']] as const;

export function VisaoBusca({ termoInicial, onOpen }: { termoInicial: string; onOpen: Abrir }) {
  const [q, setQ] = useState(termoInicial);
  const [termo, setTermo] = useState(termoInicial);
  const [remetente, setRemetente] = useState('');
  const [conversa, setConversa] = useState('');
  const [dias, setDias] = useState('');
  const [anexo, setAnexo] = useState('');
  const [objeto, setObjeto] = useState('');
  const [filtros, setFiltros] = useState(false);
  useEffect(() => setQ(termoInicial), [termoInicial]);
  useEffect(() => { const t = setTimeout(() => setTermo(q), 300); return () => clearTimeout(t); }, [q]);
  const membros = useChatMembers();
  const conversas = useChatConversations();
  const from = useMemo(() => (dias ? new Date(Date.now() - Number(dias) * 86_400_000).toISOString() : ''), [dias]);
  const f: SearchFilters = { q: termo, sender_id: remetente || undefined, conversation_id: conversa || undefined, from: from || undefined, attachment_kind: anexo || undefined, object_type: objeto || undefined };
  const busca = useChatSearch(f);
  const temAlgo = termo.trim().length >= 2 || Boolean(remetente || conversa || dias || anexo || objeto);
  const sel = 'rounded-md border border-grafite-elevado bg-grafite px-2 py-1 text-xs text-branco-cru';
  return (
    <section aria-label="Busca" className="flex h-full min-h-0 flex-col">
      <Cabecalho icone={Search} titulo="Buscar mensagens" ajuda="Só aparecem mensagens de conversas que você lê.">
        <div className="mt-2 flex gap-2">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Palavra ou frase…" aria-label="Termo da busca" className="flex-1 rounded-md border border-grafite-elevado bg-carbono/40 px-3 py-1.5 text-sm text-branco-cru" />
          <button type="button" onClick={() => setFiltros((v) => !v)} aria-expanded={filtros} className={cn('inline-flex items-center gap-1 rounded-md px-2 text-xs', filtros ? 'bg-grafite-elevado text-branco-cru' : 'text-nevoa hover:bg-grafite-elevado')}><SlidersHorizontal size={13} /> Filtros</button>
        </div>
        {filtros && (
          <div className="mt-2 flex flex-wrap gap-2">
            <select value={remetente} onChange={(e) => setRemetente(e.target.value)} aria-label="Quem enviou" className={sel}><option value="">Qualquer pessoa</option>{(membros.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
            <select value={conversa} onChange={(e) => setConversa(e.target.value)} aria-label="Onde" className={sel}><option value="">Qualquer conversa</option>{(conversas.data ?? []).map((c: ChatConversation) => <option key={c.id} value={c.id}>{c.kind === 'general' || c.kind === 'channel' ? '#' : ''}{c.title}</option>)}</select>
            <select value={dias} onChange={(e) => setDias(e.target.value)} aria-label="Período" className={sel}>{PERIODOS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}</select>
            <select value={anexo} onChange={(e) => setAnexo(e.target.value)} aria-label="Com anexo" className={sel}><option value="">Com ou sem anexo</option><option value="image">Com imagem</option><option value="video">Com vídeo</option><option value="document">Com documento</option><option value="archive">Com ZIP</option></select>
            <select value={objeto} onChange={(e) => setObjeto(e.target.value)} aria-label="Item compartilhado" className={sel}><option value="">Qualquer item</option><option value="task">Tarefa</option><option value="campaign">Campanha</option><option value="report">Relatório</option><option value="client">Cliente</option><option value="demand">Quinzena</option><option value="media_alert">Alerta de mídia</option></select>
          </div>
        )}
      </Cabecalho>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!temAlgo ? <p className="p-10 text-center text-sm text-nevoa">Digite ao menos 2 letras ou escolha um filtro.</p> : (
          <Lista consulta={busca} vazio="Nenhuma mensagem encontrada.">{(busca.data ?? []).map((m) => <ItemDeMensagem key={m.id} m={m} onOpen={onOpen} termo={termo.trim()} />)}</Lista>
        )}
      </div>
    </section>
  );
}

function NaoPerturbe() {
  const prefs = useChatPreferences();
  const ate = prefs.data?.dnd_until ? new Date(prefs.data.dnd_until) : null;
  const ativo = Boolean(ate && ate.getTime() > Date.now());
  const definir = (horas: number | null) => prefs.salvar.mutate({ dnd_until: horas === null ? null : new Date(Date.now() + horas * 3600_000).toISOString() }, { onError: (e) => toast(e.message, 'error') });
  const amanha = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); prefs.salvar.mutate({ dnd_until: d.toISOString() }); };
  return (
    <div className="rounded-lg border border-grafite-elevado p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-branco-cru"><Moon size={15} /> Não perturbe {ativo && <span className="font-mono text-[11px] text-aviso">até {ate!.toLocaleString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>}</p>
      <p className="text-xs text-nevoa">Pausa as notificações da Comunicação. As mensagens continuam chegando.</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {ativo ? <button type="button" onClick={() => definir(null)} className="rounded-md bg-grafite-elevado px-2 py-1 text-xs text-branco-cru">Desligar</button> : (
          <>
            <button type="button" onClick={() => definir(1)} className="rounded-md bg-grafite-elevado px-2 py-1 text-xs text-branco-cru">1 hora</button>
            <button type="button" onClick={() => definir(4)} className="rounded-md bg-grafite-elevado px-2 py-1 text-xs text-branco-cru">4 horas</button>
            <button type="button" onClick={amanha} className="rounded-md bg-grafite-elevado px-2 py-1 text-xs text-branco-cru">Até amanhã 8h</button>
          </>
        )}
      </div>
      <div className="mt-3 space-y-1.5 border-t border-grafite-elevado pt-2">
        <label className="flex items-center gap-2 text-xs text-branco-cru"><input type="checkbox" checked={prefs.data?.notify_reactions ?? true} onChange={(e) => prefs.salvar.mutate({ notify_reactions: e.target.checked })} /> Avisar quando reagirem às minhas mensagens</label>
        <label className="flex items-center gap-2 text-xs text-branco-cru"><input type="checkbox" checked={prefs.data?.notify_channel_messages ?? false} onChange={(e) => prefs.salvar.mutate({ notify_channel_messages: e.target.checked })} /> Avisar cada mensagem nos canais (fora o #Geral)</label>
      </div>
    </div>
  );
}

export function VisaoInicio({ conversas, onOpenConversa, onOpen, onVer }: { conversas: ChatConversation[]; onOpenConversa: (id: string) => void; onOpen: Abrir; onVer: (v: 'mencoes' | 'salvos' | 'arquivos') => void }) {
  const mencoes = useMentions(true);
  const naoLidas = conversas.filter((c) => c.unread_count > 0);
  return (
    <section aria-label="Início da Comunicação" className="flex h-full min-h-0 flex-col">
      <Cabecalho icone={Hash} titulo="Início" ajuda="O que pede sua atenção na conversa da equipe." />
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
        <div>
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-nevoa/70">Não lidas</p>
          {naoLidas.length === 0 ? <p className="text-sm text-nevoa">Tudo em dia.</p> : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {naoLidas.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => onOpenConversa(c.id)} className="flex w-full items-center gap-3 rounded-lg border border-grafite-elevado px-3 py-2 text-left hover:border-roxo-eletrico/50">
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1 truncate text-sm font-semibold text-branco-cru">{c.kind === 'general' || c.kind === 'channel' ? '#' : ''}{c.title}{c.muted && <BellOff size={11} className="text-nevoa" />}</span>
                      <span className="block truncate text-xs text-nevoa">{c.last_message?.sender_name ? `${c.last_message.sender_name}: ` : ''}{c.last_message?.content ?? 'Arquivo ou item'}</span>
                    </span>
                    <span className="rounded-full bg-sinal px-1.5 font-mono text-[10px] font-semibold leading-[18px] text-grafite">{c.unread_count}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between"><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-nevoa/70">Menções recentes</p><button type="button" onClick={() => onVer('mencoes')} className="text-xs text-roxo-eletrico hover:underline">Ver todas</button></div>
          {mencoes.isPending ? <Loader2 size={16} className="animate-spin text-nevoa" /> : (mencoes.data ?? []).length === 0 ? <p className="text-sm text-nevoa">Ninguém mencionou você ainda.</p> : (
            <ul className="divide-y divide-grafite-elevado rounded-lg border border-grafite-elevado">{(mencoes.data ?? []).slice(0, 5).map((m) => <ItemDeMensagem key={m.id} m={m} onOpen={onOpen} />)}</ul>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={() => onVer('salvos')} className="flex items-center gap-2 rounded-lg border border-grafite-elevado p-3 text-left hover:border-roxo-eletrico/50"><Bookmark size={16} className="text-roxo-eletrico" /><span><span className="block text-sm text-branco-cru">Salvos</span><span className="block text-xs text-nevoa">O que você guardou para depois</span></span></button>
          <button type="button" onClick={() => onVer('arquivos')} className="flex items-center gap-2 rounded-lg border border-grafite-elevado p-3 text-left hover:border-roxo-eletrico/50"><FolderOpen size={16} className="text-roxo-eletrico" /><span><span className="block text-sm text-branco-cru">Arquivos</span><span className="block text-xs text-nevoa">Tudo que a equipe compartilhou</span></span></button>
        </div>
        <NaoPerturbe />
      </div>
    </section>
  );
}

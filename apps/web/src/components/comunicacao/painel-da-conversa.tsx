'use client';

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, ArrowDown, ArrowLeft, Bell, BellOff, Bot, Building2, ClipboardList, FolderOpen, Hash, Loader2, Lock, Pin, Users } from 'lucide-react';
import {
  flattenMessages,
  setOpenConversation,
  useAskAgent,
  useChatMessages,
  useConversationDetail,
  useMarkChatRead,
  useMuteChat,
  usePins,
  useTypingUsers,
  type ChatConversation,
  type ChatMember,
  type ChatMessage,
} from '@/hooks/use-internal-chat';
import { InboxAvatar } from '@/components/inbox/inbox-avatar';
import { toast } from '@/stores/toast-store';
import { Composer, type ComposerHandle } from './composer';
import { Mensagem, rotuloDoDia } from './mensagem';
import { TextoFormatado } from './texto-formatado';
import { useAcoesDeMensagem } from './use-acoes';
import { cn } from '@/lib/utils';

const JANELA_DE_AGRUPAMENTO_MS = 5 * 60_000;

export type PainelLateral = { tipo: 'arquivos' } | { tipo: 'detalhes' } | { tipo: 'thread'; rootId: string } | null;

export function tituloDaConversa(c: Pick<ChatConversation, 'kind' | 'title'>) {
  if (c.kind === 'general') return '# Geral';
  if (c.kind === 'channel') return `# ${c.title}`;
  return c.title;
}

export function IconeDaConversa({ c, tamanho = 'md' }: { c: Pick<ChatConversation, 'kind' | 'title' | 'visibility' | 'partner' | 'entity'>; tamanho?: 'sm' | 'md' }) {
  const caixa = tamanho === 'sm' ? 'size-7' : 'size-9';
  const icone = tamanho === 'sm' ? 14 : 18;
  if (c.kind === 'general' || c.kind === 'channel') {
    const Icone = c.visibility === 'private' ? Lock : Hash;
    return <span className={cn('flex shrink-0 items-center justify-center rounded-md bg-roxo-eletrico/20 text-roxo-eletrico', caixa)}><Icone size={icone} /></span>;
  }
  if (c.kind === 'group') return <span className={cn('flex shrink-0 items-center justify-center rounded-full bg-grafite-elevado text-nevoa', caixa)}><Users size={icone} /></span>;
  if (c.kind === 'discussion') {
    const Icone = c.entity?.type === 'demand' ? ClipboardList : Building2;
    return <span className={cn('flex shrink-0 items-center justify-center rounded-md bg-sinal/15 text-sinal', caixa)}><Icone size={icone} /></span>;
  }
  return (
    <span className="relative shrink-0">
      <InboxAvatar name={c.title} photoUrl={c.partner?.avatar_url} size={tamanho} />
      {c.partner?.online && <span className="absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-grafite bg-sinal" />}
    </span>
  );
}

export function PainelDaConversa({ conversa, me, membros, focoMensagemId, painel, onPainel, onBack }: {
  conversa: ChatConversation;
  me: { id: string; name: string | null };
  membros: ChatMember[];
  focoMensagemId: string | null;
  painel: PainelLateral;
  onPainel: (p: PainelLateral) => void;
  onBack: () => void;
}) {
  const router = useRouter();
  const consulta = useChatMessages(conversa.id);
  const detalhe = useConversationDetail(conversa.id);
  const mensagens = useMemo(() => flattenMessages(consulta.data), [consulta.data]);
  const marcarLida = useMarkChatRead();
  const silenciar = useMuteChat();
  const agente = useAskAgent();
  const digitando = useTypingUsers(conversa.id);
  const [respondendo, setRespondendo] = useState<ChatMessage | null>(null);
  const [destaque, setDestaque] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [longeDoFim, setLongeDoFim] = useState(false);
  const [vendoFixadas, setVendoFixadas] = useState(false);
  const fixadas = usePins(conversa.id, vendoFixadas);
  const rolagem = useRef<HTMLDivElement>(null);
  const composer = useRef<ComposerHandle>(null);
  const alturaAntes = useRef<number | null>(null);
  const colarNoFim = useRef(true);
  const mapaDeMembros = useMemo(() => new Map(membros.map((m) => [m.id, m])), [membros]);
  const arquivada = Boolean(detalhe.data?.archived);
  const podeEscrever = !arquivada;

  useEffect(() => {
    setOpenConversation(conversa.id);
    setRespondendo(null);
    setVendoFixadas(false);
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
    if (!alvo) { toast('Essa mensagem não está na linha principal (pode estar numa thread) ou não existe mais.', 'info'); return; }
    colarNoFim.current = false;
    alvo.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setDestaque(id);
    setTimeout(() => setDestaque((d) => (d === id ? null : d)), 2500);
  }, [consulta]);

  useEffect(() => {
    if (focoMensagemId && consulta.isSuccess) void irPara(focoMensagemId);
  }, [focoMensagemId, consulta.isSuccess, conversa.id]);

  const { acoes, enviar, modais } = useAcoesDeMensagem(conversa.id, me, {
    onReply: (m) => { setRespondendo(m); composer.current?.focus(); },
    onThread: (m) => onPainel({ tipo: 'thread', rootId: m.id }),
    onJump: (id) => void irPara(id),
    aoEnviar: () => { colarNoFim.current = true; },
  });

  function aoEnviar(input: Parameters<typeof enviar.mutate>[0]) {
    colarNoFim.current = true;
    enviar.mutate(input, { onError: (e) => { if (/arquivad/i.test(e.message)) toast(e.message, 'error'); } });
    setRespondendo(null);
  }

  async function resumirConversa() {
    try {
      const r = await agente.mutateAsync({ action: 'summarize_conversation', conversation_id: conversa.id });
      router.push(`/chat?conversation=${r.conversation_id}&agent=${r.agent}`);
    } catch (e) { toast(e instanceof Error ? e.message : 'O agente não está disponível agora.', 'error'); }
  }

  // "Visto por" na última mensagem minha, em privada e grupo.
  const ultimaMinha = useMemo(() => [...mensagens].reverse().find((m) => m.sender_id === me.id && m.kind !== 'system' && !m.local_status), [mensagens, me.id]);
  const visto = useMemo(() => {
    if (!ultimaMinha || (conversa.kind !== 'direct' && conversa.kind !== 'group')) return null;
    const quem = (detalhe.data?.members ?? []).filter((p) => p.id !== me.id && p.last_read_at && p.last_read_at >= ultimaMinha.created_at);
    if (quem.length === 0) return null;
    if (conversa.kind === 'direct') return 'Visto';
    return `Visto por ${quem.slice(0, 3).map((p) => p.name.split(' ')[0]).join(', ')}${quem.length > 3 ? ` +${quem.length - 3}` : ''}`;
  }, [ultimaMinha, detalhe.data, me.id, conversa.kind]);

  const subtitulo = conversa.kind === 'general' ? `Toda a equipe · ${membros.length} pessoas`
    : conversa.kind === 'channel' ? `${conversa.visibility === 'private' ? 'Canal privado' : 'Canal público'} · ${detalhe.data?.members.length ?? conversa.member_count ?? '…'} pessoas`
      : conversa.kind === 'group' ? `Grupo privado · ${detalhe.data?.members.length ?? conversa.member_count ?? '…'} pessoas`
        : conversa.kind === 'discussion' ? `Discussão ${conversa.entity?.type === 'demand' ? 'da quinzena' : 'do cliente'}`
          : conversa.partner?.online ? 'Online' : 'Conversa privada';
  const nome = tituloDaConversa(conversa);
  const inicio = conversa.kind === 'general' ? { t: 'Início do #Geral', d: 'Todo mundo da equipe lê e escreve aqui.' }
    : conversa.kind === 'channel' ? { t: `Início de #${conversa.title}`, d: conversa.description || (conversa.visibility === 'private' ? 'Só quem foi convidado lê este canal.' : 'Qualquer pessoa da equipe encontra e entra neste canal.') }
      : conversa.kind === 'group' ? { t: `Início do grupo ${conversa.title}`, d: 'Só os participantes veem estas mensagens.' }
        : conversa.kind === 'discussion' ? { t: `Discussão: ${conversa.title}`, d: 'Decisões e combinados sobre este item. Quem pode ver o item participa.' }
          : { t: `Início da conversa com ${conversa.title}`, d: 'Só vocês dois veem estas mensagens.' };
  const totalFixadas = detalhe.data?.pinned_count ?? 0;

  const botao = 'flex size-8 items-center justify-center rounded-md text-nevoa hover:bg-grafite-elevado hover:text-branco-cru';

  return (
    <section
      aria-label={`Conversa ${nome}`}
      className="relative flex h-full min-h-0 flex-col"
      onDragOver={(e) => { if (podeEscrever && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setArrastando(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setArrastando(false); }}
      onDrop={(e) => { e.preventDefault(); setArrastando(false); if (e.dataTransfer.files.length) composer.current?.addFiles(e.dataTransfer.files); }}
    >
      <header className="flex items-center gap-3 border-b border-grafite-elevado px-4 py-2.5">
        <button type="button" onClick={onBack} aria-label="Voltar para conversas" className="text-nevoa hover:text-branco-cru lg:hidden"><ArrowLeft size={18} /></button>
        <IconeDaConversa c={conversa} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-heading text-sm font-semibold text-branco-cru">{nome}</h2>
          <p className="truncate font-mono text-[11px] text-nevoa">{subtitulo}{conversa.kind === 'channel' && conversa.description ? ` · ${conversa.description}` : ''}</p>
        </div>
        {totalFixadas > 0 && (
          <button type="button" onClick={() => setVendoFixadas((v) => !v)} aria-expanded={vendoFixadas} aria-label={`${totalFixadas} mensagens fixadas`} title="Mensagens fixadas" className={cn(botao, 'w-auto gap-1 px-2 font-mono text-[11px]', vendoFixadas && 'bg-grafite-elevado text-branco-cru')}>
            <Pin size={14} /> {totalFixadas}
          </button>
        )}
        <button type="button" onClick={() => void resumirConversa()} disabled={agente.isPending || mensagens.length === 0} aria-label="Resumir com Bento" title="Pedir ao Bento um resumo desta conversa (só você vê a resposta)" className={cn(botao, 'disabled:opacity-40')}><Bot size={16} /></button>
        <button type="button" onClick={() => silenciar.mutate({ conversationId: conversa.id, muted: !conversa.muted })} aria-label={conversa.muted ? 'Reativar notificações' : 'Silenciar conversa'} title={conversa.muted ? 'Reativar notificações' : 'Silenciar conversa'} className={botao}>
          {conversa.muted ? <BellOff size={16} /> : <Bell size={16} />}
        </button>
        <button type="button" onClick={() => onPainel(painel?.tipo === 'arquivos' ? null : { tipo: 'arquivos' })} aria-label="Arquivos da conversa" title="Arquivos da conversa" className={cn(botao, painel?.tipo === 'arquivos' && 'bg-grafite-elevado text-branco-cru')}><FolderOpen size={16} /></button>
        {conversa.kind !== 'general' && (
          <button type="button" onClick={() => onPainel(painel?.tipo === 'detalhes' ? null : { tipo: 'detalhes' })} aria-label="Detalhes e participantes" title="Detalhes e participantes" className={cn(botao, painel?.tipo === 'detalhes' && 'bg-grafite-elevado text-branco-cru')}><Users size={16} /></button>
        )}
      </header>

      {vendoFixadas && (
        <div className="max-h-56 overflow-y-auto border-b border-grafite-elevado bg-grafite-elevado/30 px-4 py-2" aria-label="Mensagens fixadas">
          {fixadas.isPending && <Loader2 size={14} className="animate-spin text-nevoa" />}
          {(fixadas.data ?? []).map((m) => (
            <button key={m.id} type="button" onClick={() => { setVendoFixadas(false); void irPara(m.id); }} className="block w-full rounded px-2 py-1 text-left hover:bg-grafite-elevado/60">
              <span className="font-mono text-[10px] text-aviso">{m.sender_name} · {rotuloDoDia(m.created_at)}</span>
              <TextoFormatado texto={(m.content ?? 'Mensagem com anexo').slice(0, 220)} className="line-clamp-2 text-xs" />
            </button>
          ))}
        </div>
      )}

      {arquivada && (
        <p className="flex items-center gap-2 border-b border-grafite-elevado bg-aviso/10 px-4 py-1.5 text-xs text-aviso"><Archive size={13} /> Canal arquivado: o histórico continua aqui, mas não dá para escrever.</p>
      )}

      <div ref={rolagem} onScroll={aoRolar} className="min-h-0 flex-1 overflow-y-auto py-3" role="log" aria-live="polite" aria-label="Mensagens">
        {consulta.isFetchingNextPage && <p className="flex justify-center py-2 text-nevoa"><Loader2 size={16} className="animate-spin" /></p>}
        {!consulta.hasNextPage && consulta.isSuccess && (
          <div className="px-4 pb-4 pt-6">
            <p className="font-heading text-base font-semibold text-branco-cru">{inicio.t}</p>
            <p className="text-sm text-nevoa">{inicio.d}</p>
          </div>
        )}
        {consulta.isPending && (
          <div className="space-y-4 px-4 py-6" aria-label="Carregando mensagens">
            {[0, 1, 2].map((i) => <div key={i} className="flex gap-3"><span className="size-9 animate-pulse rounded-full bg-grafite-elevado" /><span className="flex-1 space-y-2"><span className="block h-3 w-32 animate-pulse rounded bg-grafite-elevado" /><span className="block h-3 w-3/4 animate-pulse rounded bg-grafite-elevado/70" /></span></div>)}
          </div>
        )}
        {consulta.isError && (
          <div className="px-4 py-10 text-center text-sm text-erro">
            Não foi possível carregar as mensagens. <button type="button" onClick={() => void consulta.refetch()} className="underline">Tentar de novo</button>
          </div>
        )}
        {mensagens.map((m, i) => {
          const anterior = mensagens[i - 1];
          const novoDia = !anterior || new Date(anterior.created_at).toDateString() !== new Date(m.created_at).toDateString();
          const agrupada = !novoDia && Boolean(anterior) && anterior!.kind !== 'system' && m.kind !== 'system' && anterior!.sender_id === m.sender_id && !m.reply_to && !(anterior!.reply_count) && new Date(m.created_at).getTime() - new Date(anterior!.created_at).getTime() < JANELA_DE_AGRUPAMENTO_MS;
          return (
            <Fragment key={m.client_message_id + m.sender_id}>
              {novoDia && (
                <div className="my-3 flex items-center gap-3 px-4" role="separator">
                  <span className="h-px flex-1 bg-grafite-elevado" />
                  <span className="font-mono text-[11px] text-nevoa">{rotuloDoDia(m.created_at)}</span>
                  <span className="h-px flex-1 bg-grafite-elevado" />
                </div>
              )}
              <Mensagem m={m} agrupada={agrupada} me={me} membros={mapaDeMembros} destacada={destaque === m.id} podeEscrever={podeEscrever} acoes={acoes} visto={m === ultimaMinha ? visto : null} />
            </Fragment>
          );
        })}
      </div>

      {longeDoFim && (
        <button type="button" onClick={() => { const el = rolagem.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); }} aria-label="Ir para as mensagens mais recentes" className="absolute bottom-32 right-6 flex size-9 items-center justify-center rounded-full border border-grafite-elevado bg-grafite text-nevoa shadow-lg hover:text-branco-cru">
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
        placeholder={conversa.kind === 'general' ? 'Mensagem para #Geral' : conversa.kind === 'channel' ? `Mensagem para #${conversa.title}` : `Mensagem para ${conversa.title}`}
        readOnly={arquivada ? 'Este canal está arquivado: só leitura.' : null}
      />

      {arrastando && (
        <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-lg border-2 border-dashed border-roxo-eletrico bg-carbono/80">
          <p className="font-heading text-sm text-branco-cru">Solte para anexar</p>
        </div>
      )}
      {modais}
    </section>
  );
}

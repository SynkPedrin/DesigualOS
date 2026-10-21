'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Hash, Lock, MessagesSquare } from 'lucide-react';
import { useChatConversations, useChatMembers, useConversationActions, useConversationDetail, type ChatConversation } from '@/hooks/use-internal-chat';
import { useMe } from '@/hooks/use-me';
import { ListaDeConversas, type Visao } from '@/components/comunicacao/lista-de-conversas';
import { PainelDaConversa, type PainelLateral } from '@/components/comunicacao/painel-da-conversa';
import { PainelDaThread } from '@/components/comunicacao/painel-da-thread';
import { PainelDeArquivos } from '@/components/comunicacao/painel-de-arquivos';
import { PainelDeDetalhes } from '@/components/comunicacao/painel-de-detalhes';
import { CriarCanal, CriarGrupo, ProcurarCanais } from '@/components/comunicacao/modais';
import { VisaoArquivos, VisaoBusca, VisaoInicio, VisaoMencoes, VisaoSalvos } from '@/components/comunicacao/visoes';
import { Toaster } from '@/components/ui/toaster';
import { toast } from '@/stores/toast-store';
import { cn } from '@/lib/utils';

/**
 * COMUNICAÇÃO — a conversa interna da equipe: #Geral, canais, privadas, grupos
 * e discussões de cliente/quinzena. Separada da Inbox de propósito: ali é
 * cliente no WhatsApp; aqui é colega com colega.
 *
 * Tudo que define o que está aberto mora na URL, para o link da notificação
 * (e o "ver na conversa") abrir exatamente o lugar certo:
 *   ?c=<conversa>  ?m=<mensagem a destacar>  ?t=<raiz da thread>  ?v=<visão>  ?q=<busca>
 */

const VISOES: Visao[] = ['inicio', 'mencoes', 'salvos', 'arquivos', 'busca'];

function ConversaForaDaLista({ id, me, membros, painel, onPainel, onBack, foco }: { id: string; me: { id: string; name: string | null }; membros: ReturnType<typeof useChatMembers>['data']; painel: PainelLateral; onPainel: (p: PainelLateral) => void; onBack: () => void; foco: string | null }) {
  // Canal público ainda não aberto, ou discussão aberta por link: a lista não
  // tem a linha (só mostra o que a pessoa participa), mas ela pode ler.
  const detalhe = useConversationDetail(id);
  const acoes = useConversationActions(id);
  if (detalhe.isPending) return <div className="flex h-full items-center justify-center text-sm text-nevoa">Abrindo…</div>;
  if (detalhe.isError || !detalhe.data) return <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center"><MessagesSquare className="text-nevoa" /><p className="text-sm text-nevoa">Essa conversa não existe ou você não participa dela.</p></div>;
  const d = detalhe.data;
  const conversa: ChatConversation = {
    id: d.id, kind: d.kind, title: d.kind === 'general' ? 'Geral' : d.title ?? 'Conversa', description: d.description, visibility: d.visibility,
    entity: d.entity, member_count: d.members.length, partner: null, last_message: null, unread_count: 0, muted: false,
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      {d.kind === 'channel' && !d.is_member && !d.archived && (
        <div className="flex items-center justify-between gap-3 border-b border-grafite-elevado bg-roxo-eletrico/10 px-4 py-2 text-xs text-branco-cru">
          <span className="flex items-center gap-1.5">{d.visibility === 'private' ? <Lock size={13} /> : <Hash size={13} />} Você está vendo #{d.title}. Entre para aparecer na sua lista e receber as mensagens.</span>
          <button type="button" onClick={() => acoes.join.mutate(undefined, { onError: (e) => toast(e.message, 'error') })} className="rounded-md bg-roxo-eletrico px-2.5 py-1 font-medium">Entrar no canal</button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <PainelDaConversa key={d.id} conversa={conversa} me={me} membros={membros ?? []} focoMensagemId={foco} painel={painel} onPainel={onPainel} onBack={onBack} />
      </div>
    </div>
  );
}

function ComunicacaoConteudo() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: me } = useMe();
  const conversas = useChatConversations();
  const membros = useChatMembers();
  const [criandoCanal, setCriandoCanal] = useState(false);
  const [criandoGrupo, setCriandoGrupo] = useState(false);
  const [procurando, setProcurando] = useState(false);
  const [painelLocal, setPainelLocal] = useState<PainelLateral>(null);

  const lista = useMemo(() => conversas.data ?? [], [conversas.data]);
  const pedida = params.get('c');
  const visaoNaUrl = params.get('v') as Visao | null;
  const visao: Visao | null = !pedida && visaoNaUrl && VISOES.includes(visaoNaUrl) ? visaoNaUrl : null;
  const threadNaUrl = params.get('t');
  const foco = params.get('m');
  const exibida = lista.find((c) => c.id === pedida) ?? null;
  const painel: PainelLateral = threadNaUrl ? { tipo: 'thread', rootId: threadNaUrl } : painelLocal;

  const irPara = useCallback((query: Record<string, string | null | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v) p.set(k, v);
    router.push(`/comunicacao${p.size ? `?${p}` : ''}`, { scroll: false });
  }, [router]);

  // Sem nada na URL (desktop): abre o #Geral, que sempre existe.
  useEffect(() => {
    if (!pedida && !visaoNaUrl && !params.get('lista') && lista.length > 0 && typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches) {
      const geral = lista.find((c) => c.kind === 'general');
      if (geral) router.replace(`/comunicacao?c=${geral.id}`, { scroll: false });
    }
  }, [pedida, visaoNaUrl, lista, router, params]);
  // Trocou de conversa: o painel lateral (arquivos/detalhes) fecha.
  useEffect(() => { setPainelLocal(null); }, [pedida]);

  const abrir = useCallback((conversationId: string, messageId?: string, threadRootId?: string | null) => {
    irPara({ c: conversationId, m: threadRootId ? threadRootId : messageId, t: threadRootId ?? undefined });
  }, [irPara]);

  const mudarPainel = (p: PainelLateral) => {
    if (p?.tipo === 'thread') { irPara({ c: pedida, t: p.rootId }); return; }
    if (threadNaUrl) irPara({ c: pedida });
    setPainelLocal(p);
  };

  const meuPerfil = me ? { id: me.id, name: me.name } : null;
  const temPainel = Boolean(pedida && painel);

  let principal: React.ReactNode;
  if (visao === 'inicio') principal = <VisaoInicio conversas={lista} onOpenConversa={(id) => abrir(id)} onOpen={abrir} onVer={(v) => irPara({ v })} />;
  else if (visao === 'mencoes') principal = <VisaoMencoes onOpen={abrir} />;
  else if (visao === 'salvos') principal = <VisaoSalvos onOpen={abrir} />;
  else if (visao === 'arquivos') principal = <VisaoArquivos onOpen={abrir} />;
  else if (visao === 'busca') principal = <VisaoBusca termoInicial={params.get('q') ?? ''} onOpen={abrir} />;
  else if (pedida && meuPerfil) {
    principal = exibida
      ? <PainelDaConversa key={exibida.id} conversa={exibida} me={meuPerfil} membros={membros.data ?? []} focoMensagemId={foco} painel={painel} onPainel={mudarPainel} onBack={() => router.push('/comunicacao?lista=1', { scroll: false })} />
      : conversas.isSuccess
        ? <ConversaForaDaLista id={pedida} me={meuPerfil} membros={membros.data} painel={painel} onPainel={mudarPainel} onBack={() => router.push('/comunicacao?lista=1', { scroll: false })} foco={foco} />
        : <div className="flex h-full items-center justify-center text-sm text-nevoa">Carregando…</div>;
  } else {
    principal = <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center"><MessagesSquare className="text-nevoa" /><p className="text-sm text-nevoa">Escolha uma conversa.</p></div>;
  }

  const mostraPrincipal = Boolean(pedida || visao);

  return (
    <div className="-mx-6 -mb-6 flex h-[calc(100%+1.5rem)] min-h-0 flex-col pt-2">
      <div className={cn('grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-lg border border-grafite-elevado lg:grid-cols-[280px_minmax(0,1fr)]', temPainel && 'xl:grid-cols-[280px_minmax(0,1fr)_380px]')}>
        <div className={cn('min-h-0 flex-col border-r border-grafite-elevado', mostraPrincipal ? 'hidden lg:flex' : 'flex')}>
          <ListaDeConversas
            conversas={lista}
            carregando={conversas.isPending}
            erro={conversas.isError}
            ativaId={exibida?.id ?? pedida}
            visao={visao}
            meId={me?.id ?? ''}
            onSelect={(id) => abrir(id)}
            onVisao={(v) => irPara({ v })}
            onSearch={(q) => irPara({ v: 'busca', q })}
            onCriarCanal={() => setCriandoCanal(true)}
            onCriarGrupo={() => setCriandoGrupo(true)}
            onProcurarCanais={() => setProcurando(true)}
          />
        </div>
        <div className={cn('min-h-0 min-w-0 flex-col', mostraPrincipal ? 'flex' : 'hidden lg:flex')}>
          {/* No celular a lista some quando uma visão está aberta: sem isto não havia como voltar. */}
          {visao && (
            <button type="button" onClick={() => router.push('/comunicacao?lista=1', { scroll: false })} className="flex items-center gap-1.5 border-b border-grafite-elevado px-4 py-2 text-left text-sm text-nevoa hover:text-branco-cru lg:hidden">
              <ArrowLeft size={15} /> Conversas
            </button>
          )}
          <div className="min-h-0 flex-1">{principal}</div>
        </div>
        {temPainel && pedida && meuPerfil && (
          <div className="fixed inset-0 z-40 bg-grafite xl:static xl:z-auto xl:min-h-0 xl:border-l xl:border-grafite-elevado">
            {painel?.tipo === 'thread' && (
              <PainelDaThread key={painel.rootId} conversationId={pedida} rootId={painel.rootId} me={meuPerfil} membros={membros.data ?? []} podeEscrever onClose={() => irPara({ c: pedida })} onJump={(m) => irPara({ c: pedida, m })} />
            )}
            {painel?.tipo === 'arquivos' && (
              <PainelDeArquivos conversationId={pedida} onClose={() => setPainelLocal(null)} onJump={(m, t) => { if (!window.matchMedia('(min-width: 1280px)').matches) setPainelLocal(null); abrir(pedida, m, t); }} />
            )}
            {painel?.tipo === 'detalhes' && (exibida ?? lista.find((c) => c.id === pedida)) && (
              <PainelDeDetalhes conversa={(exibida ?? lista.find((c) => c.id === pedida))!} meId={meuPerfil.id} onClose={() => setPainelLocal(null)} onLeft={() => { setPainelLocal(null); router.push('/comunicacao?v=inicio', { scroll: false }); }} />
            )}
          </div>
        )}
      </div>
      {criandoCanal && <CriarCanal onClose={() => setCriandoCanal(false)} onCreated={(id) => abrir(id)} />}
      {criandoGrupo && <CriarGrupo onClose={() => setCriandoGrupo(false)} onCreated={(id) => abrir(id)} />}
      {procurando && <ProcurarCanais onClose={() => setProcurando(false)} onOpen={(id) => abrir(id)} onCreate={() => setCriandoCanal(true)} />}
      <Toaster />
    </div>
  );
}

export default function ComunicacaoPage() {
  return (
    <Suspense fallback={null}>
      <ComunicacaoConteudo />
    </Suspense>
  );
}

'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MessagesSquare } from 'lucide-react';
import { useChatConversations, useChatMembers } from '@/hooks/use-internal-chat';
import { useMe } from '@/hooks/use-me';
import { ListaDeConversas } from '@/components/comunicacao/lista-de-conversas';
import { PainelDaConversa } from '@/components/comunicacao/painel-da-conversa';
import { PainelDeArquivos } from '@/components/comunicacao/painel-de-arquivos';
import { Toaster } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';

/**
 * COMUNICAÇÃO — conversa interna da equipe (#Geral + privadas). Separada da
 * Inbox de propósito: ali é cliente no WhatsApp; aqui é colega com colega.
 *
 * A conversa aberta mora na URL (?c=), e a mensagem a destacar em ?m= — é o
 * link que a notificação do sino abre.
 */
function ComunicacaoConteudo() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: me } = useMe();
  const conversas = useChatConversations();
  const membros = useChatMembers();
  const [arquivosAbertos, setArquivosAbertos] = useState(false);
  const [foco, setFoco] = useState<string | null>(params.get('m'));

  const lista = conversas.data ?? [];
  const pedida = params.get('c');
  const exibida = lista.find((c) => c.id === pedida) ?? null;

  useEffect(() => { setFoco(params.get('m')); }, [params]);
  // Sem conversa na URL (desktop): abre o #Geral, que sempre existe.
  useEffect(() => {
    if (!pedida && lista.length > 0 && typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches) {
      const geral = lista.find((c) => c.kind === 'general');
      if (geral) router.replace(`/comunicacao?c=${geral.id}`, { scroll: false });
    }
  }, [pedida, lista, router]);

  function abrir(id: string, mensagem?: string) {
    router.push(`/comunicacao?c=${id}${mensagem ? `&m=${mensagem}` : ''}`, { scroll: false });
  }

  return (
    <div className="-mx-6 -mb-6 flex h-[calc(100%+1.5rem)] min-h-0 flex-col pt-2">
      <div className={cn('grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-lg border border-grafite-elevado lg:grid-cols-[300px_minmax(0,1fr)]', arquivosAbertos && exibida && 'xl:grid-cols-[300px_minmax(0,1fr)_340px]')}>
        <div className={cn('min-h-0 flex-col border-r border-grafite-elevado', exibida ? 'hidden lg:flex' : 'flex')}>
          <ListaDeConversas
            conversas={lista}
            carregando={conversas.isPending}
            erro={conversas.isError}
            ativaId={exibida?.id ?? null}
            meId={me?.id ?? ''}
            onSelect={(id) => abrir(id)}
            onPickSearch={(c, m) => abrir(c, m)}
          />
        </div>
        <div className={cn('min-h-0 min-w-0', exibida ? 'block' : 'hidden lg:block')}>
          {exibida && me ? (
            <PainelDaConversa
              key={exibida.id}
              conversa={exibida}
              me={{ id: me.id, name: me.name }}
              membros={membros.data ?? []}
              focoMensagemId={foco}
              onBack={() => router.push('/comunicacao', { scroll: false })}
              onOpenFiles={() => setArquivosAbertos((v) => !v)}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
              <MessagesSquare className="text-nevoa" />
              <p className="text-sm text-nevoa">{pedida && conversas.isSuccess ? 'Essa conversa não existe ou você não participa dela.' : 'Escolha uma conversa.'}</p>
            </div>
          )}
        </div>
        {arquivosAbertos && exibida && (
          <div className="fixed inset-0 z-40 bg-grafite xl:static xl:z-auto xl:min-h-0 xl:border-l xl:border-grafite-elevado">
            <PainelDeArquivos conversationId={exibida.id} onClose={() => setArquivosAbertos(false)} onJump={(m) => { setFoco(null); requestAnimationFrame(() => setFoco(m)); if (!window.matchMedia('(min-width: 1280px)').matches) setArquivosAbertos(false); }} />
          </div>
        )}
      </div>
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

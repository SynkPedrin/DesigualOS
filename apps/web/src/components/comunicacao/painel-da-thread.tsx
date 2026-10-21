'use client';

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Bot, Loader2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { flattenMessages, useAskAgent, useThread, useTypingUsers, type ChatMember, type ChatMessage } from '@/hooks/use-internal-chat';
import { toast } from '@/stores/toast-store';
import { Composer, type ComposerHandle } from './composer';
import { Mensagem } from './mensagem';
import { useAcoesDeMensagem } from './use-acoes';

/**
 * THREAD — a mensagem original e as respostas, ao lado da conversa. Responder
 * aqui não mexe na linha principal: a discussão longa não desorganiza o canal.
 */
export function PainelDaThread({ conversationId, rootId, me, membros, podeEscrever, onClose, onJump }: {
  conversationId: string;
  rootId: string;
  me: { id: string; name: string | null };
  membros: ChatMember[];
  podeEscrever: boolean;
  onClose: () => void;
  onJump: (id: string) => void;
}) {
  const router = useRouter();
  const consulta = useThread(conversationId, rootId);
  const raiz: ChatMessage | undefined = consulta.data?.pages[0]?.root;
  const respostas = useMemo(() => flattenMessages(consulta.data), [consulta.data]);
  const digitando = useTypingUsers(conversationId, rootId);
  const mapa = useMemo(() => new Map(membros.map((m) => [m.id, m])), [membros]);
  const composer = useRef<ComposerHandle>(null);
  const rolagem = useRef<HTMLDivElement>(null);
  const agente = useAskAgent();
  const { acoes, enviar, modais } = useAcoesDeMensagem(conversationId, me, { onJump });

  useEffect(() => { composer.current?.focus(); }, [rootId]);
  useLayoutEffect(() => { const el = rolagem.current; if (el) el.scrollTop = el.scrollHeight; }, [respostas.length]);

  async function resumir() {
    try {
      const r = await agente.mutateAsync({ action: 'summarize_conversation', conversation_id: conversationId, thread_root_id: rootId });
      router.push(`/chat?conversation=${r.conversation_id}&agent=${r.agent}`);
    } catch (e) { toast(e instanceof Error ? e.message : 'O agente não está disponível agora.', 'error'); }
  }

  return (
    <aside aria-label="Thread" className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-grafite-elevado px-4 py-2.5">
        <h2 className="font-heading text-sm font-semibold text-branco-cru">Thread</h2>
        <div className="flex items-center gap-1">
          {respostas.length > 0 && <button type="button" onClick={() => void resumir()} disabled={agente.isPending} title="Pedir ao Bento um resumo desta thread (só você vê a resposta)" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-roxo-eletrico hover:bg-roxo-eletrico/10 disabled:opacity-50"><Bot size={12} /> Resumir</button>}
          <button type="button" onClick={onClose} aria-label="Fechar thread" className="text-nevoa hover:text-branco-cru"><X size={16} /></button>
        </div>
      </div>
      <div ref={rolagem} className="min-h-0 flex-1 overflow-y-auto py-3" role="log" aria-label="Respostas da thread">
        {consulta.isPending && <p className="flex justify-center py-8 text-nevoa"><Loader2 className="animate-spin" /></p>}
        {consulta.isError && <p className="px-4 py-6 text-center text-sm text-erro">Não foi possível abrir a thread.</p>}
        {raiz && <Mensagem m={raiz} agrupada={false} me={me} membros={mapa} destacada={false} podeEscrever={podeEscrever} acoes={{ ...acoes, onThread: undefined }} />}
        {raiz && (
          <div className="my-2 flex items-center gap-3 px-4">
            <span className="font-mono text-[11px] text-nevoa">{respostas.length} {respostas.length === 1 ? 'resposta' : 'respostas'}</span>
            <span className="h-px flex-1 bg-grafite-elevado" />
          </div>
        )}
        {consulta.hasNextPage && <button type="button" onClick={() => void consulta.fetchNextPage()} className="mx-4 mb-2 text-xs text-roxo-eletrico underline">Ver respostas anteriores</button>}
        {respostas.map((m, i) => {
          const anterior = respostas[i - 1];
          const agrupada = Boolean(anterior) && anterior!.sender_id === m.sender_id && new Date(m.created_at).getTime() - new Date(anterior!.created_at).getTime() < 5 * 60_000;
          return <Mensagem key={m.client_message_id + m.sender_id} m={m} agrupada={agrupada} me={me} membros={mapa} destacada={false} podeEscrever={podeEscrever} acoes={{ ...acoes, onPin: undefined }} />;
        })}
      </div>
      <p className="h-5 px-4 font-mono text-[11px] text-nevoa" aria-live="polite">{digitando.length ? `${digitando.slice(0, 2).join(' e ')} ${digitando.length === 1 ? 'está' : 'estão'} digitando…` : ''}</p>
      <Composer
        ref={composer}
        conversationId={conversationId}
        threadRootId={rootId}
        members={membros}
        replyTo={null}
        onCancelReply={() => undefined}
        onSend={(input) => enviar.mutate(input)}
        placeholder="Responder na thread…"
        readOnly={podeEscrever ? null : 'Este canal está arquivado: só leitura.'}
        compacto
      />
      {modais}
    </aside>
  );
}

'use client';

import { useState } from 'react';
import { ArrowUp, FileText, MessageCircle, Mic, MoreHorizontal, Paperclip, Phone, Search, Smile, Video } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { EntityAvatar } from '@/components/ui/entity-avatar';
import { useInboxMessages, useInboxThread, useSendInboxMessage } from '@/hooks/use-inbox';
import { ApiRequestError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

const EXTENSOES_DE_IMAGEM = /\.(jpe?g|png|gif|webp|avif)(\?.*)?$/i;
const EXTENSOES_DE_AUDIO = /\.(ogg|mp3|m4a|wav|opus|aac)(\?.*)?$/i;

/**
 * Bolha de anexo — `attachmentUrl` já existia no contrato e nunca era lida.
 * Distinção imagem/áudio/arquivo é HEURÍSTICA por extensão da URL (o contrato
 * não guarda mime-type); documentado aqui, não fingido como campo real.
 */
function BolhaDeAnexo({ url }: { url: string }) {
  if (EXTENSOES_DE_IMAGEM.test(url)) {
    return <img src={url} alt="Anexo" className="max-h-64 max-w-full rounded-md object-cover" />;
  }
  if (EXTENSOES_DE_AUDIO.test(url)) {
    return (
      <div className="flex items-center gap-2">
        <Mic size={16} className="shrink-0" />
        <audio controls src={url} className="h-8 max-w-[220px]" />
      </div>
    );
  }
  const nomeDoArquivo = url.split('/').pop() ?? 'Arquivo';
  const ehPdf = /\.pdf(\?.*)?$/i.test(url);
  return (
    <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-md bg-carbono/20 px-2 py-1.5">
      <FileText size={18} className={cn('shrink-0', ehPdf ? 'text-erro' : 'text-nevoa')} />
      <span className="truncate underline">{nomeDoArquivo}</span>
    </a>
  );
}

export function ThreadChat({ threadId }: { threadId: string | null }) {
  const { data: thread } = useInboxThread(threadId);
  const { data: messages, isPending } = useInboxMessages(threadId);
  const sendMessage = useSendInboxMessage(threadId ?? '');
  const [draft, setDraft] = useState('');

  if (!threadId) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState icon={MessageCircle} title="Selecione uma conversa" description="Escolha uma conversa na lista para ver as mensagens." />
      </div>
    );
  }

  async function handleSend() {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    await sendMessage.mutateAsync(text).catch(() => undefined);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-grafite-elevado px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <EntityAvatar name={thread?.clientName ?? thread?.contactName ?? '?'} kind={thread?.clientId ? 'client' : 'person'} size="md" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="truncate font-semibold text-branco-cru">{thread?.clientName ?? thread?.contactName ?? 'sem dado'}</p>
              {thread?.channel === 'whatsapp' && (
                <img src="/logos/whatsapp.webp" alt="WhatsApp" className="size-3.5 shrink-0 rounded-sm" />
              )}
            </div>
            <p className="text-xs text-nevoa">{thread?.clientId ? 'Cliente · Ativo' : thread?.contactPhone ?? 'Conversa interna'}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-nevoa">
          <button type="button" title="Buscar na conversa" className="flex size-8 items-center justify-center rounded-md hover:bg-grafite-elevado hover:text-branco-cru">
            <Search size={16} />
          </button>
          <button type="button" title="Ligar" className="flex size-8 items-center justify-center rounded-md hover:bg-grafite-elevado hover:text-branco-cru">
            <Phone size={16} />
          </button>
          <button type="button" title="Chamada de vídeo" className="flex size-8 items-center justify-center rounded-md hover:bg-grafite-elevado hover:text-branco-cru">
            <Video size={16} />
          </button>
          <button type="button" title="Mais opções" className="flex size-8 items-center justify-center rounded-md hover:bg-grafite-elevado hover:text-branco-cru">
            <MoreHorizontal size={16} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {isPending ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-2/3" />)
        ) : messages && messages.length > 0 ? (
          messages.map((m) => (
            <div key={m.id} className={cn('flex', m.direction === 'outbound' ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[70%] rounded-lg px-3 py-2 text-sm',
                  m.direction === 'outbound' ? 'bg-sinal/90 text-carbono' : 'bg-grafite-elevado text-branco-cru',
                )}
              >
                {m.attachmentUrl && <BolhaDeAnexo url={m.attachmentUrl} />}
                {m.content && <p className={m.attachmentUrl ? 'mt-1.5' : undefined}>{m.content}</p>}
                <p className={cn('mt-1 text-[10px]', m.direction === 'outbound' ? 'text-carbono/70' : 'text-nevoa')}>
                  {formatTime(m.createdAt)}
                  {m.direction === 'outbound' && m.deliveryStatus === 'failed' && ' · falhou ao enviar'}
                </p>
              </div>
            </div>
          ))
        ) : (
          <p className="text-center text-sm text-nevoa">Nenhuma mensagem ainda.</p>
        )}
      </div>

      <div className="border-t border-grafite-elevado p-3">
        {sendMessage.isError && (
          <p className="mb-2 text-xs text-red-400">
            {sendMessage.error instanceof ApiRequestError ? sendMessage.error.message : 'Falha ao enviar.'}
          </p>
        )}
        <div className="flex items-end gap-2">
          <button type="button" title="Anexar arquivo" className="flex size-9 shrink-0 items-center justify-center rounded-md text-nevoa hover:bg-grafite-elevado hover:text-branco-cru">
            <Paperclip size={18} />
          </button>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            rows={1}
            placeholder="Digite uma mensagem..."
            className="flex-1 resize-none rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru outline-none focus:border-sinal"
          />
          <button type="button" title="Emoji" className="flex size-9 shrink-0 items-center justify-center rounded-md text-nevoa hover:bg-grafite-elevado hover:text-branco-cru">
            <Smile size={18} />
          </button>
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={sendMessage.isPending}
            className="flex size-9 shrink-0 items-center justify-center rounded-md bg-sinal text-carbono disabled:opacity-40"
          >
            {draft.trim() ? <ArrowUp size={18} /> : <Mic size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}

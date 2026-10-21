'use client';

import { useState, type ReactNode } from 'react';
import {
  useDeleteChatMessage,
  useEditChatMessage,
  usePinMessage,
  useReactChatMessage,
  useSaveMessage,
  useSendChatMessage,
  type ChatMessage,
} from '@/hooks/use-internal-chat';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from '@/stores/toast-store';
import { CriarTarefa } from './modais';
import type { AcoesDaMensagem } from './mensagem';

/**
 * As ações de mensagem (as mesmas na linha principal e na thread) e os modais
 * que elas abrem. Quem usa só fornece o que muda: responder, abrir thread, ir
 * para uma mensagem.
 */
export function useAcoesDeMensagem(conversationId: string, me: { id: string; name: string | null }, extras: Pick<AcoesDaMensagem, 'onReply' | 'onThread' | 'onJump'> & { aoEnviar?: () => void }): { acoes: AcoesDaMensagem; enviar: ReturnType<typeof useSendChatMessage>; modais: ReactNode } {
  const enviar = useSendChatMessage(conversationId, me);
  const editar = useEditChatMessage(conversationId);
  const apagar = useDeleteChatMessage(conversationId);
  const reagir = useReactChatMessage(conversationId);
  const fixar = usePinMessage(conversationId);
  const salvar = useSaveMessage(conversationId);
  const [paraApagar, setParaApagar] = useState<ChatMessage | null>(null);
  const [paraTarefa, setParaTarefa] = useState<ChatMessage | null>(null);
  const erro = (e: Error) => toast(e.message, 'error');

  const acoes: AcoesDaMensagem = {
    ...extras,
    onRetry: (m) => {
      extras.aoEnviar?.();
      enviar.mutate({
        clientMessageId: m.client_message_id, content: m.content ?? '', attachments: m.attachments, mentions: m.mentions, replyTo: m.reply_to, threadRootId: m.thread_root_id ?? null,
        objects: (m.objects ?? []).filter((o) => o.object_id).map((o) => ({ type: o.type, id: o.object_id!, context: o.context })),
      });
    },
    onEdit: (m, content) => editar.mutate({ messageId: m.id, content }, { onError: erro }),
    onDelete: (m) => setParaApagar(m),
    onReact: (m, emoji) => reagir.mutate({ messageId: m.id, emoji }, { onError: erro }),
    onPin: (m) => fixar.mutate({ messageId: m.id, pinned: !m.pinned }, { onError: erro, onSuccess: (r) => toast(r.pinned ? 'Mensagem fixada.' : 'Mensagem desafixada.', 'success') }),
    onSave: (m) => salvar.mutate({ message: m, saved: !m.saved }, { onError: erro, onSuccess: (r) => toast(r.saved ? 'Salva para depois.' : 'Tirada dos salvos.', 'info') }),
    onCreateTask: (m) => setParaTarefa(m),
  };

  const modais = (
    <>
      {paraApagar && (
        <ConfirmDialog
          title="Apagar mensagem?"
          description="Ela some para todos da conversa, junto com os arquivos anexados. Não dá para desfazer."
          confirmLabel="Apagar"
          isPending={apagar.isPending}
          onCancel={() => setParaApagar(null)}
          onConfirm={() => apagar.mutate(paraApagar.id, { onSettled: () => setParaApagar(null), onError: erro })}
        />
      )}
      {paraTarefa && <CriarTarefa conversationId={conversationId} mensagem={paraTarefa} onClose={() => setParaTarefa(null)} />}
    </>
  );

  return { acoes, enviar, modais };
}

'use client';

import { Lock, Users } from 'lucide-react';
import { useConversation, useUpdateConversation } from '@/hooks/use-conversations';
import { useIsMaster } from '@/hooks/use-is-master';
import { useMe } from '@/hooks/use-me';

/**
 * Controle de visibilidade da conversa aberta. Pública = badge "Equipe";
 * privada = botão "Compartilhar com a equipe". Só o dono (ou master) pode
 * mudar, espelhando o PATCH /conversations/:id - pros demais vira só um
 * indicador discreto.
 */
export function ConversationVisibilityToggle({ conversationId }: { conversationId: string }) {
  const { data: conversation } = useConversation(conversationId);
  const { data: me } = useMe();
  const { isMaster } = useIsMaster();
  const updateConversation = useUpdateConversation();

  if (!conversation) return null;

  const canWrite = conversation.userId === me?.id || isMaster;
  const isPublic = conversation.visibility === 'public';

  if (!canWrite) {
    return (
      <span className="flex items-center gap-1.5 rounded-md border border-grafite-elevado bg-carbono px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-nevoa">
        {isPublic ? <Users size={12} /> : <Lock size={12} />}
        {isPublic ? 'Equipe' : 'Privada'}
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={updateConversation.isPending}
      onClick={() =>
        updateConversation.mutate({ id: conversationId, visibility: isPublic ? 'private' : 'public' })
      }
      title={isPublic ? 'Tornar privada (só você e masters veem)' : 'Compartilhar com a equipe'}
      className={
        isPublic
          ? 'flex items-center gap-1.5 rounded-md border border-sinal/40 bg-sinal/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-sinal transition-colors hover:border-sinal/70'
          : 'flex items-center gap-1.5 rounded-md border border-grafite-elevado bg-carbono px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-nevoa transition-colors hover:border-roxo-eletrico/50 hover:text-branco-cru'
      }
    >
      {isPublic ? <Users size={12} /> : <Lock size={12} />}
      {isPublic ? 'Equipe' : 'Compartilhar com a equipe'}
    </button>
  );
}

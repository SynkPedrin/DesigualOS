'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { MessageSquareShare } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';
import { chatKeys, newClientMessageId, type ObjectToShare } from '@/hooks/use-internal-chat';
import { useMyWorkspace } from '@/hooks/use-my-workspace';
import { toast } from '@/stores/toast-store';
import { EscolherConversa } from './modais';
import { cn } from '@/lib/utils';

/**
 * "Compartilhar na Comunicação" para as outras telas (Mídia, Relatórios,
 * Clientes). Manda a REFERÊNCIA do item, nunca uma cópia: o objeto continua no
 * domínio dele, e cada pessoa que abrir o card vê só o que pode ver.
 * Some quem não tem o módulo de Comunicação no workspace.
 */
export function CompartilharNaComunicacao({ objeto, compacto = false, className }: { objeto: ObjectToShare; compacto?: boolean; className?: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const workspace = useMyWorkspace();
  const [aberto, setAberto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  if (workspace.data && !workspace.data.modules.includes('comunicacao')) return null;

  async function compartilhar(conversationId: string, comentario: string) {
    setEnviando(true);
    try {
      await apiFetch(`/internal-chat/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ clientMessageId: newClientMessageId(), content: comentario.trim() || null, objects: [{ type: objeto.type, id: objeto.id, ...(objeto.context ? { context: objeto.context } : {}) }] }),
      });
      void qc.invalidateQueries({ queryKey: chatKeys.conversations });
      setAberto(false);
      toast('Compartilhado na Comunicação.', 'success');
      router.prefetch?.(`/comunicacao?c=${conversationId}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Não foi possível compartilhar.', 'error');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setAberto(true); }}
        title="Compartilhar na Comunicação"
        aria-label={`Compartilhar ${objeto.label ?? 'item'} na Comunicação`}
        className={cn(compacto
          ? 'inline-flex size-7 items-center justify-center rounded-md text-nevoa hover:bg-grafite-elevado hover:text-branco-cru'
          : 'inline-flex items-center gap-1.5 rounded-md border border-grafite-elevado px-2.5 py-1.5 text-xs text-branco-cru hover:border-roxo-eletrico/60', className)}
      >
        <MessageSquareShare size={14} /> {!compacto && 'Compartilhar'}
      </button>
      {aberto && <EscolherConversa onClose={() => setAberto(false)} onPick={(c, t) => void compartilhar(c, t)} enviando={enviando} />}
    </>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { MessagesSquare } from 'lucide-react';
import { useOpenDiscussion } from '@/hooks/use-internal-chat';
import { useMyWorkspace } from '@/hooks/use-my-workspace';
import { toast } from '@/stores/toast-store';

/**
 * A discussão de um cliente ou quinzena: UMA conversa por item, a mesma para
 * toda a equipe (não um chat novo por tela). Quem pode ver o item participa.
 */
export function AbrirDiscussao({ entityType, entityId, titulo, rotulo }: { rotulo?: string; entityType: 'client' | 'demand' | 'work_task'; entityId: string; titulo: string }) {
  const router = useRouter();
  const workspace = useMyWorkspace();
  const abrir = useOpenDiscussion();
  if (workspace.data && !workspace.data.modules.includes('comunicacao')) return null;
  return (
    <button
      type="button"
      disabled={abrir.isPending}
      onClick={() => abrir.mutate({ entity_type: entityType, entity_id: entityId, title: titulo }, {
        onSuccess: (r) => router.push(`/comunicacao?c=${r.id}`),
        onError: (e) => toast(e.message, 'error'),
      })}
      title="Conversa da equipe sobre este item, na Comunicação"
      className="flex items-center gap-1.5 rounded-md border border-grafite-elevado px-3 py-2 text-sm text-branco-cru transition-colors hover:border-roxo-eletrico/60 disabled:opacity-50"
    >
      <MessagesSquare size={14} /> {rotulo ?? 'Discussão'}
    </button>
  );
}

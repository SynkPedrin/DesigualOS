'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight, MessageCircle, X } from 'lucide-react';
import { useClientWorkspace } from '@/hooks/use-client-workspace';
import { useIsMaster } from '@/hooks/use-is-master';
import { GrantAccessForm } from './grant-access-form';
import { ClickUpTaskCommentsPanel } from './clickup-task-comments';
import { ClientOverviewPanel } from './client-overview-panel';
import { ClientMemoryPanel } from './client-memory-panel';
import { ClientStudioGallery } from './client-studio-gallery';
import { ClientMetaAdsPanel } from './client-meta-ads-panel';
import { ClientGoogleAdsPanel } from './client-google-ads-panel';
import { ClientReportsPanel } from './client-reports-panel';
import { ClientTeamPanel } from './client-team-panel';
import { ClientDemandsPanel } from './client-demands-panel';
import { ClientTasksPanel } from './client-tasks-panel';
import type { ClientSummary } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';

/**
 * "Memória" entra ao lado de "Visão Geral" (29/09/2026): a ficha passou a
 * mostrar o que o sistema APRENDEU sobre a conta, não só o que está aberto
 * nela. É a promessa de camada de inteligência aplicada a um cliente — e o
 * lugar onde quem vai produzir descobre a regra ANTES do retrabalho, em vez de
 * depois.
 */
const BASE_TABS = ['ClickUp', 'Visão Geral', 'Equipe', 'Demandas', 'Memória', 'Conversas', 'Studio', 'Mídia'] as const;
/** "Acesso" só pra master - mesma regra da tela antiga, não afrouxa nada. */
const MASTER_TABS = [...BASE_TABS, 'Acesso'] as const;
type Tab = (typeof MASTER_TABS)[number];

/**
 * O card clicado "sobe, vira e dá zoom" até virar a ficha inteira do cliente.
 * `layoutId` casa com o card da roleta: o Framer Motion interpola posição e
 * tamanho entre os dois, então é o MESMO card crescendo, não um modal que
 * aparece por cima. rotateX no início é o "virar" saindo do tombo da roleta.
 */
export function ClientDetailOverlay({ client, onClose }: { client: ClientSummary; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('ClickUp');
  const { isMaster } = useIsMaster();
  const tabs: readonly Tab[] = isMaster ? MASTER_TABS : BASE_TABS;
  const { data: workspace } = useClientWorkspace(client.id);
  const clickupUrl = workspace?.client.clickupUrl ?? client.clickupUrl;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <motion.div
      className="fixed inset-0 z-[85] flex items-center justify-center bg-carbono/85 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        layoutId={`client-card-${client.id}`}
        onClick={(event) => event.stopPropagation()}
        initial={{ rotateX: 35, y: 60 }}
        animate={{ rotateX: 0, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        style={{ transformStyle: 'preserve-3d', perspective: 1200 }}
        className="flex h-[85vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-grafite-elevado bg-grafite shadow-elevated"
      >
        <div className="flex items-start justify-between gap-4 border-b border-grafite-elevado p-6">
          <div className="min-w-0">
            <h2 className="truncate font-heading text-2xl font-bold text-branco-cru">{client.name}</h2>
            <p className="mt-1 font-mono text-[11px] text-nevoa">
              {client.status} · {client.clickupListId ? `lista ${client.clickupListId}` : 'sem vínculo no ClickUp'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Link
              href={`/clients/${client.id}`}
              className="flex items-center gap-1.5 text-sm text-nevoa transition-colors hover:text-branco-cru"
            >
              Ver detalhes do cliente
              <ArrowRight size={14} />
            </Link>
            {workspace?.projectId && (
              <Link
                href={`/chat?project=${workspace.projectId}`}
                className="flex items-center gap-1.5 rounded-md border border-roxo-eletrico/40 bg-roxo-eletrico/10 px-3 py-1.5 text-sm text-branco-cru transition-colors hover:border-roxo-eletrico/70"
              >
                <MessageCircle size={14} />
                Abrir chat
              </Link>
            )}
            <button type="button" onClick={onClose} aria-label="Fechar" className="text-nevoa hover:text-branco-cru">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex shrink-0 gap-1 border-b border-grafite-elevado px-6 py-3">
          {tabs.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                tab === item ? 'bg-grafite-elevado text-branco-cru' : 'text-nevoa hover:text-branco-cru',
              )}
            >
              {item}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {tab === 'ClickUp' && <ClientTasksPanel clientId={client.id} clickupUrl={clickupUrl} />}

          {tab === 'Visão Geral' && <ClientOverviewPanel clientId={client.id} />}

          {tab === 'Equipe' && <ClientTeamPanel clientId={client.id} />}

          {tab === 'Demandas' && <ClientDemandsPanel clientId={client.id} />}

          {tab === 'Memória' && <ClientMemoryPanel clientId={client.id} />}

          {tab === 'Conversas' && <ClickUpTaskCommentsPanel clientId={client.id} />}

          {tab === 'Studio' && <ClientStudioGallery clientId={client.id} />}

          {tab === 'Mídia' && (
            <div className="space-y-4">
              <ClientMetaAdsPanel clientId={client.id} />
              <ClientGoogleAdsPanel clientId={client.id} />
              <ClientReportsPanel clientId={client.id} />
            </div>
          )}

          {tab === 'Acesso' && isMaster && <GrantAccessForm clientId={client.id} />}
        </div>
      </motion.div>
    </motion.div>
  );
}

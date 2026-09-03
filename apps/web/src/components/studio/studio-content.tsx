'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { JobForm } from '@/components/studio/job-form';
import { JobProgressCard } from '@/components/studio/job-progress-card';
import { AssetGallery } from '@/components/studio/asset-gallery';
import { GpuPanel } from '@/components/studio/gpu-panel';
import { useStudioAssets } from '@/hooks/use-studio-assets';
import { useMyActiveStudioJobs } from '@/hooks/use-studio-jobs';
import { useInfrastructureHealth } from '@/hooks/use-infrastructure-health';
import { useIsMaster } from '@/hooks/use-is-master';
import { useClients } from '@/hooks/use-clients';
import { Images } from 'lucide-react';

/** The actual Studio screen, shared by the /studio route (deep links, direct nav) and the
 * StudioModal popup (the everyday entry point from the sidebar/command palette). */
export function StudioContent() {
  const [activeJobIds, setActiveJobIds] = useState<string[]>([]);
  // Vem da notificação de job concluído ("/studio?asset=<id>"): a galeria
  // abre essa peça direto. Lido de window.location em vez de useSearchParams
  // porque o Studio também roda dentro do modal, fora de uma rota própria.
  const [highlightAssetId, setHighlightAssetId] = useState<string | null>(null);
  useEffect(() => {
    setHighlightAssetId(new URLSearchParams(window.location.search).get('asset'));
  }, []);
  // Job generation runs on the worker independently of the Studio being open (BullMQ, not
  // tied to this component's lifetime). This just restores "your jobs in progress" into
  // local state on mount/reopen, since activeJobIds itself is plain component memory.
  const { data: myActiveJobIds } = useMyActiveStudioJobs();
  useEffect(() => {
    if (!myActiveJobIds || myActiveJobIds.length === 0) return;
    setActiveJobIds((current) => {
      const missing = myActiveJobIds.filter((id) => !current.includes(id));
      return missing.length > 0 ? [...missing, ...current] : current;
    });
  }, [myActiveJobIds]);
  const [galleryClientId, setGalleryClientId] = useState('');
  const { isMaster } = useIsMaster();
  const { data: clients } = useClients();
  // Master can browse assets across every client (empty selection = no client_id filter);
  // colaborador needs a client_id or the backend 403s, so the gallery just waits for a pick.
  const assetsEnabled = isMaster || Boolean(galleryClientId);
  const { data: assets } = useStudioAssets(galleryClientId || null, assetsEnabled);
  const { data: health } = useInfrastructureHealth(isMaster);
  const queryClient = useQueryClient();

  const handleCreated = useCallback((jobId: string) => {
    setActiveJobIds((current) => [jobId, ...current]);
  }, []);

  const dismissJob = useCallback((jobId: string) => {
    setActiveJobIds((current) => current.filter((id) => id !== jobId));
  }, []);

  const handleSettled = useCallback(
    (jobId: string, status: 'completed' | 'failed') => {
      queryClient.invalidateQueries({ queryKey: ['studio', 'assets'] });
      // Só o job que deu certo se retira sozinho (o resultado está na
      // galeria logo abaixo). O que falhou FICA na tela com o motivo até a
      // pessoa fechar — sumir calado foi exatamente o defeito relatado.
      if (status === 'completed') {
        setTimeout(() => dismissJob(jobId), 2000);
      }
    },
    [queryClient, dismissJob],
  );

  const studioNode = health?.nodes.find((n) => n.agent === 'studio');

  return (
    <div>
      <PageHeader
        eyebrow="Criação multimídia"
        title="Studio"
        description="Gere carrosséis, reels e imagens com o Brand Kit do cliente aplicado automaticamente."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[340px_1fr] 2xl:grid-cols-[400px_1fr]">
        <div className="space-y-4">
          <JobForm onCreated={handleCreated} />
          <GpuPanel node={studioNode} />
        </div>

        <div className="space-y-6">
          {activeJobIds.length > 0 && (
            <div>
              <h2 className="mb-3 font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">
                Fila de jobs
              </h2>
              <div className="space-y-3">
                {activeJobIds.map((jobId) => (
                  <JobProgressCard key={jobId} jobId={jobId} onSettled={handleSettled} onDismiss={dismissJob} />
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">
                Galeria
              </h2>
              <select
                value={galleryClientId}
                onChange={(event) => setGalleryClientId(event.target.value)}
                className="rounded-md border border-grafite-elevado bg-carbono px-2.5 py-1.5 text-xs text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
              >
                <option value="">{isMaster ? 'Todos os clientes' : 'Selecione um cliente'}</option>
                {clients?.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </div>
            {!assetsEnabled ? (
              <EmptyState
                icon={Images}
                title="Selecione um cliente"
                description="Escolha um cliente acima para ver os assets gerados pra ele."
              />
            ) : (
              <AssetGallery assets={assets ?? []} highlightAssetId={highlightAssetId} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

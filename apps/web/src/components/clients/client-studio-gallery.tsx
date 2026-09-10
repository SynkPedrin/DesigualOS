'use client';

import { Loader2 } from 'lucide-react';
import { AssetGallery } from '@/components/studio/asset-gallery';
import { Toaster } from '@/components/ui/toaster';
import { useStudioAssets } from '@/hooks/use-studio-assets';

/**
 * Aba Studio do workspace do cliente: galeria somente leitura de todo o
 * material que o Studio já gerou pra este client_id (mesmos componentes da
 * página /studio, com download). Gerar coisa nova continua sendo no /studio —
 * as ações de "carregar no Studio" do menu ⋮ abrem o StudioModal global.
 */
export function ClientStudioGallery({ clientId }: { clientId: string }) {
  const { data, isPending, isError } = useStudioAssets({ clientId });

  if (isPending) {
    return (
      <p className="flex items-center gap-2 py-12 text-sm text-nevoa">
        <Loader2 size={15} className="animate-spin" /> Carregando os materiais do Studio…
      </p>
    );
  }
  if (isError || !data) {
    return <p className="py-8 text-center text-sm text-erro">Não foi possível carregar os materiais do Studio.</p>;
  }

  return (
    <>
      <AssetGallery assets={data.assets} insideStudio={false} />
      <Toaster />
    </>
  );
}

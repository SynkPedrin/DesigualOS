'use client';

import { useState } from 'react';
import { InlineSectionError } from '@/components/ui/inline-section-error';
import { Skeleton } from '@/components/ui/skeleton';
import { useCanvaDocument } from '@/hooks/use-canva-documents';
import { CanvaDocumentGrid } from './canva-document-grid';
import { CanvaWorkspace } from './canva-workspace';

/**
 * Studio > Canva. Ponto de entrada da aba: sem documento aberto, mostra o
 * grid de designs do cliente + "Novo design"; com um aberto, o editor
 * completo assume a tela. Só existe atrás de next/dynamic(ssr:false) (ver
 * studio-content.tsx) porque fabric.js acessa `document`/`window` no import
 * e quebra em SSR (`exports.node: null` no package.json dele).
 */
export function CanvaEditor({ clientId }: { clientId: string | null }) {
  const [openDocumentId, setOpenDocumentId] = useState<string | null>(null);
  const { data: document, isPending, isError, refetch } = useCanvaDocument(openDocumentId);

  if (!clientId) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-grafite-elevado bg-grafite/60 text-sm text-nevoa">
        Selecione um cliente para ver os designs do Canva.
      </div>
    );
  }

  if (openDocumentId && isPending) {
    return <Skeleton className="h-[70vh] w-full rounded-xl" />;
  }

  if (openDocumentId && isError) {
    return <InlineSectionError message="Não conseguimos abrir este design." onRetry={() => void refetch()} />;
  }

  if (openDocumentId && document) {
    return (
      <div className="h-[calc(100vh-220px)] min-h-[520px] overflow-hidden rounded-xl border border-grafite-elevado">
        <CanvaWorkspace document={document} onOpenDocument={setOpenDocumentId} onBack={() => setOpenDocumentId(null)} />
      </div>
    );
  }

  return <CanvaDocumentGrid clientId={clientId} onOpen={setOpenDocumentId} />;
}

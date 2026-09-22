'use client';

import { useEffect, useState } from 'react';
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
export function CanvaEditor({
  clientId,
  onEditorOpenChange,
}: {
  clientId: string | null;
  /** Avisa a árvore acima que o editor assumiu a tela (esconde hero/abas). */
  onEditorOpenChange?: (open: boolean) => void;
}) {
  const [openDocumentId, setOpenDocumentId] = useState<string | null>(null);
  const { data: document, isPending, isError, refetch } = useCanvaDocument(openDocumentId);

  // O editor "assumiu a tela" só quando há documento REALMENTE carregado -
  // avisar antes disso esconderia o hero durante o skeleton e faria a página
  // piscar entre dois layouts.
  const editorOpen = Boolean(openDocumentId && document);
  useEffect(() => {
    onEditorOpenChange?.(editorOpen);
  }, [editorOpen, onEditorOpenChange]);
  useEffect(() => () => onEditorOpenChange?.(false), [onEditorOpenChange]);

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
    // Sem número mágico: o editor preenche o container real (a cadeia
    // flex/min-h-0 vem do AppShell -> StudioContent -> CanvaTab). O
    // `h-[calc(100vh-220px)]` anterior compensava hero + abas + heading na
    // marra e sobrava um artboard minúsculo - medido no navegador em
    // 17/09/2026: 259x324 px de canvas num viewport de 1280x720, com o
    // artboard começando em y=480, ou seja, abaixo da dobra.
    return (
      <div className="min-h-[420px] flex-1 overflow-hidden rounded-xl border border-grafite-elevado">
        <CanvaWorkspace document={document} onOpenDocument={setOpenDocumentId} onBack={() => setOpenDocumentId(null)} />
      </div>
    );
  }

  return <CanvaDocumentGrid clientId={clientId} onOpen={setOpenDocumentId} />;
}

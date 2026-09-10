'use client';

import { useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Copy, FileUp, Image as ImageIcon, Loader2, Plus, Trash2 } from 'lucide-react';
import type { CanvaImageObject, CanvaPage } from '@desigual-os/types';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { InlineSectionError } from '@/components/ui/inline-section-error';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  useCanvaDocuments,
  useCreateCanvaDocument,
  useDeleteCanvaDocument,
  useDuplicateCanvaDocument,
} from '@/hooks/use-canva-documents';
import { useUploadStudioReference } from '@/hooks/use-studio-jobs';
import { apiFetch } from '@/lib/api/client';
import { parsePsdFile } from '@/lib/canva/psd-import';
import { formatRelativeTime } from '@/lib/format';
import { toast } from '@/stores/toast-store';
import { NewDesignModal } from './new-design-modal';

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/** Importa um .psd inteiro como um design novo: cada camada (com pixel
 * próprio, grupos/pastas viram só um passo de recursão) vira um objeto
 * `image` comum na primeira página, na posição/tamanho exatos do PSD -
 * texto e efeitos do Photoshop não viram texto editável, a aparência final
 * é preservada como imagem (ver psd-import.ts). Falha em UMA camada não
 * derruba a importação inteira (Promise.allSettled). */
function usePsdImport(clientId: string, onImported: (documentId: string) => void) {
  const [importing, setImporting] = useState(false);
  const createDocument = useCreateCanvaDocument();
  const uploadReference = useUploadStudioReference();

  async function importFile(file: File) {
    setImporting(true);
    try {
      const parsed = await parsePsdFile(file);
      if (parsed.layers.length === 0) {
        toast('Este PSD não tem nenhuma camada visível com conteúdo pra importar.', 'error');
        return;
      }

      const doc = await createDocument.mutateAsync({
        clientId,
        name: file.name.replace(/\.psd$/i, '') || 'Importado do Photoshop',
        width: parsed.width,
        height: parsed.height,
      });

      const uploaded = await Promise.allSettled(
        parsed.layers.map(async (layer) => {
          const blob = await canvasToBlob(layer.canvas);
          if (!blob) throw new Error('canvas vazio');
          const uploadedFile = new File([blob], `${layer.name || 'camada'}.png`, { type: 'image/png' });
          const result = await uploadReference.mutateAsync(uploadedFile);
          return { layer, url: result.url };
        }),
      );

      const objects: CanvaImageObject[] = [];
      let failures = 0;
      uploaded.forEach((outcome, index) => {
        if (outcome.status === 'rejected') {
          failures += 1;
          return;
        }
        const { layer, url } = outcome.value;
        objects.push({
          id: crypto.randomUUID(),
          type: 'image',
          src: url,
          x: layer.left,
          y: layer.top,
          width: layer.width,
          height: layer.height,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          opacity: layer.opacity,
          locked: false,
          visible: true,
          zIndex: index,
        });
      });

      const page: CanvaPage = {
        id: doc.pages[0]?.id ?? crypto.randomUUID(),
        order: 0,
        background: { type: 'color', value: '#ffffff' },
        objects,
      };
      // PATCH direto (não via useUpdateCanvaDocument): esse hook é feito pra
      // um documentId já conhecido de antemão (o caso normal, dentro do
      // workspace já aberto) - aqui o id só existe DEPOIS da criação, então
      // chamar apiFetch direto é mais simples que forçar o hook num molde
      // que não é o dele.
      await apiFetch(`/studio/canvas-documents/${doc.id}`, { method: 'PATCH', body: JSON.stringify({ pages: [page] }) });

      if (failures > 0) {
        toast(`Importado com ${failures} camada(s) que não puderam ser processadas.`, 'error');
      } else {
        toast('PSD importado com sucesso.', 'success');
      }
      onImported(doc.id);
    } catch {
      toast('Não foi possível importar este arquivo PSD.', 'error');
    } finally {
      setImporting(false);
    }
  }

  return { importing, importFile };
}

/** Sidebar "Projetos" e tela inicial do Canva compartilham este grid - só muda
 * o que acontece ao abrir um card (`onOpen`). */
export function CanvaDocumentGrid({ clientId, onOpen }: { clientId: string; onOpen: (documentId: string) => void }) {
  const { data: documents, isPending, isError, refetch } = useCanvaDocuments(clientId);
  const duplicate = useDuplicateCanvaDocument();
  const deleteDoc = useDeleteCanvaDocument(clientId);
  const [showNewModal, setShowNewModal] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const psdInputRef = useRef<HTMLInputElement>(null);
  const { importing: importingPsd, importFile: importPsdFile } = usePsdImport(clientId, onOpen);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">Seus designs</h3>
        <div className="flex items-center gap-2">
          <input
            ref={psdInputRef}
            type="file"
            accept=".psd,image/vnd.adobe.photoshop"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void importPsdFile(file);
            }}
          />
          <button
            type="button"
            onClick={() => psdInputRef.current?.click()}
            disabled={importingPsd}
            title="Importar arquivo .psd do Photoshop"
            className="flex items-center gap-1.5 rounded-md border border-grafite-elevado px-3 py-1.5 text-xs font-semibold text-nevoa transition-colors hover:border-roxo-eletrico/60 hover:text-branco-cru disabled:opacity-50"
          >
            {importingPsd ? <Loader2 size={13} className="animate-spin" /> : <FileUp size={13} />}
            {importingPsd ? 'Importando...' : 'Importar PSD'}
          </button>
          <button
            type="button"
            onClick={() => setShowNewModal(true)}
            className="flex items-center gap-1.5 rounded-md bg-roxo-eletrico px-3 py-1.5 text-xs font-semibold text-branco-cru transition-all hover:opacity-90 hover:shadow-glow"
          >
            <Plus size={13} />
            Novo design
          </button>
        </div>
      </div>

      {isPending && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="aspect-square rounded-lg" />
          ))}
        </div>
      )}

      {isError && <InlineSectionError message="Não conseguimos carregar seus designs." onRetry={() => void refetch()} />}

      {!isPending && !isError && documents && documents.length === 0 && (
        <EmptyState
          icon={ImageIcon}
          title="Nenhum design ainda"
          description="Comece um post, banner ou carrossel do zero."
        />
      )}

      {!isPending && !isError && documents && documents.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="group relative overflow-hidden rounded-lg border border-grafite-elevado bg-carbono transition-colors hover:border-nevoa/40"
            >
              <button
                type="button"
                onClick={() => onOpen(doc.id)}
                className="flex aspect-square w-full items-center justify-center bg-grafite"
                style={{ aspectRatio: `${doc.width} / ${doc.height}` }}
              >
                {doc.thumbnailUrl ? (
                  <img src={doc.thumbnailUrl} alt={doc.name} className="size-full object-cover" />
                ) : (
                  <ImageIcon size={22} className="text-nevoa" />
                )}
              </button>
              <div className="p-2">
                <p className="truncate text-xs font-medium text-branco-cru">{doc.name}</p>
                <p className="font-mono text-[10px] text-nevoa">
                  {doc.width}×{doc.height} · {formatRelativeTime(doc.updatedAt)}
                </p>
              </div>
              <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  aria-label="Duplicar"
                  title="Duplicar"
                  onClick={() =>
                    duplicate.mutate(doc.id, {
                      onError: () => toast('Não foi possível duplicar o design.', 'error'),
                    })
                  }
                  className="rounded-md bg-carbono/80 p-1.5 text-nevoa backdrop-blur-sm transition-colors hover:text-branco-cru"
                >
                  <Copy size={12} />
                </button>
                <button
                  type="button"
                  aria-label="Excluir"
                  title="Excluir"
                  onClick={() => setConfirmingDeleteId(doc.id)}
                  className="rounded-md bg-carbono/80 p-1.5 text-nevoa backdrop-blur-sm transition-colors hover:text-erro"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {showNewModal && (
          <NewDesignModal
            clientId={clientId}
            onClose={() => setShowNewModal(false)}
            onCreated={(documentId) => {
              setShowNewModal(false);
              onOpen(documentId);
            }}
          />
        )}
        {confirmingDeleteId && (
          <ConfirmDialog
            title="Excluir design"
            description="Excluir este design? Essa ação não pode ser desfeita."
            isPending={deleteDoc.isPending}
            onConfirm={() =>
              deleteDoc.mutate(confirmingDeleteId, {
                onSuccess: () => {
                  setConfirmingDeleteId(null);
                  toast('Design excluído.', 'success');
                },
                onError: () => toast('Não foi possível excluir o design.', 'error'),
              })
            }
            onCancel={() => setConfirmingDeleteId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

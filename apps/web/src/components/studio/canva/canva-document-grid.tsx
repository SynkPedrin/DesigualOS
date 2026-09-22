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
import { describePsdApproximations, parsePsdFile } from '@/lib/canva/psd-import';
import { formatRelativeTime } from '@/lib/format';
import { toast } from '@/stores/toast-store';
import { NewDesignModal } from './new-design-modal';

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/** Quantas camadas sobem ao mesmo tempo. `Promise.allSettled` sobre a lista
 * inteira disparava TODOS os uploads de uma vez (um PSD de 21 camadas = 21
 * multipart simultâneos): o navegador enfileira além de ~6 por origem, a API
 * atende todos de uma vez e o resultado é que nenhum termina cedo, sem
 * nenhum sinal de progresso na tela. Em lotes pequenos os primeiros terminam
 * logo e a contagem anda de verdade. */
const PSD_UPLOAD_CONCURRENCY = 4;

/** Executa `worker` sobre `items` com no máximo `limit` em voo, preservando a
 * ordem dos resultados (mesmo formato de Promise.allSettled). */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let cursor = 0;
  async function runNext(): Promise<void> {
    const index = cursor;
    cursor += 1;
    if (index >= items.length) return;
    try {
      results[index] = { status: 'fulfilled', value: await worker(items[index]!, index) };
    } catch (reason) {
      results[index] = { status: 'rejected', reason };
    }
    await runNext();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runNext()));
  return results;
}

/** Importa um .psd inteiro como um design novo: cada camada (com pixel
 * próprio, grupos/pastas viram só um passo de recursão) vira um objeto
 * `image` comum na primeira página, na posição/tamanho exatos do PSD -
 * texto e efeitos do Photoshop não viram texto editável, a aparência final
 * é preservada como imagem (ver psd-import.ts). Falha em UMA camada não
 * derruba a importação inteira (uma falha vira `rejected` e as outras seguem). */
function usePsdImport(clientId: string, onImported: (documentId: string) => void) {
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const createDocument = useCreateCanvaDocument();
  const uploadReference = useUploadStudioReference();

  async function importFile(file: File) {
    setImporting(true);
    setProgress(null);
    try {
      // `readPsd` é síncrono e pesado (descomprime cada camada): sem ceder um
      // frame antes, o "Importando..." do botão só aparecia DEPOIS da leitura
      // terminar - a tela ficava congelada sem nenhum sinal de vida, que é o
      // que se via como "nem carrega".
      await new Promise((resolve) => setTimeout(resolve, 0));
      const parsed = await parsePsdFile(file);
      if (parsed.layers.length === 0) {
        toast('Este PSD não tem nenhuma camada visível com conteúdo pra importar.', 'error');
        return;
      }
      setProgress({ done: 0, total: parsed.layers.length });

      const doc = await createDocument.mutateAsync({
        clientId,
        name: file.name.replace(/\.psd$/i, '') || 'Importado do Photoshop',
        width: parsed.width,
        height: parsed.height,
      });

      const uploaded = await mapWithConcurrency(parsed.layers, PSD_UPLOAD_CONCURRENCY, async (layer) => {
        const blob = await canvasToBlob(layer.canvas);
        if (!blob) throw new Error('canvas vazio');
        const uploadedFile = new File([blob], `${layer.name || 'camada'}.png`, { type: 'image/png' });
        try {
          const result = await uploadReference.mutateAsync(uploadedFile);
          return { layer, url: result.url };
        } finally {
          setProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
        }
      });

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
          // width/height = tamanho natural do PNG da camada e escala 1: a
          // camada entra no tamanho exato que tinha no PSD (ver
          // computeImagePlacement em fabric-sync.ts sobre esse modelo).
          width: layer.width,
          height: layer.height,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          opacity: layer.opacity,
          blendMode: layer.blendMode,
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
      // O que o navegador não reproduz igual ao Photoshop é dito em voz alta,
      // logo depois do resultado - a arte sair diferente sem explicação é
      // pior do que sair diferente com o motivo na tela.
      const caveat = describePsdApproximations(parsed.approximations);
      if (caveat) toast(caveat, 'error');
      onImported(doc.id);
    } catch (error) {
      // Achado real (2026-09-10): este catch não logava NADA - qualquer
      // falha (readPsd rejeitando o arquivo, canvas grande demais pro
      // navegador, criação do documento falhando) virava só um toast
      // genérico, sem nenhum jeito de diagnosticar depois. console.error
      // aqui é o mínimo pra qualquer relato futuro ser investigável.
      console.error('psd_import_failed', error);
      const detail = error instanceof Error ? error.message : null;
      toast(detail ? `Não foi possível importar este arquivo PSD: ${detail}` : 'Não foi possível importar este arquivo PSD.', 'error');
    } finally {
      setImporting(false);
      setProgress(null);
    }
  }

  return { importing, progress, importFile };
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
  const { importing: importingPsd, progress: psdProgress, importFile: importPsdFile } = usePsdImport(clientId, onOpen);

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
            {!importingPsd
              ? 'Importar PSD'
              : psdProgress
                ? `Enviando camadas ${psdProgress.done}/${psdProgress.total}`
                : 'Lendo arquivo...'}
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
                // A miniatura é o alvo de abrir; sem nome acessível ela era um
                // botão mudo (e impossível de endereçar em teste).
                aria-label={`Abrir ${doc.name}`}
                data-canva-doc={doc.id}
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
            onConfirm={() => {
              const documentId = confirmingDeleteId;
              // Fecha o diálogo e tira o card da lista na hora (a mutação é
              // otimista, ver useDeleteCanvaDocument) - antes disto o diálogo
              // ficava travado em "excluindo..." até o DELETE e o GET da lista
              // voltarem do servidor.
              setConfirmingDeleteId(null);
              deleteDoc.mutate(documentId, {
                onSuccess: () => toast('Design excluído.', 'success'),
                onError: () => toast('Não foi possível excluir o design. O design foi restaurado na lista.', 'error'),
              });
            }}
            onCancel={() => setConfirmingDeleteId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

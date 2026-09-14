'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import type { CanvaDocument } from '@/lib/api/contracts';
import type { CanvaPage } from '@desigual-os/types';
import { useCanvaEditor } from '@/hooks/use-canva-editor';
import { useUpdateCanvaDocument } from '@/hooks/use-canva-documents';
import { useUploadStudioReference } from '@/hooks/use-studio-jobs';
import { CanvaTopbar } from './canva-topbar';
import { CanvaSidebar } from './canva-sidebar';
import { CanvasStage } from './canvas-stage';
import { FloatingToolbar } from './floating-toolbar';
import { PagesBar } from './pages-bar';
import { BackgroundModal } from './background-modal';
import { CropOverlay, type CropFrame } from './crop-overlay';
import { removeImageBackground } from '@/lib/canva/background-removal';
import { useCanvaRecentUploadsStore } from '@/stores/canva-recent-uploads-store';
import { toast } from '@/stores/toast-store';

const AUTOSAVE_DEBOUNCE_MS = 1500;
/** Não gera uma thumbnail nova a cada autosave (custaria um render + upload
 * extra por edição, agravando a lentidão já reportada) - só no máximo uma
 * vez a cada 30s, best-effort (falha aqui nunca deve atrapalhar o autosave
 * de verdade das páginas, que é o que importa preservar). */
const THUMBNAIL_MIN_INTERVAL_MS = 30_000;

export function CanvaWorkspace({
  document,
  onOpenDocument,
  onBack,
}: {
  document: CanvaDocument;
  onOpenDocument: (documentId: string) => void;
  onBack: () => void;
}) {
  const updateDocument = useUpdateCanvaDocument(document.id);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPagesRef = useRef<CanvaPage[] | null>(null);
  const lastThumbnailAtRef = useRef(0);
  const replaceFileInputRef = useRef<HTMLInputElement>(null);
  const [backgroundModalOpen, setBackgroundModalOpen] = useState(false);
  const [cropFrame, setCropFrame] = useState<CropFrame | null>(null);
  const [removingBackground, setRemovingBackground] = useState(false);
  const uploadReference = useUploadStudioReference();
  const addRecentUpload = useCanvaRecentUploadsStore((state) => state.addRecent);

  /** Todo arquivo local (paste/drag do computador) passa por aqui - sobe pro
   * Storage e JÁ aparece no painel "Uploads" (pedido explícito do usuário:
   * "quando eu colar já atualiza no upload"), não só imagem enviada pelo
   * próprio botão de upload. */
  const uploadImageFile = useCallback(
    async (file: File) => {
      const result = await uploadReference.mutateAsync(file);
      addRecentUpload({ url: result.url, filename: result.filename });
      return result.url;
    },
    [uploadReference, addRecentUpload],
  );

  const flushSave = useCallback(() => {
    if (!pendingPagesRef.current) return;
    const pages = pendingPagesRef.current;
    pendingPagesRef.current = null;
    setSaveStatus('saving');
    updateDocument.mutate(
      { pages },
      {
        onSuccess: () => {
          setSaveStatus('saved');
          void updateThumbnailRef.current();
        },
        onError: () => {
          setSaveStatus('idle');
          toast('Não conseguimos salvar as últimas alterações. Tente novamente.', 'error');
        },
      },
    );
  }, [updateDocument]);

  // Ref pra `flushSave` (useCallback estável, só depende de `updateDocument`)
  // poder chamar sempre a versão mais recente de `updateThumbnail` (definida
  // mais abaixo, depois de `editor` existir) sem precisar entrar nas deps -
  // mesmo padrão de `onChangeRef` em use-canva-editor.ts. Referenciar
  // `updateThumbnailRef.current` aqui dentro é seguro mesmo declarado antes:
  // esta função só roda de verdade bem depois (autosave/unmount), quando o
  // ref já foi atribuído lá embaixo.
  const updateThumbnailRef = useRef<(force?: boolean) => Promise<void>>(async () => {});

  const handleChange = useCallback(
    (pages: CanvaPage[]) => {
      pendingPagesRef.current = pages;
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(flushSave, AUTOSAVE_DEBOUNCE_MS);
    },
    [flushSave],
  );

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      flushSave();
    };
  }, []);

  const editor = useCanvaEditor(document.pages, document.width, document.height, handleChange, uploadImageFile);

  useEffect(() => {
    editor.zoomToFit();
  }, []);

  /** Achado real (2026-09-11): `thumbnail_url` nunca era gravado em lugar
   * nenhum do fluxo de autosave - toda "Meus designs"/"Projetos" mostrava só
   * o ícone genérico de placeholder pra sempre, nunca uma prévia de verdade
   * da arte (o que o usuário reportou como "não tá carregando as imagens").
   * `multiplier` é calculado pra sempre gerar uma imagem pequena (~480px no
   * maior lado) independente do tamanho real do documento (A4/PSD podem ser
   * bem maiores). Melhor esforço: falha aqui não deve nunca virar erro
   * visível pro usuário nem atrapalhar o autosave real das páginas. */
  const updateThumbnail = useCallback(
    async (force = false) => {
      const now = Date.now();
      if (!force && now - lastThumbnailAtRef.current < THUMBNAIL_MIN_INTERVAL_MS) return;
      lastThumbnailAtRef.current = now;
      try {
        const multiplier = Math.min(1, 480 / Math.max(document.width, document.height));
        const dataUrl = editor.exportActivePageDataUrl('jpeg', multiplier);
        if (!dataUrl) return;
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], 'thumbnail.jpg', { type: 'image/jpeg' });
        const uploaded = await uploadReference.mutateAsync(file);
        updateDocument.mutate({ thumbnailUrl: uploaded.url });
      } catch {
        // best-effort - sem toast, sem afetar o autosave real das páginas.
      }
    },
    [document.width, document.height, editor, uploadReference, updateDocument],
  );
  updateThumbnailRef.current = updateThumbnail;

  // Gera a thumbnail assim que o desenho carrega, ignorando o throttle de 30s
  // (`force=true`) - sem isto, todo design salvo ANTES desta função existir
  // ficaria com o placeholder genérico pra sempre em "Meus designs", só
  // ganhando thumbnail de verdade se alguém editasse algo nele.
  //
  // Só pra quem AINDA NÃO TEM thumbnail, no entanto: rodar isto em toda
  // abertura significava renderizar o artboard inteiro, subir um JPEG e
  // gravar o documento de novo toda vez que alguém abria um design pra só
  // olhar - trabalho pesado disputando rede e as 3 conexões do pool logo no
  // momento em que as imagens da página ainda estão carregando. Documento já
  // com thumbnail continua se atualizando pelo autosave (a cada 30s de
  // edição de verdade), que é quando a prévia realmente mudou.
  useEffect(() => {
    if (!editor.isReady || document.thumbnailUrl) return;
    void updateThumbnailRef.current(true);
  }, [editor.isReady]);

  function handleWheelZoom(deltaY: number, _clientX: number, _clientY: number) {
    const next = editor.zoom - deltaY * 0.001;
    editor.setZoom(Math.min(4, Math.max(0.1, next)));
  }

  function handleOpenCrop() {
    const frame = editor.getActiveImageFrame();
    if (!frame) {
      toast('Recorte não é suportado com a imagem rotacionada.', 'error');
      return;
    }
    setCropFrame(frame);
  }

  /** Roda 100% no navegador (modelo ONNX via WASM, ver background-removal.ts) -
   * pode levar alguns segundos na primeira vez (baixa o modelo). O resultado
   * (PNG com transparência) precisa virar um asset PERMANENTE no Storage antes
   * de virar `src` do objeto: um blob: URL só existe nesta aba/sessão e
   * quebraria a imagem pra sempre ao reabrir o documento depois. */
  async function handleRemoveBackground() {
    if (editor.selection.type !== 'image' || editor.selection.object?.type !== 'image') return;
    const originalSrc = editor.selection.object.src;
    setRemovingBackground(true);
    try {
      const blob = await removeImageBackground(originalSrc);
      const file = new File([blob], 'sem-fundo.png', { type: 'image/png' });
      const uploaded = await uploadReference.mutateAsync(file);
      await editor.replaceSelectedImageSrc(uploaded.url);
      toast('Fundo removido.', 'success');
    } catch {
      toast('Não foi possível remover o fundo desta imagem. Tente de novo.', 'error');
    } finally {
      setRemovingBackground(false);
    }
  }

  async function handleReplaceOrAddImage(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    try {
      const result = await uploadReference.mutateAsync(file);
      addRecentUpload({ url: result.url, filename: result.filename });
      if (editor.selection.type === 'image') {
        await editor.replaceSelectedImageSrc(result.url);
      } else {
        await editor.addImageFromSrc(result.url);
      }
    } catch {
      toast('Não foi possível enviar a imagem.', 'error');
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <CanvaTopbar
        editor={editor}
        documentName={document.name}
        saveStatus={saveStatus}
        onBack={onBack}
        onRenameDocument={(name) => updateDocument.mutate({ name })}
      />

      <div className="flex min-h-0 flex-1">
        <CanvaSidebar clientId={document.clientId} editor={editor} onOpenDocument={onOpenDocument} />

        <div className="relative flex min-h-0 flex-1 flex-col">
          <CanvasStage
            containerRef={editor.containerRef}
            canvasElRef={editor.canvasElRef}
            documentWidth={document.width}
            documentHeight={document.height}
            zoom={editor.zoom}
            guides={editor.guides}
            onWheelZoom={handleWheelZoom}
            onDropFile={(file) => void editor.addImageFromFile(file)}
            onDropUrl={(url) => void editor.addImageFromSrc(url)}
            overlay={
              cropFrame && (
                <CropOverlay
                  frame={cropFrame}
                  zoom={editor.zoom}
                  onCancel={() => setCropFrame(null)}
                  onApply={(rect) => {
                    editor.applyCrop(rect);
                    setCropFrame(null);
                  }}
                />
              )
            }
          />

          {!cropFrame && (
            <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
              <div className="pointer-events-auto">
                <FloatingToolbar
                  editor={editor}
                  clientId={document.clientId}
                  onOpenBackground={() => setBackgroundModalOpen(true)}
                  onReplaceImage={() => replaceFileInputRef.current?.click()}
                  onOpenCrop={handleOpenCrop}
                  onRemoveBackground={() => void handleRemoveBackground()}
                  removingBackground={removingBackground}
                />
              </div>
            </div>
          )}

          <input
            ref={replaceFileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => {
              const files = event.target.files;
              void handleReplaceOrAddImage(files).finally(() => {
                event.target.value = '';
              });
            }}
          />
        </div>
      </div>

      <PagesBar editor={editor} documentWidth={document.width} documentHeight={document.height} />

      <AnimatePresence>
        {backgroundModalOpen && <BackgroundModal editor={editor} onClose={() => setBackgroundModalOpen(false)} />}
      </AnimatePresence>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import type { CanvaDocument } from '@/lib/api/contracts';
import type { CanvaPage } from '@desigual-os/types';
import { useCanvaEditor } from '@/hooks/use-canva-editor';
import { useUpdateCanvaDocument } from '@/hooks/use-canva-documents';
import { ApiRequestError } from '@/lib/api/client';
import { useUploadStudioReference } from '@/hooks/use-studio-jobs';
import { CanvaTopbar } from './canva-topbar';
import { CanvaSidebar } from './canva-sidebar';
import { CanvaToolRail } from './canva-tool-rail';
import { CanvaToolOptions } from './canva-tool-options';
import { CanvaStatusBar } from './canva-status-bar';
import { CanvasStage } from './canvas-stage';
import { PropertiesPanel } from './properties/properties-panel';
import { useBrandKit } from '@/hooks/use-brand-kit';
import { PagesBar } from './pages-bar';
import { BackgroundModal } from './background-modal';
import { CropOverlay, type CropFrame } from './crop-overlay';
import { removeImageBackground } from '@/lib/canva/background-removal';
import { useCanvaRecentUploadsStore } from '@/stores/canva-recent-uploads-store';
import { criarAutosave, type AutosaveStatus } from '@/lib/canva/autosave';
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
  // Brand Kit do cliente alimenta o seletor de cor do painel (mesma fonte que
  // a aba Marca já usa - não é uma segunda lista de cores).
  const { data: brandKit } = useBrandKit(document.clientId);

  /**
   * Redimensiona a PRANCHETA, não o conteúdo.
   *
   * Reescalar objetos junto seria uma decisão de arte tomada pelo editor;
   * aqui o documento muda de tamanho e cada objeto fica exatamente onde
   * estava - quem ficar fora continua existindo e pode ser reposicionado.
   */
  const redimensionarDocumento = useCallback(
    (width: number, height: number) => {
      if (width === document.width && height === document.height) return;
      updateDocument.mutate({ width, height });
    },
    [updateDocument, document.width, document.height],
  );
  const [saveStatus, setSaveStatus] = useState<AutosaveStatus>('idle');
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

  // Ref pra o autosave (criado uma vez só) poder chamar sempre a versão mais
  // recente de `updateThumbnail` e de `updateDocument`, sem recriar o
  // agendador a cada render - mesmo padrão de `onChangeRef` em
  // use-canva-editor.ts. Referenciar `.current` aqui é seguro mesmo
  // declarado antes: só roda de verdade bem depois (debounce/unmount).
  const updateThumbnailRef = useRef<(force?: boolean) => Promise<void>>(async () => {});
  const gravarPaginasRef = useRef<(pages: CanvaPage[], keepalive: boolean) => Promise<void>>(async () => {});
  gravarPaginasRef.current = async (pages, keepalive) => {
    await updateDocument.mutateAsync({ pages, keepalive });
  };

  /**
   * Um agendador de salvamento só, criado uma vez por documento aberto.
   *
   * Ver o comentário de lib/canva/autosave.ts: o "reorder que voltava atrás
   * no F5" não era o reorder, era esta camada. O status agora acompanha o
   * estado real (uma alteração pendente NUNCA aparece como "Salvo") e o
   * pendente é gravado no descarregamento da página, em vez de morrer junto
   * com o timer.
   */
  const autosave = useMemo(
    () =>
      criarAutosave<CanvaPage[]>({
        debounceMs: AUTOSAVE_DEBOUNCE_MS,
        salvar: async (pages, { keepalive }) => {
          await gravarPaginasRef.current(pages, keepalive);
          void updateThumbnailRef.current();
        },
        onStatus: setSaveStatus,
        // 409 é um desfecho DIFERENTE de falha de rede e precisa de outra
        // instrução: outra pessoa salvou este mesmo design enquanto esta aba
        // editava (o workspace do cliente é compartilhado pela equipe). Mandar
        // "tente novamente" aqui seria pedir um laço que nunca fecha - a
        // versão local continua velha, então toda tentativa recebe 409 de
        // volta. Quem precisa agir é a pessoa, recarregando antes de seguir.
        onErro: (erro) =>
          toast(
            erro instanceof ApiRequestError && erro.status === 409
              ? 'Outra pessoa salvou este design enquanto você editava. Recarregue a página para ver a versão atual antes de continuar.'
              : 'Não conseguimos salvar as últimas alterações. Tente novamente.',
            'error',
          ),
      }),
    [],
  );

  const handleChange = useCallback((pages: CanvaPage[]) => autosave.agendar(pages), [autosave]);

  /**
   * Grava o pendente antes da aba sumir.
   *
   * `pagehide` é o único evento que dispara de forma confiável em F5, fechar
   * aba e navegação no iOS; `visibilitychange` cobre o caso de trocar de aba
   * e nunca mais voltar. `keepalive` faz o navegador terminar o envio mesmo
   * depois que o documento morreu - sem ele, a requisição é cancelada no meio
   * e a edição se perde exatamente como antes.
   */
  useEffect(() => {
    // `document` aqui é a PROP deste componente (o desenho), não o do DOM.
    const dom = globalThis.document;
    const aoSair = () => { void autosave.flush({ keepalive: true }); };
    const aoEsconder = () => { if (dom.visibilityState === 'hidden') aoSair(); };
    window.addEventListener('pagehide', aoSair);
    dom.addEventListener('visibilitychange', aoEsconder);
    return () => {
      window.removeEventListener('pagehide', aoSair);
      dom.removeEventListener('visibilitychange', aoEsconder);
      void autosave.encerrar();
    };
  }, [autosave]);

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
        documentWidth={document.width}
        documentHeight={document.height}
        onBack={onBack}
        onRenameDocument={(name) => updateDocument.mutate({ name })}
      />

      <div className="flex min-h-0 flex-1">
        <CanvaToolRail editor={editor} />
        <CanvaSidebar clientId={document.clientId} editor={editor} onOpenDocument={onOpenDocument} />

        <div className="relative flex min-h-0 flex-1 flex-col">
          <CanvaToolOptions editor={editor} />
          <CanvasStage
            containerRef={editor.containerRef}
            canvasElRef={editor.canvasElRef}
            documentWidth={document.width}
            documentHeight={document.height}
            zoom={editor.zoom}
            guides={editor.guides}
            onZoomChange={editor.setZoom}
            onViewportChange={editor.recalcPointerOffset}
            activeTool={editor.activeTool}
            eraserWidth={editor.eraserWidth}
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

        <PropertiesPanel
          editor={editor}
          documentWidth={document.width}
          documentHeight={document.height}
          onResize={redimensionarDocumento}
          brandColors={brandKit?.colors ?? []}
          brandFonts={brandKit?.fonts ?? []}
          onOpenBackground={() => setBackgroundModalOpen(true)}
          onReplaceImage={() => replaceFileInputRef.current?.click()}
          onOpenCrop={handleOpenCrop}
          onRemoveBackground={() => void handleRemoveBackground()}
          removingBackground={removingBackground}
        />
      </div>

      <PagesBar editor={editor} documentWidth={document.width} documentHeight={document.height} />

      <CanvaStatusBar editor={editor} saveStatus={saveStatus} documentWidth={document.width} documentHeight={document.height} />

      <AnimatePresence>
        {backgroundModalOpen && <BackgroundModal editor={editor} onClose={() => setBackgroundModalOpen(false)} />}
      </AnimatePresence>
    </div>
  );
}

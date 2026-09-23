'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { CanvaGuides, CanvaTool } from '@/hooks/use-canva-editor';
import { centerViewport, clampPan, panBy, zoomAtPointer, zoomFromWheel, type Viewport } from '@/lib/canva/viewport-math';

/**
 * Workspace cinza + artboard branca central (pedido explícito de layout).
 * Zoom é feito via CSS transform no wrapper da artboard, não pelo zoom
 * interno do Fabric - mantém o sistema de coordenadas (x/y/width/height)
 * igual ao documento em qualquer nível de zoom, sem precisar converter
 * coordenadas de mouse manualmente (Fabric já calcula o pointer certo a
 * partir do getBoundingClientRect() real do elemento, que já reflete o scale).
 */
export function CanvasStage({
  containerRef,
  canvasElRef,
  documentWidth,
  documentHeight,
  zoom,
  guides,
  onZoomChange,
  onViewportChange,
  overlay,
  onDropFile,
  onDropUrl,
  activeTool = 'select',
  eraserWidth = 24,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  canvasElRef: RefObject<HTMLCanvasElement | null>;
  documentWidth: number;
  documentHeight: number;
  zoom: number;
  guides: CanvaGuides;
  /** Novo zoom pedido por roda/pinch. A ancoragem no cursor é feita aqui dentro. */
  onZoomChange: (next: number) => void;
  /** Avisa o Fabric que o canvas mudou de lugar na tela (ver recalcPointerOffset). */
  onViewportChange?: () => void;
  /** Renderizado dentro do MESMO wrapper com transform:scale(zoom) do canvas -
   * pra overlays (ex: CropOverlay) que precisam compartilhar o sistema de
   * coordenadas em pixels de documento. */
  overlay?: ReactNode;
  /** Drag de arquivo do computador pra dentro do editor. */
  onDropFile?: (file: File) => void;
  /** Drag de uma imagem do painel "Imagens"/"Marca"/"Uploads" (URL, não arquivo). */
  onDropUrl?: (url: string) => void;
  /** Tool ativa do editor - muda cursor e o gesto de pan (hand paneia com o
   * botão esquerdo direto, sem Space). */
  activeTool?: CanvaTool;
  /** Diâmetro do cursor-círculo da borracha (px de documento). */
  eraserWidth?: number;
}) {
  const artboardRef = useRef<HTMLDivElement>(null);
  const [panning, setPanning] = useState(false);
  const spaceRef = useRef(false);
  const [viewport, setViewport] = useState<Viewport>({ zoom, panX: 0, panY: 0 });
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  /** Posição do ponteiro no container pro cursor-círculo da borracha (overlay
   * HTML é mais confiável que CSS cursor custom - acompanha o zoom). */
  const [eraserCursor, setEraserCursor] = useState<{ x: number; y: number } | null>(null);

  const tamanhoContainer = useCallback(() => {
    const el = containerRef.current;
    return { width: el?.clientWidth ?? 0, height: el?.clientHeight ?? 0 };
  }, [containerRef]);

  const doc = { width: documentWidth, height: documentHeight };

  // Toda vez que a artboard se move/redimensiona na tela, o Fabric precisa
  // recalcular onde ela está - senão o ponteiro chega deslocado e a seleção
  // simplesmente não acontece.
  useLayoutEffect(() => {
    onViewportChange?.();
  }, [viewport, onViewportChange]);

  /**
   * O zoom continua sendo propriedade do editor (topbar, encaixar, atalhos);
   * o pan é só desta tela. Quando o zoom muda POR FORA (botão, encaixar),
   * recentra - é o comportamento esperado de "ajustar zoom" pela UI. O zoom
   * por cursor atualiza os dois juntos e marca `ancorado` pra não recentrar.
   */
  const ancoradoRef = useRef(false);
  useEffect(() => {
    if (ancoradoRef.current) {
      ancoradoRef.current = false;
      return;
    }
    const container = tamanhoContainer();
    if (container.width === 0 || container.height === 0) return;
    setViewport(centerViewport(zoom, container, { width: documentWidth, height: documentHeight }));
  }, [zoom, documentWidth, documentHeight, tamanhoContainer]);

  /**
   * O efeito acima só recentra quando o ZOOM muda - e quando a pessoa já
   * escolheu um zoom manualmente (topbar/atalho), o auto-fit do editor
   * (use-canva-editor.ts) para de mexer no zoom em resize. Se o container
   * encolhe depois disso (janela redimensionada, layout assentando depois de
   * fonte/imagem carregar, sidebar reabrindo painel), o pan antigo passa a
   * apontar pra fora da área visível e a artboard fica parcialmente
   * inalcançável atrás do `overflow-hidden` do container - sem centralizar de
   * novo (isso desfaria o zoom escolhido), só reancorando pan pra dentro dos
   * limites de `clampPan`.
   */
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      setViewport((v) => clampPan(v, { width, height }, { width: documentWidth, height: documentHeight }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerRef, documentWidth, documentHeight]);

  function handleWheel(event: React.WheelEvent) {
    // ctrl/meta + roda é também como o macOS entrega o pinch do trackpad.
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const atual = viewportRef.current;
    const proximo = zoomAtPointer(atual, zoomFromWheel(atual.zoom, event.deltaY), pointer);
    ancoradoRef.current = true;
    setViewport(clampPan(proximo, tamanhoContainer(), doc));
    onZoomChange(proximo.zoom);
  }

  /**
   * Pan move só o viewport - não toca em objeto, não entra no histórico e não
   * dispara autosave, porque nada do documento muda.
   *
   * Space só vira pan quando o foco não está num campo de texto: caso
   * contrário digitar um espaço no nome de uma camada arrastaria a tela.
   */
  useEffect(() => {
    function digitando(): boolean {
      const ativo = document.activeElement;
      if (!ativo) return false;
      const tag = ativo.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || ativo.getAttribute('contenteditable') === 'true';
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.code !== 'Space' || digitando()) return;
      event.preventDefault(); // senão a página rola e o botão focado dispara
      spaceRef.current = true;
      setPanning(true);
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.code !== 'Space') return;
      spaceRef.current = false;
      setPanning(false);
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  function handlePointerDown(event: React.PointerEvent) {
    // Botão do meio sempre paneia; esquerdo com Space segurado (pan temporário
    // sobre qualquer tool) ou com a tool "Mover" ativa - fora isso, o clique
    // é da seleção/arraste de objeto do Fabric.
    const meio = event.button === 1;
    if (!meio && !(event.button === 0 && (spaceRef.current || activeTool === 'hand'))) return;
    event.preventDefault();
    event.stopPropagation();
    setPanning(true);
    let ultimo = { x: event.clientX, y: event.clientY };
    const mover = (e: PointerEvent) => {
      const delta = { x: e.clientX - ultimo.x, y: e.clientY - ultimo.y };
      ultimo = { x: e.clientX, y: e.clientY };
      setViewport((v) => clampPan(panBy(v, delta.x, delta.y), tamanhoContainer(), doc));
    };
    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      if (!spaceRef.current) setPanning(false);
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  }

  function handleDragOver(event: React.DragEvent) {
    event.preventDefault();
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      onDropFile?.(file);
      return;
    }
    const url = event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain');
    if (url) onDropUrl?.(url);
  }

  function handlePointerMove(event: React.PointerEvent) {
    if (activeTool !== 'eraser') return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setEraserCursor({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  }

  // Cursor por tool: hand=grab/grabbing (pan), conta-gotas=crosshair,
  // texto=I-beam, borracha=nenhum (o círculo-overlay faz as vezes de cursor).
  const cursorClass =
    panning
      ? 'cursor-grabbing'
      : activeTool === 'hand'
        ? 'cursor-grab'
        : activeTool === 'eyedropper'
          ? 'cursor-crosshair'
          : activeTool === 'eraser'
            ? 'cursor-none'
            : activeTool === 'text'
              ? 'cursor-text'
              : '';

  return (
    <div
      ref={containerRef}
      data-canva-workspace=""
      tabIndex={0}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setEraserCursor(null)}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={`relative h-full min-h-0 flex-1 overflow-hidden bg-carbono outline-none ${cursorClass}`}
      style={{
        backgroundImage:
          'linear-gradient(45deg, #1c1c1e 25%, transparent 25%), linear-gradient(-45deg, #1c1c1e 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1c1c1e 75%), linear-gradient(-45deg, transparent 75%, #1c1c1e 75%)',
        backgroundSize: '20px 20px',
        backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
        backgroundColor: '#0f0f0f',
      }}
    >
      <div
        ref={artboardRef}
        data-canva-artboard=""
        className="absolute left-0 top-0 shadow-elevated"
        style={{
          width: documentWidth * viewport.zoom,
          height: documentHeight * viewport.zoom,
          transform: `translate(${viewport.panX}px, ${viewport.panY}px)`,
        }}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ width: documentWidth, height: documentHeight, transform: `scale(${viewport.zoom})` }}
        >
          <canvas ref={canvasElRef} width={documentWidth} height={documentHeight} />

          {guides.vertical.map((x) => (
            <div
              key={`v-${x}`}
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-sinal"
              style={{ left: x }}
            />
          ))}
          {guides.horizontal.map((y) => (
            <div
              key={`h-${y}`}
              className="pointer-events-none absolute left-0 right-0 h-px bg-sinal"
              style={{ top: y }}
            />
          ))}

          {overlay}
        </div>
      </div>

      {/* Cursor-círculo da borracha: overlay HTML acompanhando o zoom real
       * (CSS `cursor:` com SVG inline não escala nem é confiável cross-browser). */}
      {activeTool === 'eraser' && eraserCursor && (
        <div
          data-canva-eraser-cursor=""
          className="pointer-events-none absolute rounded-full border border-branco-cru/80 bg-branco-cru/10"
          style={{
            left: eraserCursor.x,
            top: eraserCursor.y,
            width: eraserWidth * viewport.zoom,
            height: eraserWidth * viewport.zoom,
            transform: 'translate(-50%, -50%)',
          }}
        />
      )}
    </div>
  );
}

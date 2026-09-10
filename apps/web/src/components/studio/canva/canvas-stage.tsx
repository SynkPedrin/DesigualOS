'use client';

import type { ReactNode, RefObject } from 'react';
import type { CanvaGuides } from '@/hooks/use-canva-editor';

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
  onWheelZoom,
  overlay,
  onDropFile,
  onDropUrl,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  canvasElRef: RefObject<HTMLCanvasElement | null>;
  documentWidth: number;
  documentHeight: number;
  zoom: number;
  guides: CanvaGuides;
  onWheelZoom: (deltaY: number, clientX: number, clientY: number) => void;
  /** Renderizado dentro do MESMO wrapper com transform:scale(zoom) do canvas -
   * pra overlays (ex: CropOverlay) que precisam compartilhar o sistema de
   * coordenadas em pixels de documento. */
  overlay?: ReactNode;
  /** Drag de arquivo do computador pra dentro do editor. */
  onDropFile?: (file: File) => void;
  /** Drag de uma imagem do painel "Imagens"/"Marca"/"Uploads" (URL, não arquivo). */
  onDropUrl?: (url: string) => void;
}) {
  function handleWheel(event: React.WheelEvent) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    onWheelZoom(event.deltaY, event.clientX, event.clientY);
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

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onWheel={handleWheel}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="relative flex h-full min-h-0 flex-1 items-center justify-center overflow-auto bg-carbono outline-none"
      style={{
        backgroundImage:
          'linear-gradient(45deg, #1c1c1e 25%, transparent 25%), linear-gradient(-45deg, #1c1c1e 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1c1c1e 75%), linear-gradient(-45deg, transparent 75%, #1c1c1e 75%)',
        backgroundSize: '20px 20px',
        backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
        backgroundColor: '#0f0f0f',
      }}
    >
      <div
        className="relative shrink-0 shadow-elevated"
        style={{
          width: documentWidth * zoom,
          height: documentHeight * zoom,
        }}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ width: documentWidth, height: documentHeight, transform: `scale(${zoom})` }}
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
    </div>
  );
}

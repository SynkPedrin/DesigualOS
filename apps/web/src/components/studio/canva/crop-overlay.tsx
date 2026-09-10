'use client';

import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CropFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

const ASPECT_OPTIONS: { label: string; ratio: number | null }[] = [
  { label: 'Livre', ratio: null },
  { label: '1:1', ratio: 1 },
  { label: '4:5', ratio: 4 / 5 },
  { label: '9:16', ratio: 9 / 16 },
  { label: '16:9', ratio: 16 / 9 },
];

type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

export function clampRect(rect: { x: number; y: number; width: number; height: number }, bounds: { width: number; height: number }) {
  const width = Math.min(Math.max(rect.width, 20), bounds.width);
  const height = Math.min(Math.max(rect.height, 20), bounds.height);
  const x = Math.min(Math.max(rect.x, 0), bounds.width - width);
  const y = Math.min(Math.max(rect.y, 0), bounds.height - height);
  return { x, y, width, height };
}

/**
 * Overlay de recorte real: renderizado DENTRO do mesmo wrapper com
 * transform:scale(zoom) do CanvasStage (por isso recebe `frame` já em
 * pixels de DOCUMENTO, não de tela) - arrastar/redimensionar dividem o
 * movimento do mouse por `zoom` pra converter de volta pra pixels de
 * documento. Só rotation=0 é suportado (ver getActiveImageFrame).
 */
export function CropOverlay({
  frame,
  zoom,
  onApply,
  onCancel,
}: {
  frame: CropFrame;
  zoom: number;
  onApply: (rect: { x: number; y: number; width: number; height: number }) => void;
  onCancel: () => void;
}) {
  const [rect, setRect] = useState({ x: 0, y: 0, width: frame.width, height: frame.height });
  const [aspect, setAspect] = useState<number | null>(null);

  function applyAspect(ratio: number | null) {
    setAspect(ratio);
    if (ratio === null) return;
    setRect((current) => {
      let width = current.width;
      let height = width / ratio;
      if (height > frame.height) {
        height = frame.height;
        width = height * ratio;
      }
      return clampRect({ x: current.x, y: current.y, width, height }, frame);
    });
  }

  function startDrag(handle: Handle, startEvent: React.PointerEvent) {
    startEvent.preventDefault();
    startEvent.stopPropagation();
    const startX = startEvent.clientX;
    const startY = startEvent.clientY;
    const startRect = { ...rect };

    function onMove(event: PointerEvent) {
      const dx = (event.clientX - startX) / zoom;
      const dy = (event.clientY - startY) / zoom;

      setRect(() => {
        if (handle === 'move') {
          return clampRect({ ...startRect, x: startRect.x + dx, y: startRect.y + dy }, frame);
        }
        let { x, y, width, height } = startRect;
        if (handle === 'se') {
          width = startRect.width + dx;
          height = aspect ? width / aspect : startRect.height + dy;
        } else if (handle === 'nw') {
          width = startRect.width - dx;
          height = aspect ? width / aspect : startRect.height - dy;
          x = startRect.x + dx;
          y = startRect.y + (aspect ? startRect.height - height : dy);
        } else if (handle === 'ne') {
          width = startRect.width + dx;
          height = aspect ? width / aspect : startRect.height - dy;
          y = startRect.y + (aspect ? startRect.height - height : dy);
        } else if (handle === 'sw') {
          width = startRect.width - dx;
          height = aspect ? width / aspect : startRect.height + dy;
          x = startRect.x + dx;
        }
        return clampRect({ x, y, width, height }, frame);
      });
    }

    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  const handleClasses = 'absolute size-3 rounded-full border-2 border-roxo-eletrico bg-branco-cru shadow-elevated';

  return (
    <div
      className="absolute z-20"
      style={{ left: frame.left, top: frame.top, width: frame.width, height: frame.height }}
    >
      <div className="absolute inset-0 bg-carbono/70" style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%)' }} />
      <div
        className="absolute cursor-move border-2 border-roxo-eletrico"
        style={{
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
          boxShadow: `0 0 0 9999px rgba(15,15,15,0.7)`,
        }}
        onPointerDown={(event) => startDrag('move', event)}
      >
        {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
          <div
            key={corner}
            onPointerDown={(event) => startDrag(corner, event)}
            className={cn(
              handleClasses,
              corner === 'nw' && '-left-1.5 -top-1.5 cursor-nwse-resize',
              corner === 'ne' && '-right-1.5 -top-1.5 cursor-nesw-resize',
              corner === 'sw' && '-left-1.5 -bottom-1.5 cursor-nesw-resize',
              corner === 'se' && '-right-1.5 -bottom-1.5 cursor-nwse-resize',
            )}
          />
        ))}
      </div>

      <div className="absolute -bottom-12 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-grafite-elevado bg-grafite p-1 shadow-elevated">
        {ASPECT_OPTIONS.map((option) => (
          <button
            key={option.label}
            type="button"
            onClick={() => applyAspect(option.ratio)}
            className={cn(
              'rounded-md px-2 py-1 text-[10px] font-medium transition-colors',
              aspect === option.ratio ? 'bg-roxo-eletrico text-branco-cru' : 'text-nevoa hover:text-branco-cru',
            )}
          >
            {option.label}
          </button>
        ))}
        <div className="mx-1 h-4 w-px bg-grafite-elevado" />
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancelar recorte"
          className="flex size-6 items-center justify-center rounded-md text-nevoa transition-colors hover:bg-grafite-elevado hover:text-branco-cru"
        >
          <X size={13} />
        </button>
        <button
          type="button"
          onClick={() => onApply(rect)}
          aria-label="Aplicar recorte"
          className="flex size-6 items-center justify-center rounded-md bg-roxo-eletrico text-branco-cru transition-colors hover:opacity-90"
        >
          <Check size={13} />
        </button>
      </div>
    </div>
  );
}

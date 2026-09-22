'use client';

import type { UseCanvaEditorResult } from '@/hooks/use-canva-editor';
import { ColorPicker } from './color/color-picker';
import { normalizeColor } from '@/lib/canva/color';
import type { CanvaBrushType } from '@/lib/canva/brush';
import { cn } from '@/lib/utils';

const BRUSH_TYPES: { id: CanvaBrushType; label: string }[] = [
  { id: 'lapis', label: 'Lápis' },
  { id: 'caneta', label: 'Caneta' },
  { id: 'marca-texto', label: 'Marca-texto' },
];

function OptionSlider({
  label,
  min,
  max,
  value,
  suffix,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[11px] text-nevoa">
      <span className="w-20 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-28 accent-roxo-eletrico"
      />
      <span className="w-10 shrink-0 text-right font-mono text-[10px]">
        {value}
        {suffix ?? ''}
      </span>
    </label>
  );
}

/**
 * Faixa de opções da ferramenta ativa (topo da área central, abaixo da
 * topbar). Só renderiza pras tools que TÊM opções (brush/eraser/eyedropper);
 * select/hand/text não mostram nada.
 */
export function CanvaToolOptions({ editor }: { editor: UseCanvaEditorResult }) {
  const shell = 'flex h-10 shrink-0 items-center gap-4 border-b border-grafite-elevado bg-grafite/60 px-4';

  if (editor.activeTool === 'brush') {
    return (
      <div className={shell} data-canva-tool-options="brush">
        <ColorPicker
          valor={editor.brushColor}
          onPreview={editor.setBrushColor}
          onCommit={editor.setBrushColor}
          label="Cor do pincel"
        />
        <OptionSlider label="Tamanho" min={1} max={100} value={editor.brushWidth} onChange={editor.setBrushWidth} />
        <OptionSlider label="Opacidade" min={0} max={100} value={editor.brushOpacity} suffix="%" onChange={editor.setBrushOpacity} />
        <OptionSlider label="Suavização" min={0} max={100} value={editor.brushSmoothing} suffix="%" onChange={editor.setBrushSmoothing} />
        <div className="flex items-center gap-0.5 rounded-md border border-grafite-elevado p-0.5">
          {BRUSH_TYPES.map((type) => (
            <button
              key={type.id}
              type="button"
              onClick={() => editor.setBrushType(type.id)}
              aria-pressed={editor.brushType === type.id}
              className={cn(
                'rounded px-2 py-0.5 text-[11px] transition-colors',
                editor.brushType === type.id ? 'bg-roxo-eletrico text-branco-cru' : 'text-nevoa hover:text-branco-cru',
              )}
            >
              {type.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => editor.setBrushPressure(!editor.brushPressure)}
          aria-pressed={editor.brushPressure}
          title="Largura do traço responde à pressão de canetinhas (pointer pen)"
          className={cn(
            'rounded-md border px-2 py-0.5 text-[11px] transition-colors',
            editor.brushPressure ? 'border-roxo-eletrico bg-roxo-eletrico/10 text-branco-cru' : 'border-grafite-elevado text-nevoa hover:text-branco-cru',
          )}
        >
          Pressão
        </button>
      </div>
    );
  }

  if (editor.activeTool === 'eraser') {
    return (
      <div className={shell} data-canva-tool-options="eraser">
        <OptionSlider label="Tamanho" min={4} max={120} value={editor.eraserWidth} onChange={editor.setEraserWidth} />
        <p className="text-[10px] text-nevoa/70">Arraste sobre um traço para apagá-lo inteiro, ou sobre uma imagem para apagar pixels.</p>
      </div>
    );
  }

  if (editor.activeTool === 'eyedropper') {
    const cor = editor.lastPickedColor ? normalizeColor(editor.lastPickedColor) : null;
    return (
      <div className={shell} data-canva-tool-options="eyedropper">
        {cor ? (
          <div className="flex items-center gap-2">
            <span className="size-5 rounded border border-grafite-elevado" style={{ backgroundColor: cor }} />
            <span className="font-mono text-[11px] text-branco-cru">{cor}</span>
          </div>
        ) : (
          <p className="text-[11px] text-nevoa">Clique em qualquer ponto da arte para capturar a cor.</p>
        )}
      </div>
    );
  }

  return null;
}

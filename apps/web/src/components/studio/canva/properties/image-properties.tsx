'use client';

import { useState } from 'react';
import { Circle, Crop, FlipHorizontal, FlipVertical, Image as ImageIcon, Loader2, Pentagon, Square, Star, Wand2 } from 'lucide-react';
import type { CanvaImageObject, CanvaShapeKind } from '@desigual-os/types';
import type { UseCanvaEditorResult } from '@/hooks/use-canva-editor';
import { ColorPicker } from '../color/color-picker';
import { cn } from '@/lib/utils';

const MASK_SHAPE_ICONS: Record<Exclude<CanvaShapeKind, 'line'>, typeof Square> = {
  rect: Square,
  ellipse: Circle,
  triangle: Pentagon,
  star: Star,
};
const MASK_SHAPE_LABELS: Record<Exclude<CanvaShapeKind, 'line'>, string> = {
  rect: 'Sem máscara',
  ellipse: 'Elipse',
  triangle: 'Triângulo',
  star: 'Estrela',
};

/**
 * Propriedades de IMAGEM.
 *
 * Reaproveita a infraestrutura de filtros que já existia
 * (`updateSelectedImageFilters` + `buildCssFilterString` em fabric-sync):
 * nada aqui é um filtro novo, é o mesmo pipeline **não destrutivo** exposto
 * no painel. O `src` original nunca é reescrito — por isso desfazer um
 * filtro devolve a imagem exata, sem perda de qualidade acumulada.
 *
 * Recortar/substituir/remover fundo viviam só na FloatingToolbar sobre o
 * canvas; movidos pra cá pelo mesmo motivo das ações de camada (ver
 * AcoesDeCamada em properties-panel.tsx) - tudo que age sobre a seleção mora
 * na sidebar, nunca numa barra flutuante que pode ficar coberta.
 */
export function ImageProperties({
  imagem, editor, brandColors, onReplaceImage, onOpenCrop, onRemoveBackground, removingBackground,
}: {
  imagem: CanvaImageObject;
  editor: UseCanvaEditorResult;
  brandColors: string[];
  onReplaceImage: () => void;
  onOpenCrop: () => void;
  onRemoveBackground: () => void;
  removingBackground: boolean;
}) {
  const [maskOpen, setMaskOpen] = useState(false);
  const filtros = imagem.filters ?? {};
  const currentMask = imagem.clipShape ?? 'rect';

  function Deslizante({
    label, chave, min, max, step, padrao,
  }: { label: string; chave: 'brightness' | 'contrast' | 'saturation' | 'blur' | 'hueRotate' | 'sharpen'; min: number; max: number; step: number; padrao: number }) {
    const valor = filtros[chave] ?? padrao;
    return (
      <label className="mt-1.5 flex items-center gap-2">
        <span className="w-16 shrink-0 font-mono text-[10px] uppercase text-nevoa">{label}</span>
        <input
          type="range"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={valor}
          // Arrastar gera preview; o commit vem no pointerup - uma passada no
          // slider é UMA entrada de histórico, não uma por pixel.
          onChange={(e) => editor.updateSelectedImageFilters({ [chave]: Number(e.target.value) }, { preview: true })}
          onPointerUp={(e) => editor.updateSelectedImageFilters({ [chave]: Number((e.target as HTMLInputElement).value) })}
          onKeyUp={(e) => editor.updateSelectedImageFilters({ [chave]: Number((e.target as HTMLInputElement).value) })}
          className="flex-1 accent-roxo-eletrico"
        />
        <span className="w-8 text-right font-mono text-[10px] text-nevoa">{Number(valor).toFixed(step < 1 ? 2 : 0)}</span>
      </label>
    );
  }

  return (
    <div className="border-b border-grafite-elevado px-3 py-3">
      <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-nevoa">Imagem</p>

      <div className="flex gap-1">
        <button
          type="button"
          aria-label="Recortar"
          title="Recortar"
          onClick={onOpenCrop}
          className="flex size-7 items-center justify-center rounded border border-grafite-elevado text-nevoa transition-colors hover:border-roxo-eletrico/60 hover:text-branco-cru"
        >
          <Crop size={13} />
        </button>
        <button
          type="button"
          aria-label="Substituir imagem"
          title="Substituir imagem"
          onClick={onReplaceImage}
          className="flex size-7 items-center justify-center rounded border border-grafite-elevado text-nevoa transition-colors hover:border-roxo-eletrico/60 hover:text-branco-cru"
        >
          <ImageIcon size={13} />
        </button>
        <button
          type="button"
          aria-label={removingBackground ? 'Removendo fundo…' : 'Remover fundo'}
          title={removingBackground ? 'Removendo fundo…' : 'Remover fundo'}
          disabled={removingBackground}
          onClick={onRemoveBackground}
          className="flex size-7 items-center justify-center rounded border border-grafite-elevado text-nevoa transition-colors hover:border-roxo-eletrico/60 hover:text-branco-cru disabled:opacity-50"
        >
          {removingBackground ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
        </button>
        <button
          type="button"
          aria-label="Espelhar na horizontal"
          title="Espelhar na horizontal"
          onClick={() => editor.flipSelected('x')}
          className="flex size-7 items-center justify-center rounded border border-grafite-elevado text-nevoa transition-colors hover:border-roxo-eletrico/60 hover:text-branco-cru"
        >
          <FlipHorizontal size={13} />
        </button>
        <button
          type="button"
          aria-label="Espelhar na vertical"
          title="Espelhar na vertical"
          onClick={() => editor.flipSelected('y')}
          className="flex size-7 items-center justify-center rounded border border-grafite-elevado text-nevoa transition-colors hover:border-roxo-eletrico/60 hover:text-branco-cru"
        >
          <FlipVertical size={13} />
        </button>
      </div>

      <Deslizante label="Brilho" chave="brightness" min={-0.5} max={0.5} step={0.05} padrao={0} />
      <Deslizante label="Contraste" chave="contrast" min={-0.5} max={0.5} step={0.05} padrao={0} />
      <Deslizante label="Saturação" chave="saturation" min={-1} max={1} step={0.05} padrao={0} />
      <Deslizante label="Desfoque" chave="blur" min={0} max={1} step={0.02} padrao={0} />
      <Deslizante label="Matiz" chave="hueRotate" min={0} max={360} step={1} padrao={0} />
      <Deslizante label="Nitidez" chave="sharpen" min={0} max={1} step={0.05} padrao={0} />

      <div className="mt-1.5 flex gap-1">
        <button
          type="button"
          onClick={() => editor.updateSelectedImageFilters({ ...filtros, grayscale: !filtros.grayscale })}
          className={cn(
            'flex-1 rounded border px-2 py-1 text-[10px] transition-colors',
            filtros.grayscale ? 'border-roxo-eletrico bg-roxo-eletrico/10 text-branco-cru' : 'border-grafite-elevado text-nevoa',
          )}
        >
          P&B
        </button>
        <button
          type="button"
          onClick={() => editor.updateSelectedImageFilters({ ...filtros, sepia: !filtros.sepia })}
          className={cn(
            'flex-1 rounded border px-2 py-1 text-[10px] transition-colors',
            filtros.sepia ? 'border-roxo-eletrico bg-roxo-eletrico/10 text-branco-cru' : 'border-grafite-elevado text-nevoa',
          )}
        >
          Sépia
        </button>
        <button
          type="button"
          onClick={() => editor.updateSelectedImageFilters({ ...filtros, invert: !filtros.invert })}
          className={cn(
            'flex-1 rounded border px-2 py-1 text-[10px] transition-colors',
            filtros.invert ? 'border-roxo-eletrico bg-roxo-eletrico/10 text-branco-cru' : 'border-grafite-elevado text-nevoa',
          )}
        >
          Inverter
        </button>
      </div>

      <button
        type="button"
        // `updateSelectedImageFilters` faz MERGE com os filtros existentes
        // (ver use-canva-editor.ts) - "limpar" precisa zerar/desligar cada
        // campo explicitamente, um objeto vazio não apagaria nada.
        onClick={() => editor.updateSelectedImageFilters({
          brightness: 0, contrast: 0, saturation: 0, blur: 0, hueRotate: 0, sharpen: 0,
          grayscale: false, sepia: false, invert: false,
        })}
        className="mt-2 w-full rounded border border-grafite-elevado px-2 py-1 text-[11px] text-nevoa transition-colors hover:border-roxo-eletrico/60 hover:text-branco-cru"
      >
        Limpar ajustes
      </button>

      <div className="mt-3">
        <p className="mb-1.5 font-mono text-[9px] uppercase tracking-wider text-nevoa">Borda</p>
        <div className="flex items-center gap-1.5">
          <ColorPicker
            label="Cor da borda"
            valor={imagem.stroke ?? '#ffffff'}
            brandColors={brandColors}
            documentColors={[]}
            onPreview={(cor) => editor.updateSelectedImageBorder({ stroke: cor })}
            onCommit={(cor) => editor.updateSelectedImageBorder({ stroke: cor })}
          />
          <input
            type="number"
            min={0}
            max={60}
            aria-label="Espessura da borda"
            value={imagem.strokeWidth ?? 0}
            onChange={(e) => editor.updateSelectedImageBorder({ strokeWidth: Number(e.target.value) })}
            className="h-8 w-16 flex-1 rounded border border-grafite-elevado bg-carbono px-1.5 text-center text-xs text-branco-cru outline-none focus:border-roxo-eletrico/60"
          />
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="font-mono text-[9px] uppercase tracking-wider text-nevoa">Máscara</p>
          <button
            type="button"
            onClick={() => setMaskOpen((v) => !v)}
            aria-expanded={maskOpen}
            className="font-mono text-[9px] uppercase tracking-wider text-roxo-eletrico"
          >
            {maskOpen ? 'Fechar' : currentMask === 'rect' ? 'Aplicar' : MASK_SHAPE_LABELS[currentMask]}
          </button>
        </div>
        {maskOpen && (
          <div className="flex gap-1">
            {(Object.keys(MASK_SHAPE_ICONS) as (keyof typeof MASK_SHAPE_ICONS)[]).map((shape) => {
              const Icon = MASK_SHAPE_ICONS[shape];
              const active = currentMask === shape;
              return (
                <button
                  key={shape}
                  type="button"
                  aria-label={MASK_SHAPE_LABELS[shape]}
                  title={MASK_SHAPE_LABELS[shape]}
                  onClick={() => {
                    editor.setSelectedImageClipShape(shape === 'rect' ? null : shape);
                    setMaskOpen(false);
                  }}
                  className={cn(
                    'flex size-8 flex-1 items-center justify-center rounded border transition-colors',
                    active ? 'border-roxo-eletrico text-branco-cru' : 'border-grafite-elevado text-nevoa hover:text-branco-cru',
                  )}
                >
                  <Icon size={14} />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

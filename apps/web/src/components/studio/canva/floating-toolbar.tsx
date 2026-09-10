'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Circle,
  Copy,
  FlipHorizontal,
  FlipVertical,
  Group as GroupIcon,
  Image as ImageIcon,
  Italic,
  Link2,
  Link2Off,
  Loader2,
  Lock,
  Minus,
  Palette,
  Crop,
  Pentagon,
  RotateCw,
  Rows,
  SlidersHorizontal,
  Square,
  SquareDashed,
  Star,
  Trash2,
  Type,
  Underline,
  Ungroup as UngroupIcon,
  Unlock,
  Wand2,
} from 'lucide-react';
import type { CanvaShapeKind } from '@desigual-os/types';
import type { UseCanvaEditorResult } from '@/hooks/use-canva-editor';
import { useBrandKit } from '@/hooks/use-brand-kit';
import { FontPicker } from './font-picker';
import { cn } from '@/lib/utils';

/** Paleta fixa base do seletor de cor, além das cores de marca do cliente
 * (quando houver Brand Kit) e do input de hex livre. */
const BASE_COLOR_PALETTE = [
  '#000000', '#ffffff', '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#9333ea', '#64748b',
];

/** Pedido explícito: "controle de cor de texto e de elementos" - substitui o
 * `<input type=color>` cru por hex digitável + paleta + cores de marca. */
function ColorPicker({
  label,
  value,
  onChange,
  brandColors,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
  brandColors?: string[] | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState(value);

  useEffect(() => {
    if (!open) setHexDraft(value);
  }, [value, open]);

  function commitHex(raw: string) {
    const normalized = raw.startsWith('#') ? raw : `#${raw}`;
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(normalized)) onChange(normalized);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={label}
        aria-label={label}
        className="size-8 cursor-pointer rounded-md border border-grafite-elevado"
        style={{ backgroundColor: value }}
      />
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-1/2 z-10 mb-2 w-48 -translate-x-1/2 space-y-2.5 rounded-lg border border-grafite-elevado bg-grafite p-3 shadow-elevated"
          onMouseLeave={() => setOpen(false)}
        >
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              title={label}
              className="size-8 shrink-0 cursor-pointer rounded-md border-none bg-transparent"
            />
            <input
              type="text"
              value={hexDraft}
              onChange={(event) => {
                setHexDraft(event.target.value);
                commitHex(event.target.value);
              }}
              onBlur={() => setHexDraft(value)}
              placeholder="#000000"
              className="h-8 min-w-0 flex-1 rounded-md bg-carbono px-2 text-xs text-branco-cru focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-6 gap-1.5">
            {BASE_COLOR_PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                title={color}
                onClick={() => onChange(color)}
                className="size-6 rounded-full border border-grafite-elevado"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          {brandColors && brandColors.length > 0 && (
            <div>
              <p className="mb-1 font-mono text-[9px] uppercase tracking-wider text-nevoa">Marca</p>
              <div className="grid grid-cols-6 gap-1.5">
                {brandColors.map((color) => (
                  <button
                    key={color}
                    type="button"
                    title={color}
                    onClick={() => onChange(color)}
                    className="size-6 rounded-full border border-grafite-elevado"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const SHAPE_ICONS: Record<CanvaShapeKind, typeof Square> = {
  rect: Square,
  ellipse: Circle,
  triangle: Pentagon,
  line: Minus,
  star: Star,
};

function ToolbarButton({
  label,
  icon: Icon,
  active,
  disabled,
  spin,
  onClick,
}: {
  label: string;
  icon: typeof Square;
  active?: boolean;
  disabled?: boolean;
  spin?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'flex size-8 items-center justify-center rounded-md transition-colors disabled:opacity-50',
        active ? 'bg-roxo-eletrico text-branco-cru' : 'text-nevoa hover:bg-grafite-elevado hover:text-branco-cru',
      )}
    >
      <Icon size={15} className={cn(spin && 'animate-spin')} />
    </button>
  );
}

function Divider() {
  return <div className="mx-1 h-5 w-px bg-grafite-elevado" />;
}

function ImageFiltersMenu({ editor }: { editor: UseCanvaEditorResult }) {
  const [open, setOpen] = useState(false);
  const image = editor.selection.object?.type === 'image' ? editor.selection.object : null;
  const filters = image?.filters ?? {};

  function set(patch: Partial<NonNullable<typeof image>['filters']>) {
    void editor.updateSelectedImageFilters({ ...filters, ...patch });
  }

  return (
    <div className="relative">
      <ToolbarButton label="Ajustar" icon={SlidersHorizontal} onClick={() => setOpen((v) => !v)} />
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-1/2 mb-2 w-56 -translate-x-1/2 space-y-2.5 rounded-lg border border-grafite-elevado bg-grafite p-3 shadow-elevated"
        >
          {[
            { key: 'brightness' as const, label: 'Brilho', min: 0, max: 2, step: 0.05, fallback: 1 },
            { key: 'contrast' as const, label: 'Contraste', min: 0, max: 2, step: 0.05, fallback: 1 },
            { key: 'saturation' as const, label: 'Saturação', min: 0, max: 2, step: 0.05, fallback: 1 },
            { key: 'blur' as const, label: 'Desfoque', min: 0, max: 20, step: 0.5, fallback: 0 },
            { key: 'hueRotate' as const, label: 'Matiz', min: 0, max: 360, step: 1, fallback: 0 },
            { key: 'sharpen' as const, label: 'Nitidez', min: 0, max: 1, step: 0.05, fallback: 0 },
          ].map((control) => (
            <label key={control.key} className="block text-[10px] text-nevoa">
              {control.label}
              <input
                type="range"
                min={control.min}
                max={control.max}
                step={control.step}
                value={filters[control.key] ?? control.fallback}
                onChange={(event) => set({ [control.key]: Number(event.target.value) })}
                className="mt-1 w-full accent-roxo-eletrico"
              />
            </label>
          ))}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => set({ grayscale: !filters.grayscale })}
              className={cn(
                'flex-1 rounded-md border px-2 py-1 text-[10px] transition-colors',
                filters.grayscale ? 'border-roxo-eletrico bg-roxo-eletrico/10 text-branco-cru' : 'border-grafite-elevado text-nevoa',
              )}
            >
              P&B
            </button>
            <button
              type="button"
              onClick={() => set({ sepia: !filters.sepia })}
              className={cn(
                'flex-1 rounded-md border px-2 py-1 text-[10px] transition-colors',
                filters.sepia ? 'border-roxo-eletrico bg-roxo-eletrico/10 text-branco-cru' : 'border-grafite-elevado text-nevoa',
              )}
            >
              Sépia
            </button>
            <button
              type="button"
              onClick={() => set({ invert: !filters.invert })}
              className={cn(
                'flex-1 rounded-md border px-2 py-1 text-[10px] transition-colors',
                filters.invert ? 'border-roxo-eletrico bg-roxo-eletrico/10 text-branco-cru' : 'border-grafite-elevado text-nevoa',
              )}
            >
              Inverter
            </button>
          </div>
          <button
            type="button"
            onClick={() => void editor.updateSelectedImageFilters({})}
            className="w-full rounded-md border border-grafite-elevado px-2 py-1 text-[10px] text-nevoa transition-colors hover:text-branco-cru"
          >
            Remover todos os ajustes
          </button>
        </div>
      )}
    </div>
  );
}

/** Borda (moldura) da imagem selecionada - mesmo par cor+espessura já
 * existente pra formas, pedido explícito: "controle de bordas". */
function ImageBorderMenu({ editor, brandColors }: { editor: UseCanvaEditorResult; brandColors?: string[] | undefined }) {
  const [open, setOpen] = useState(false);
  const image = editor.selection.object?.type === 'image' ? editor.selection.object : null;
  if (!image) return null;

  return (
    <div className="relative">
      <ToolbarButton label="Borda" icon={SquareDashed} onClick={() => setOpen((v) => !v)} />
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-1/2 mb-2 flex w-48 -translate-x-1/2 items-center gap-2 rounded-lg border border-grafite-elevado bg-grafite p-3 shadow-elevated"
          onMouseLeave={() => setOpen(false)}
        >
          <ColorPicker
            label="Cor da borda"
            value={image.stroke ?? '#ffffff'}
            onChange={(color) => editor.updateSelectedImageBorder({ stroke: color })}
            brandColors={brandColors}
          />
          <input
            type="number"
            min={0}
            max={60}
            value={image.strokeWidth ?? 0}
            onChange={(event) => editor.updateSelectedImageBorder({ strokeWidth: Number(event.target.value) })}
            title="Espessura da borda"
            className="h-8 w-16 flex-1 rounded-md bg-carbono px-1.5 text-center text-xs text-branco-cru focus:outline-none"
          />
        </div>
      )}
    </div>
  );
}

/** Tamanho/posição exatos (pedido explícito do usuário: "esticar aumentar
 * diminuir, proporção tamanho local") - complementa as alças de arraste com
 * digitação direta. Cadeado alterna se digitar largura recalcula a altura
 * proporcionalmente (e vice-versa) em vez de distorcer. */
function SizePositionControls({ editor }: { editor: UseCanvaEditorResult }) {
  const object = editor.selection.object;
  const [lockAspect, setLockAspect] = useState(true);
  if (!object) return null;

  const displayWidth = Math.round(object.width * object.scaleX);
  const displayHeight = Math.round(object.height * object.scaleY);

  return (
    <>
      <input
        type="number"
        min={1}
        value={displayWidth}
        onChange={(event) => editor.setSelectedSize(Number(event.target.value), displayHeight, lockAspect)}
        title="Largura"
        aria-label="Largura"
        className="h-8 w-14 rounded-md bg-carbono px-1.5 text-center text-xs text-branco-cru focus:outline-none"
      />
      <button
        type="button"
        onClick={() => setLockAspect((v) => !v)}
        title={lockAspect ? 'Proporção travada' : 'Proporção livre'}
        aria-label={lockAspect ? 'Destravar proporção' : 'Travar proporção'}
        aria-pressed={lockAspect}
        className={cn('flex size-8 items-center justify-center rounded-md', lockAspect ? 'text-roxo-eletrico' : 'text-nevoa hover:text-branco-cru')}
      >
        {lockAspect ? <Link2 size={13} /> : <Link2Off size={13} />}
      </button>
      <input
        type="number"
        min={1}
        value={displayHeight}
        onChange={(event) => editor.setSelectedSize(displayWidth, Number(event.target.value), lockAspect)}
        title="Altura"
        aria-label="Altura"
        className="h-8 w-14 rounded-md bg-carbono px-1.5 text-center text-xs text-branco-cru focus:outline-none"
      />
      <Divider />
      <input
        type="number"
        value={Math.round(object.x)}
        onChange={(event) => editor.setSelectedPosition(Number(event.target.value), object.y)}
        title="Posição X"
        aria-label="Posição X"
        className="h-8 w-14 rounded-md bg-carbono px-1.5 text-center text-xs text-branco-cru focus:outline-none"
      />
      <input
        type="number"
        value={Math.round(object.y)}
        onChange={(event) => editor.setSelectedPosition(object.x, Number(event.target.value))}
        title="Posição Y"
        aria-label="Posição Y"
        className="h-8 w-14 rounded-md bg-carbono px-1.5 text-center text-xs text-branco-cru focus:outline-none"
      />
      <Divider />
      <div className="flex items-center gap-1" title="Ângulo">
        <RotateCw size={13} className="text-nevoa" />
        <input
          type="number"
          value={Math.round(object.rotation)}
          onChange={(event) => editor.setSelectedRotation(Number(event.target.value))}
          aria-label="Ângulo de rotação"
          className="h-8 w-14 rounded-md bg-carbono px-1.5 text-center text-xs text-branco-cru focus:outline-none"
        />
      </div>
    </>
  );
}

function LayersMenu({ editor }: { editor: UseCanvaEditorResult }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div className="relative" ref={containerRef}>
      <ToolbarButton label="Camadas" icon={Rows} onClick={() => setOpen((v) => !v)} />
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-1/2 mb-2 w-44 -translate-x-1/2 rounded-lg border border-grafite-elevado bg-grafite p-1 shadow-elevated"
          onMouseLeave={() => setOpen(false)}
        >
          {[
            { label: 'Trazer para frente', action: editor.bringToFront },
            { label: 'Avançar uma camada', action: editor.bringForward },
            { label: 'Recuar uma camada', action: editor.sendBackward },
            { label: 'Enviar para trás', action: editor.sendToBack },
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                item.action();
                setOpen(false);
              }}
              className="block w-full rounded-md px-2.5 py-1.5 text-left text-xs text-branco-cru transition-colors hover:bg-grafite-elevado"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ShapePicker({ editor }: { editor: UseCanvaEditorResult }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <ToolbarButton label="Forma" icon={Square} onClick={() => setOpen((v) => !v)} />
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 gap-1 rounded-lg border border-grafite-elevado bg-grafite p-1 shadow-elevated"
          onMouseLeave={() => setOpen(false)}
        >
          {(Object.keys(SHAPE_ICONS) as CanvaShapeKind[]).map((shape) => {
            const Icon = SHAPE_ICONS[shape];
            return (
              <button
                key={shape}
                type="button"
                onClick={() => {
                  editor.addShape(shape);
                  setOpen(false);
                }}
                className="flex size-9 items-center justify-center rounded-md text-branco-cru transition-colors hover:bg-grafite-elevado"
              >
                <Icon size={16} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TextAddMenu({ editor }: { editor: UseCanvaEditorResult }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <ToolbarButton label="Texto" icon={Type} onClick={() => setOpen((v) => !v)} />
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-1/2 mb-2 w-44 -translate-x-1/2 rounded-lg border border-grafite-elevado bg-grafite p-1 shadow-elevated"
          onMouseLeave={() => setOpen(false)}
        >
          {[
            { label: 'Adicionar título', variant: 'title' as const },
            { label: 'Adicionar subtítulo', variant: 'subtitle' as const },
            { label: 'Adicionar texto', variant: 'body' as const },
          ].map((item) => (
            <button
              key={item.variant}
              type="button"
              onClick={() => {
                editor.addText(item.variant);
                setOpen(false);
              }}
              className="block w-full rounded-md px-2.5 py-1.5 text-left text-xs text-branco-cru transition-colors hover:bg-grafite-elevado"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Toolbar flutuante central-inferior, contextual à seleção (pedido explícito de layout). */
export function FloatingToolbar({
  editor,
  clientId,
  onOpenBackground,
  onReplaceImage,
  onOpenCrop,
  onRemoveBackground,
  removingBackground,
}: {
  editor: UseCanvaEditorResult;
  clientId: string;
  onOpenBackground: () => void;
  onReplaceImage: () => void;
  onOpenCrop: () => void;
  onRemoveBackground: () => void;
  removingBackground: boolean;
}) {
  const { selection } = editor;
  const isLocked = selection.object?.locked ?? false;
  const [fontPickerOpen, setFontPickerOpen] = useState(false);
  const { data: brandKit } = useBrandKit(clientId);
  const brandColors = brandKit?.colors;

  const shell = 'flex items-center gap-0.5 rounded-xl border border-grafite-elevado bg-grafite/90 p-1.5 shadow-elevated backdrop-blur-md';

  if (selection.type === null) {
    return (
      <div className={shell}>
        <TextAddMenu editor={editor} />
        <ToolbarButton label="Imagem" icon={ImageIcon} onClick={onReplaceImage} />
        <ShapePicker editor={editor} />
        <ToolbarButton label="Background" icon={Palette} onClick={onOpenBackground} />
      </div>
    );
  }

  if (selection.type === 'image' || selection.type === 'multiple') {
    return (
      <div className={cn(shell, 'flex-wrap max-w-[min(95vw,760px)]')}>
        {selection.type === 'image' && <ToolbarButton label="Recortar" icon={Crop} onClick={onOpenCrop} />}
        {selection.type === 'image' && <ToolbarButton label="Substituir" icon={ImageIcon} onClick={onReplaceImage} />}
        {selection.type === 'image' && <ImageFiltersMenu editor={editor} />}
        {selection.type === 'image' && <ImageBorderMenu editor={editor} brandColors={brandColors} />}
        {selection.type === 'image' && (
          <ToolbarButton
            label={removingBackground ? 'Removendo fundo…' : 'Remover fundo'}
            icon={removingBackground ? Loader2 : Wand2}
            onClick={onRemoveBackground}
            disabled={removingBackground}
            spin={removingBackground}
          />
        )}
        <ToolbarButton label="Girar horizontal" icon={FlipHorizontal} onClick={() => editor.flipSelected('x')} />
        <ToolbarButton label="Girar vertical" icon={FlipVertical} onClick={() => editor.flipSelected('y')} />
        {selection.type === 'multiple' && (
          <ToolbarButton label="Agrupar" icon={GroupIcon} onClick={editor.groupSelected} />
        )}
        <Divider />
        {selection.type === 'image' && (
          <>
            <SizePositionControls editor={editor} />
            <Divider />
          </>
        )}
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={selection.object?.opacity ?? 1}
          onChange={(event) => editor.setSelectedOpacity(Number(event.target.value))}
          title="Opacidade"
          className="w-16 accent-roxo-eletrico"
        />
        <Divider />
        <LayersMenu editor={editor} />
        <ToolbarButton label={isLocked ? 'Desbloquear' : 'Bloquear'} icon={isLocked ? Unlock : Lock} onClick={editor.toggleSelectedLock} />
        <ToolbarButton label="Duplicar" icon={Copy} onClick={() => void editor.duplicateSelected()} />
        <ToolbarButton label="Excluir" icon={Trash2} onClick={editor.deleteSelected} />
      </div>
    );
  }

  if (selection.type === 'text' && selection.object?.type === 'text') {
    const text = selection.object;
    return (
      <div className={cn(shell, 'flex-wrap max-w-[min(90vw,720px)]')}>
        <div className="relative">
          <button
            type="button"
            onClick={() => setFontPickerOpen((v) => !v)}
            className="flex h-8 max-w-40 items-center gap-1.5 truncate rounded-md px-2 text-xs text-branco-cru transition-colors hover:bg-grafite-elevado"
            title="Escolher fonte"
            aria-label="Escolher fonte"
          >
            <span style={{ fontFamily: text.fontFamily }} className="text-sm font-bold leading-none">
              Aa
            </span>
            <span className="truncate">{text.fontFamily}</span>
          </button>
          {fontPickerOpen && (
            <FontPicker
              onClose={() => setFontPickerOpen(false)}
              onSelect={(fontId, family) => editor.updateSelectedText({ fontFamily: family, fontId })}
            />
          )}
        </div>
        <Divider />
        <input
          type="number"
          min={8}
          max={400}
          value={Math.round(text.fontSize)}
          onChange={(event) => editor.updateSelectedText({ fontSize: Number(event.target.value) })}
          title="Tamanho"
          className="h-8 w-14 rounded-md bg-carbono px-1.5 text-center text-xs text-branco-cru focus:outline-none"
        />
        <select
          value={text.fontWeight}
          onChange={(event) => editor.updateSelectedText({ fontWeight: Number(event.target.value) })}
          className="h-8 rounded-md border-none bg-transparent px-2 text-xs text-branco-cru focus:outline-none"
          title="Peso"
        >
          {[400, 500, 600, 700, 800, 900].map((weight) => (
            <option key={weight} value={weight} className="bg-grafite text-branco-cru">
              {weight}
            </option>
          ))}
        </select>
        <Divider />
        <ColorPicker label="Cor" value={text.fill} onChange={(color) => editor.updateSelectedText({ fill: color })} brandColors={brandColors} />
        <Divider />
        <ToolbarButton
          label="Alinhar à esquerda"
          icon={AlignLeft}
          active={text.textAlign === 'left'}
          onClick={() => editor.updateSelectedText({ textAlign: 'left' })}
        />
        <ToolbarButton
          label="Centralizar"
          icon={AlignCenter}
          active={text.textAlign === 'center'}
          onClick={() => editor.updateSelectedText({ textAlign: 'center' })}
        />
        <ToolbarButton
          label="Alinhar à direita"
          icon={AlignRight}
          active={text.textAlign === 'right'}
          onClick={() => editor.updateSelectedText({ textAlign: 'right' })}
        />
        <Divider />
        <ToolbarButton
          label="Itálico"
          icon={Italic}
          active={text.fontStyle === 'italic'}
          onClick={() => editor.updateSelectedText({ fontStyle: text.fontStyle === 'italic' ? 'normal' : 'italic' })}
        />
        <ToolbarButton
          label="Sublinhado"
          icon={Underline}
          active={text.underline}
          onClick={() => editor.updateSelectedText({ underline: !text.underline })}
        />
        <ToolbarButton
          label="Maiúsculas"
          icon={Bold}
          active={text.uppercase}
          onClick={() => editor.updateSelectedText({ uppercase: !text.uppercase })}
        />
        <Divider />
        <SizePositionControls editor={editor} />
        <Divider />
        <LayersMenu editor={editor} />
        <ToolbarButton label={isLocked ? 'Desbloquear' : 'Bloquear'} icon={isLocked ? Unlock : Lock} onClick={editor.toggleSelectedLock} />
        <ToolbarButton label="Duplicar" icon={Copy} onClick={() => void editor.duplicateSelected()} />
        <ToolbarButton label="Excluir" icon={Trash2} onClick={editor.deleteSelected} />
      </div>
    );
  }

  if (selection.type === 'shape' && selection.object?.type === 'shape') {
    const shape = selection.object;
    return (
      <div className={shell}>
        <ColorPicker
          label="Preenchimento"
          value={shape.fill}
          onChange={(color) => editor.updateSelectedShape({ fill: color })}
          brandColors={brandColors}
        />
        <ColorPicker
          label="Borda"
          value={shape.stroke}
          onChange={(color) => editor.updateSelectedShape({ stroke: color })}
          brandColors={brandColors}
        />
        <input
          type="number"
          min={0}
          max={40}
          value={shape.strokeWidth}
          onChange={(event) => editor.updateSelectedShape({ strokeWidth: Number(event.target.value) })}
          title="Espessura da borda"
          className="h-8 w-12 rounded-md bg-carbono px-1.5 text-center text-xs text-branco-cru focus:outline-none"
        />
        {shape.shape === 'rect' && (
          <input
            type="number"
            min={0}
            max={200}
            value={shape.cornerRadius ?? 0}
            onChange={(event) => editor.updateSelectedShape({ cornerRadius: Number(event.target.value) })}
            title="Raio do canto"
            className="h-8 w-12 rounded-md bg-carbono px-1.5 text-center text-xs text-branco-cru focus:outline-none"
          />
        )}
        <Divider />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={shape.opacity}
          onChange={(event) => editor.setSelectedOpacity(Number(event.target.value))}
          title="Opacidade"
          className="w-16 accent-roxo-eletrico"
        />
        <Divider />
        <SizePositionControls editor={editor} />
        <Divider />
        <LayersMenu editor={editor} />
        <ToolbarButton label={isLocked ? 'Desbloquear' : 'Bloquear'} icon={isLocked ? Unlock : Lock} onClick={editor.toggleSelectedLock} />
        <ToolbarButton label="Duplicar" icon={Copy} onClick={() => void editor.duplicateSelected()} />
        <ToolbarButton label="Excluir" icon={Trash2} onClick={editor.deleteSelected} />
      </div>
    );
  }

  return (
    <div className={cn(shell, 'flex-wrap max-w-[min(95vw,640px)]')}>
      {selection.type === 'group' && <ToolbarButton label="Desagrupar" icon={UngroupIcon} onClick={editor.ungroupSelected} />}
      {selection.type === 'group' && <Divider />}
      <SizePositionControls editor={editor} />
      <Divider />
      <LayersMenu editor={editor} />
      <ToolbarButton label={isLocked ? 'Desbloquear' : 'Bloquear'} icon={isLocked ? Unlock : Lock} onClick={editor.toggleSelectedLock} />
      <ToolbarButton label="Duplicar" icon={Copy} onClick={() => void editor.duplicateSelected()} />
      <ToolbarButton label="Excluir" icon={Trash2} onClick={editor.deleteSelected} />
    </div>
  );
}

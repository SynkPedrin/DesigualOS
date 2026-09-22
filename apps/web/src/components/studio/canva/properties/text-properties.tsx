'use client';

import { useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, CaseUpper, Italic, Sparkles, Underline } from 'lucide-react';
import type { CanvaTextObject } from '@desigual-os/types';
import type { UseCanvaEditorResult } from '@/hooks/use-canva-editor';
import { ColorPicker } from '../color/color-picker';
import { FontPicker } from '../font-picker';
import { cn } from '@/lib/utils';

/**
 * Propriedades de TEXTO.
 *
 * Todas as dimensões aqui já existiam no `CanvaTextObject` (entressilha,
 * entrelinha, peso, estilo) e eram persistidas e exportadas — só não tinham
 * controle na interface. Expor é ligar o que o modelo já sabia guardar, não
 * inventar campo novo.
 *
 * Sliders usam `preview` durante o arrasto e commitam no `pointerup`: sem
 * isso, arrastar a entrelinha geraria uma entrada de histórico por pixel.
 */
export function TextProperties({
  texto, editor, brandColors, documentColors, brandFonts,
}: {
  texto: CanvaTextObject;
  editor: UseCanvaEditorResult;
  brandColors: string[];
  documentColors: string[];
  brandFonts: string[];
}) {
  const campo = 'w-full rounded border border-grafite-elevado bg-carbono px-1.5 py-1 text-xs text-branco-cru outline-none focus:border-roxo-eletrico/60';

  function Alternador({ ativo, label, onClick, children }: { ativo: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
    return (
      <button
        type="button"
        aria-label={label}
        aria-pressed={ativo}
        title={label}
        onClick={onClick}
        className={cn(
          'flex size-7 items-center justify-center rounded border transition-colors',
          ativo ? 'border-roxo-eletrico text-branco-cru' : 'border-grafite-elevado text-nevoa hover:text-branco-cru',
        )}
      >
        {children}
      </button>
    );
  }

  function Deslizante({
    label, valor, min, max, step, sufixo, onChange,
  }: { label: string; valor: number; min: number; max: number; step: number; sufixo?: string; onChange: (v: number, preview: boolean) => void }) {
    return (
      <label className="mt-1.5 flex items-center gap-2">
        <span className="w-14 shrink-0 font-mono text-[10px] uppercase text-nevoa">{label}</span>
        <input
          type="range"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={valor}
          onChange={(e) => onChange(Number(e.target.value), true)}
          onPointerUp={(e) => onChange(Number((e.target as HTMLInputElement).value), false)}
          onKeyUp={(e) => onChange(Number((e.target as HTMLInputElement).value), false)}
          className="flex-1 accent-roxo-eletrico"
        />
        <span className="w-10 text-right font-mono text-[10px] text-nevoa">
          {Number.isInteger(valor) ? valor : valor.toFixed(2)}
          {sufixo}
        </span>
      </label>
    );
  }

  const [fontPickerOpen, setFontPickerOpen] = useState(false);

  return (
    <>
      <div className="border-b border-grafite-elevado px-3 py-3">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-nevoa">Tipografia</p>

        <button
          type="button"
          onClick={() => setFontPickerOpen((v) => !v)}
          aria-label="Escolher fonte"
          aria-expanded={fontPickerOpen}
          className="flex w-full items-center gap-1.5 rounded border border-grafite-elevado bg-carbono px-1.5 py-1 text-left text-xs text-branco-cru transition-colors hover:border-roxo-eletrico/60"
        >
          <span style={{ fontFamily: texto.fontFamily }} className="shrink-0 text-sm font-bold leading-none">Aa</span>
          <span className="truncate">{texto.fontFamily}</span>
        </button>
        {/* Fica no fluxo normal do painel (não é um popover flutuante) - assim
         * nunca some por trás da borda da sidebar, ver comentário em
         * font-picker.tsx sobre a variante `inline`. */}
        {fontPickerOpen && (
          <FontPicker
            inline
            onClose={() => setFontPickerOpen(false)}
            onSelect={(fontId, family) => editor.updateSelectedText({ fontFamily: family, fontId })}
          />
        )}

        {brandFonts.length > 0 && (
          <div className="mt-1.5">
            <p className="mb-1 font-mono text-[9px] uppercase tracking-wider text-nevoa">Fontes da marca</p>
            <div className="flex flex-wrap gap-1">
              {brandFonts.map((fonte) => (
                <button
                  key={fonte}
                  type="button"
                  aria-label={`Fonte da marca: ${fonte}`}
                  onClick={() => editor.updateSelectedText({ fontFamily: fonte })}
                  className="rounded border border-grafite-elevado px-1.5 py-0.5 text-[10px] text-nevoa transition-colors hover:border-roxo-eletrico/60 hover:text-branco-cru"
                >
                  {fonte}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          <label className="flex items-center gap-1.5">
            <span className="shrink-0 font-mono text-[10px] uppercase text-nevoa">Tam</span>
            <input
              type="number"
              aria-label="Tamanho da fonte"
              min={1}
              value={Math.round(texto.fontSize)}
              onChange={(e) => editor.updateSelectedText({ fontSize: Number(e.target.value) })}
              onKeyDown={(e) => e.stopPropagation()}
              className={campo}
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="shrink-0 font-mono text-[10px] uppercase text-nevoa">Peso</span>
            <select
              aria-label="Peso da fonte"
              value={texto.fontWeight}
              onChange={(e) => editor.updateSelectedText({ fontWeight: Number(e.target.value) })}
              className={campo}
            >
              {[300, 400, 500, 600, 700, 800, 900].map((peso) => (
                <option key={peso} value={peso}>{peso}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-1.5 flex gap-1">
          <Alternador label="Alinhar à esquerda" ativo={texto.textAlign === 'left'} onClick={() => editor.updateSelectedText({ textAlign: 'left' })}>
            <AlignLeft size={13} />
          </Alternador>
          <Alternador label="Centralizar texto" ativo={texto.textAlign === 'center'} onClick={() => editor.updateSelectedText({ textAlign: 'center' })}>
            <AlignCenter size={13} />
          </Alternador>
          <Alternador label="Alinhar à direita" ativo={texto.textAlign === 'right'} onClick={() => editor.updateSelectedText({ textAlign: 'right' })}>
            <AlignRight size={13} />
          </Alternador>
          <Alternador label="Itálico" ativo={texto.fontStyle === 'italic'} onClick={() => editor.updateSelectedText({ fontStyle: texto.fontStyle === 'italic' ? 'normal' : 'italic' })}>
            <Italic size={13} />
          </Alternador>
          <Alternador label="Sublinhado" ativo={texto.underline} onClick={() => editor.updateSelectedText({ underline: !texto.underline })}>
            <Underline size={13} />
          </Alternador>
          <Alternador label="Maiúsculas" ativo={texto.uppercase} onClick={() => editor.updateSelectedText({ uppercase: !texto.uppercase })}>
            <CaseUpper size={14} />
          </Alternador>
          <Alternador label="Sombra" ativo={Boolean(texto.shadow)} onClick={() => editor.updateSelectedText({ shadow: !texto.shadow })}>
            <Sparkles size={13} />
          </Alternador>
        </div>

        <Deslizante
          label="Entrelinha"
          valor={texto.lineHeight}
          min={0.6}
          max={3}
          step={0.05}
          onChange={(v, preview) => editor.updateSelectedText({ lineHeight: v }, preview ? { preview: true } : undefined)}
        />
        <Deslizante
          label="Entreletra"
          valor={texto.letterSpacing}
          min={-200}
          max={800}
          step={10}
          onChange={(v, preview) => editor.updateSelectedText({ letterSpacing: v }, preview ? { preview: true } : undefined)}
        />
      </div>

      <div className="border-b border-grafite-elevado px-3 py-3">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-nevoa">Cor do texto</p>
        <ColorPicker
          label="Cor do texto"
          valor={texto.fill}
          brandColors={brandColors}
          documentColors={documentColors}
          onPreview={(cor) => editor.updateSelectedText({ fill: cor }, { preview: true })}
          onCommit={(cor) => editor.updateSelectedText({ fill: cor })}
        />
      </div>
    </>
  );
}

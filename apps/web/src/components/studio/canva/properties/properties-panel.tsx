'use client';

import { useState } from 'react';
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical,
  AlignHorizontalSpaceAround, AlignStartHorizontal, AlignStartVertical, AlignVerticalSpaceAround,
  ArrowDownToLine, ArrowUpToLine, BringToFront, ChevronRight, Copy, Lock, PanelRightClose,
  SendToBack, Trash2, Unlock,
} from 'lucide-react';
import { CANVA_BLEND_MODES, CANVA_SIZE_PRESETS, type CanvaBlendMode } from '@desigual-os/types';
import type { UseCanvaEditorResult } from '@/hooks/use-canva-editor';
import { ColorPicker } from '../color/color-picker';
import { TextProperties } from './text-properties';
import { ImageProperties } from './image-properties';
import { documentColors as extrairCoresDoDocumento } from '@/lib/canva/color';
import { cn } from '@/lib/utils';

/**
 * Painel direito contextual.
 *
 * Regra que ele NÃO pode quebrar: o painel não guarda estado paralelo ao
 * documento. Todo campo lê de `editor.selection.object` (o CanvaObject vivo)
 * e escreve chamando uma ação do editor. Enquanto o usuário digita, o input
 * mantém um rascunho local só para não brigar com o cursor; o commit é no
 * Enter/blur e a partir daí quem manda é o documento.
 *
 * Limites de documento existem porque `width`/`height` viram um backstore de
 * canvas: valor absurdo não "fica feio", trava a aba.
 */
const MIN_DOC = 16;
const MAX_DOC = 8000;

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-grafite-elevado px-3 py-3">
      <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-nevoa">{titulo}</p>
      {children}
    </div>
  );
}

/**
 * Campo numérico com rascunho local: Enter/blur confirmam, Escape descarta.
 * Sem o rascunho, cada tecla viraria um commit no documento (e uma entrada de
 * histórico), e o cursor pularia a cada re-render.
 */
function CampoNumero({
  label, valor, onCommit, sufixo, min, max,
}: {
  label: string;
  valor: number;
  onCommit: (v: number) => void;
  sufixo?: string;
  min?: number;
  max?: number;
}) {
  const [rascunho, setRascunho] = useState<string | null>(null);
  const mostrado = rascunho ?? String(Math.round(valor));

  function confirmar(texto: string) {
    const n = Number(texto);
    setRascunho(null);
    if (!Number.isFinite(n)) return;
    onCommit(Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min ?? -Number.MAX_SAFE_INTEGER, n)));
  }

  return (
    <label className="flex items-center gap-1.5">
      <span className="w-6 shrink-0 font-mono text-[10px] uppercase text-nevoa">{label}</span>
      <span className="relative flex-1">
        <input
          type="number"
          aria-label={label}
          value={mostrado}
          onChange={(e) => setRascunho(e.target.value)}
          onBlur={(e) => confirmar(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') confirmar(e.currentTarget.value);
            if (e.key === 'Escape') setRascunho(null);
            e.stopPropagation();
          }}
          className="w-full rounded border border-grafite-elevado bg-carbono px-1.5 py-1 text-xs text-branco-cru outline-none focus:border-roxo-eletrico/60"
        />
        {sufixo && <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-nevoa">{sufixo}</span>}
      </span>
    </label>
  );
}

function BotaoIcone({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-7 items-center justify-center rounded border border-grafite-elevado text-nevoa transition-colors hover:border-roxo-eletrico/60 hover:text-branco-cru disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function Alinhamentos({ editor }: { editor: UseCanvaEditorResult }) {
  const qtd = editor.selection.ids.length;
  // Distribuir exige 3: com 2 objetos não existe vão intermediário nenhum.
  const podeDistribuir = qtd >= 3;
  return (
    <Secao titulo="Alinhar">
      <div className="flex flex-wrap gap-1">
        <BotaoIcone label="Alinhar à esquerda" onClick={() => editor.alignSelected('left')}><AlignStartVertical size={13} /></BotaoIcone>
        <BotaoIcone label="Centralizar na horizontal" onClick={() => editor.alignSelected('center')}><AlignCenterVertical size={13} /></BotaoIcone>
        <BotaoIcone label="Alinhar à direita" onClick={() => editor.alignSelected('right')}><AlignEndVertical size={13} /></BotaoIcone>
        <BotaoIcone label="Alinhar ao topo" onClick={() => editor.alignSelected('top')}><AlignStartHorizontal size={13} /></BotaoIcone>
        <BotaoIcone label="Centralizar na vertical" onClick={() => editor.alignSelected('middle')}><AlignCenterHorizontal size={13} /></BotaoIcone>
        <BotaoIcone label="Alinhar embaixo" onClick={() => editor.alignSelected('bottom')}><AlignEndHorizontal size={13} /></BotaoIcone>
        <BotaoIcone label="Distribuir na horizontal" disabled={!podeDistribuir} onClick={() => editor.distributeSelected('horizontal')}>
          <AlignHorizontalSpaceAround size={13} />
        </BotaoIcone>
        <BotaoIcone label="Distribuir na vertical" disabled={!podeDistribuir} onClick={() => editor.distributeSelected('vertical')}>
          <AlignVerticalSpaceAround size={13} />
        </BotaoIcone>
      </div>
      {!podeDistribuir && qtd >= 1 && (
        <p className="mt-1.5 text-[10px] text-nevoa">Distribuir precisa de 3 ou mais objetos.</p>
      )}
    </Secao>
  );
}

const BLEND_MODE_LABELS: Record<CanvaBlendMode, string> = {
  normal: 'Normal',
  multiply: 'Multiplicar',
  screen: 'Tela',
  overlay: 'Sobrepor',
  darken: 'Escurecer',
  lighten: 'Clarear',
  'color-dodge': 'Subexposição de cor',
  'color-burn': 'Superexposição de cor',
  'hard-light': 'Luz forte',
  'soft-light': 'Luz suave',
  difference: 'Diferença',
  exclusion: 'Exclusão',
  hue: 'Matiz',
  saturation: 'Saturação',
  color: 'Cor',
  luminosity: 'Luminosidade',
};

/** Modo de mesclagem - `globalCompositeOperation` nativo do Fabric, disponível
 * pra qualquer tipo de objeto igual (imagem/texto/forma/grupo). */
function BlendModeSelect({ editor }: { editor: UseCanvaEditorResult }) {
  const blendMode = editor.selection.object?.blendMode ?? 'normal';
  return (
    <label className="mt-1.5 flex items-center gap-2">
      <span className="w-6 shrink-0 font-mono text-[10px] uppercase text-nevoa">Mesc</span>
      <select
        aria-label="Modo de mesclagem"
        value={blendMode}
        onChange={(e) => editor.setSelectedBlendMode(e.target.value as CanvaBlendMode)}
        className="flex-1 rounded border border-grafite-elevado bg-carbono px-1.5 py-1 text-xs text-branco-cru outline-none focus:border-roxo-eletrico/60"
      >
        {CANVA_BLEND_MODES.map((mode) => (
          <option key={mode} value={mode}>{BLEND_MODE_LABELS[mode]}</option>
        ))}
      </select>
    </label>
  );
}

/** Ações de camada (bloquear, duplicar, excluir, ordem de empilhamento) -
 * viviam só na FloatingToolbar sobre o canvas; movidas pra cá porque o
 * usuário reportou que a barra flutuante ficava coberta/cortada perto do
 * fim da tela (2026-09-22) - tudo que age sobre a seleção mora na sidebar. */
function AcoesDeCamada({ editor }: { editor: UseCanvaEditorResult }) {
  const bloqueado = editor.selection.object?.locked ?? false;
  return (
    <Secao titulo="Camada">
      <div className="flex flex-wrap gap-1">
        <BotaoIcone label="Trazer para frente" onClick={editor.bringToFront}><BringToFront size={13} /></BotaoIcone>
        <BotaoIcone label="Avançar uma camada" onClick={editor.bringForward}><ArrowUpToLine size={13} /></BotaoIcone>
        <BotaoIcone label="Recuar uma camada" onClick={editor.sendBackward}><ArrowDownToLine size={13} /></BotaoIcone>
        <BotaoIcone label="Enviar para trás" onClick={editor.sendToBack}><SendToBack size={13} /></BotaoIcone>
        <BotaoIcone label={bloqueado ? 'Desbloquear' : 'Bloquear'} onClick={editor.toggleSelectedLock}>
          {bloqueado ? <Unlock size={13} /> : <Lock size={13} />}
        </BotaoIcone>
        <BotaoIcone label="Duplicar" onClick={() => void editor.duplicateSelected()}><Copy size={13} /></BotaoIcone>
        <BotaoIcone label="Excluir" onClick={editor.deleteSelected}><Trash2 size={13} /></BotaoIcone>
      </div>
    </Secao>
  );
}

function PropriedadesDoDocumento({
  editor, documentWidth, documentHeight, onResize, onOpenBackground,
}: {
  editor: UseCanvaEditorResult;
  documentWidth: number;
  documentHeight: number;
  onResize: (width: number, height: number) => void;
  onOpenBackground: () => void;
}) {
  const presetAtual = CANVA_SIZE_PRESETS.find((p) => p.width === documentWidth && p.height === documentHeight);
  const fundo = editor.activePage?.background;

  return (
    <>
      <Secao titulo="Documento">
        <div className="grid grid-cols-2 gap-1.5">
          <CampoNumero label="L" valor={documentWidth} min={MIN_DOC} max={MAX_DOC} onCommit={(v) => onResize(v, documentHeight)} />
          <CampoNumero label="A" valor={documentHeight} min={MIN_DOC} max={MAX_DOC} onCommit={(v) => onResize(documentWidth, v)} />
        </div>
        <p className="mt-1.5 text-[10px] text-nevoa">
          {presetAtual ? presetAtual.label : 'Tamanho personalizado'} · {MIN_DOC}–{MAX_DOC}px
        </p>
      </Secao>

      <Secao titulo="Formato">
        <select
          aria-label="Preset do documento"
          value={presetAtual?.id ?? 'custom'}
          onChange={(e) => {
            const preset = CANVA_SIZE_PRESETS.find((p) => p.id === e.target.value);
            if (preset) onResize(preset.width, preset.height);
          }}
          className="w-full rounded border border-grafite-elevado bg-carbono px-1.5 py-1 text-xs text-branco-cru outline-none focus:border-roxo-eletrico/60"
        >
          <option value="custom">Tamanho personalizado</option>
          {CANVA_SIZE_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label} — {preset.width}×{preset.height}
            </option>
          ))}
        </select>
        {/* Trocar o formato muda SÓ o artboard: os objetos ficam onde estão.
          * Reescalar conteúdo automaticamente é uma decisão de arte, não de
          * layout, e não pode acontecer sem o usuário pedir. */}
        <p className="mt-1.5 text-[10px] text-nevoa">Muda só a prancheta; os objetos mantêm posição.</p>
      </Secao>

      <Secao titulo="Fundo">
        <div className="flex items-center gap-1.5">
          <input
            type="color"
            aria-label="Cor do fundo"
            value={fundo?.type === 'color' && fundo.value ? fundo.value : '#ffffff'}
            onChange={(e) => editor.setPageBackground({ type: 'color', value: e.target.value })}
            className="size-7 shrink-0 cursor-pointer rounded border border-grafite-elevado bg-carbono"
          />
          <button
            type="button"
            onClick={() => editor.setPageBackground({ type: 'transparent' })}
            className={cn(
              'flex-1 rounded border px-2 py-1 text-[11px] transition-colors',
              fundo?.type === 'transparent'
                ? 'border-roxo-eletrico text-branco-cru'
                : 'border-grafite-elevado text-nevoa hover:text-branco-cru',
            )}
          >
            Transparente
          </button>
        </div>
        <button
          type="button"
          onClick={onOpenBackground}
          className="mt-1.5 w-full rounded border border-grafite-elevado px-2 py-1 text-[11px] text-nevoa transition-colors hover:border-roxo-eletrico/60 hover:text-branco-cru"
        >
          Imagem de fundo...
        </button>
      </Secao>
    </>
  );
}

export function PropertiesPanel({
  editor, documentWidth, documentHeight, onResize, brandColors = [], brandFonts = [],
  onOpenBackground, onReplaceImage, onOpenCrop, onRemoveBackground, removingBackground,
}: {
  editor: UseCanvaEditorResult;
  documentWidth: number;
  documentHeight: number;
  onResize: (width: number, height: number) => void;
  brandColors?: string[];
  brandFonts?: string[];
  onOpenBackground: () => void;
  onReplaceImage: () => void;
  onOpenCrop: () => void;
  onRemoveBackground: () => void;
  removingBackground: boolean;
}) {
  const [aberto, setAberto] = useState(true);
  const selecionado = editor.selection.object;
  const qtd = editor.selection.ids.length;
  // Derivado do documento a cada render: não é uma segunda lista para manter
  // em sincronia, é uma leitura do que existe agora.
  const coresDoDocumento = extrairCoresDoDocumento(editor.activePage?.objects ?? []);

  if (!aberto) {
    return (
      <button
        type="button"
        aria-label="Abrir propriedades"
        title="Abrir propriedades"
        onClick={() => setAberto(true)}
        className="flex w-8 shrink-0 items-center justify-center border-l border-grafite-elevado bg-grafite text-nevoa hover:text-branco-cru"
      >
        <ChevronRight size={14} className="rotate-180" />
      </button>
    );
  }

  return (
    <aside
      data-canva-properties=""
      className="flex w-56 shrink-0 flex-col overflow-y-auto border-l border-grafite-elevado bg-grafite"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-grafite-elevado px-3 py-2">
        <p className="font-heading text-[11px] font-semibold uppercase tracking-wider text-branco-cru">
          {qtd === 0 ? 'Documento' : qtd > 1 ? `${qtd} objetos` : 'Propriedades'}
        </p>
        <button type="button" aria-label="Recolher propriedades" title="Recolher propriedades" onClick={() => setAberto(false)} className="text-nevoa hover:text-branco-cru">
          <PanelRightClose size={14} />
        </button>
      </div>

      {qtd === 0 ? (
        <PropriedadesDoDocumento
          editor={editor}
          documentWidth={documentWidth}
          documentHeight={documentHeight}
          onResize={onResize}
          onOpenBackground={onOpenBackground}
        />
      ) : (
        <>
          <AcoesDeCamada editor={editor} />

          {/* Posição/tamanho só fazem sentido para UM objeto: com vários, os
            * campos mostrariam o valor de um e aplicariam a todos. */}
          {qtd === 1 && selecionado && (
            <Secao titulo="Posição e tamanho">
              <div className="grid grid-cols-2 gap-1.5">
                <CampoNumero label="X" valor={selecionado.x} onCommit={(v) => editor.setSelectedPosition(v, selecionado.y)} />
                <CampoNumero label="Y" valor={selecionado.y} onCommit={(v) => editor.setSelectedPosition(selecionado.x, v)} />
                <CampoNumero
                  label="L"
                  valor={selecionado.width * selecionado.scaleX}
                  min={1}
                  onCommit={(v) => editor.setSelectedSize(v, selecionado.height * selecionado.scaleY)}
                />
                <CampoNumero
                  label="A"
                  valor={selecionado.height * selecionado.scaleY}
                  min={1}
                  onCommit={(v) => editor.setSelectedSize(selecionado.width * selecionado.scaleX, v)}
                />
              </div>
              <div className="mt-1.5">
                <CampoNumero label="Ang" valor={selecionado.rotation} sufixo="°" onCommit={(v) => editor.setSelectedRotation(v)} />
              </div>
            </Secao>
          )}

          {qtd === 1 && selecionado?.type === 'text' && (
            <TextProperties
              texto={selecionado}
              editor={editor}
              brandColors={brandColors}
              documentColors={coresDoDocumento}
              brandFonts={brandFonts}
            />
          )}

          {qtd === 1 && selecionado?.type === 'image' && (
            <ImageProperties
              imagem={selecionado}
              editor={editor}
              brandColors={brandColors}
              onReplaceImage={onReplaceImage}
              onOpenCrop={onOpenCrop}
              onRemoveBackground={onRemoveBackground}
              removingBackground={removingBackground}
            />
          )}

          <Alinhamentos editor={editor} />

          {qtd === 1 && selecionado && (selecionado.type === 'shape' || selecionado.type === 'text' || selecionado.type === 'path') && (
            <Secao titulo={selecionado.type === 'path' ? 'Traço' : 'Preenchimento'}>
              <ColorPicker
                label={selecionado.type === 'path' ? 'Cor do traço' : 'Cor de preenchimento'}
                valor={
                  selecionado.type === 'shape'
                    ? selecionado.fill
                    : selecionado.type === 'text'
                      ? selecionado.fill
                      : selecionado.stroke
                }
                brandColors={brandColors}
                documentColors={coresDoDocumento}
                // Preview desenha sem gravar; o commit é que entra no
                // histórico - senão arrastar o campo de cor geraria centenas
                // de snapshots.
                onPreview={(cor) => {
                  if (selecionado.type === 'shape') editor.updateSelectedShape({ fill: cor }, { preview: true });
                  else if (selecionado.type === 'text') editor.updateSelectedText({ fill: cor }, { preview: true });
                  else editor.updateSelectedPath({ stroke: cor }, { preview: true });
                }}
                onCommit={(cor) => {
                  if (selecionado.type === 'shape') editor.updateSelectedShape({ fill: cor });
                  else if (selecionado.type === 'text') editor.updateSelectedText({ fill: cor });
                  else editor.updateSelectedPath({ stroke: cor });
                }}
              />
              {selecionado.type === 'shape' && (
                <div className="mt-1.5">
                  <ColorPicker
                    label="Cor da borda"
                    valor={selecionado.stroke ?? '#000000'}
                    brandColors={brandColors}
                    documentColors={coresDoDocumento}
                    onPreview={(cor) => editor.updateSelectedShape({ stroke: cor }, { preview: true })}
                    onCommit={(cor) => editor.updateSelectedShape({ stroke: cor })}
                  />
                  <button
                    type="button"
                    aria-label="Sombra"
                    aria-pressed={Boolean(selecionado.shadow)}
                    onClick={() => editor.updateSelectedShape({ shadow: !selecionado.shadow })}
                    className={cn(
                      'mt-1.5 w-full rounded border px-2 py-1 text-left text-[10px] uppercase tracking-wider transition-colors',
                      selecionado.shadow
                        ? 'border-roxo-eletrico text-branco-cru'
                        : 'border-grafite-elevado text-nevoa hover:text-branco-cru',
                    )}
                  >
                    Sombra
                  </button>
                  <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                    <CampoNumero
                      label="Bda"
                      valor={selecionado.strokeWidth}
                      min={0}
                      max={40}
                      onCommit={(v) => editor.updateSelectedShape({ strokeWidth: v })}
                    />
                    {selecionado.shape === 'rect' && (
                      <CampoNumero
                        label="Rai"
                        valor={selecionado.cornerRadius ?? 0}
                        min={0}
                        max={200}
                        onCommit={(v) => editor.updateSelectedShape({ cornerRadius: v })}
                      />
                    )}
                  </div>
                </div>
              )}
              {selecionado.type === 'path' && (
                <div className="mt-1.5">
                  <CampoNumero
                    label="Esp"
                    valor={selecionado.strokeWidth}
                    min={1}
                    max={100}
                    onCommit={(v) => editor.updateSelectedPath({ strokeWidth: v })}
                  />
                </div>
              )}
            </Secao>
          )}

          <Secao titulo="Aparência">
            <label className="flex items-center gap-2">
              <span className="w-6 shrink-0 font-mono text-[10px] uppercase text-nevoa">Op</span>
              <input
                type="range"
                min={0}
                max={100}
                aria-label="Opacidade"
                value={Math.round((selecionado?.opacity ?? 1) * 100)}
                onChange={(e) => editor.setSelectedOpacity(Number(e.target.value) / 100)}
                className="flex-1 accent-roxo-eletrico"
              />
              <span className="w-8 text-right font-mono text-[10px] text-nevoa">{Math.round((selecionado?.opacity ?? 1) * 100)}%</span>
            </label>
            {qtd === 1 && <BlendModeSelect editor={editor} />}
          </Secao>

          {qtd > 1 && (
            <Secao titulo="Conjunto">
              <button
                type="button"
                onClick={() => editor.groupSelected()}
                className="w-full rounded border border-grafite-elevado px-2 py-1 text-[11px] text-nevoa transition-colors hover:border-roxo-eletrico/60 hover:text-branco-cru"
              >
                Agrupar
              </button>
            </Secao>
          )}

          {selecionado?.type === 'group' && (
            <Secao titulo="Grupo">
              <button
                type="button"
                onClick={() => editor.ungroupSelected()}
                className="w-full rounded border border-grafite-elevado px-2 py-1 text-[11px] text-nevoa transition-colors hover:border-roxo-eletrico/60 hover:text-branco-cru"
              >
                Desagrupar
              </button>
            </Secao>
          )}
        </>
      )}
    </aside>
  );
}

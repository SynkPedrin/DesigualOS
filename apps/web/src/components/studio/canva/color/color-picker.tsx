'use client';

import { useEffect, useState } from 'react';
import { Pipette } from 'lucide-react';
import { normalizeColor, pushRecentColor, toHslString, toRgbString } from '@/lib/canva/color';
import { cn } from '@/lib/utils';

const CHAVE_RECENTES = 'desigual-canva-recent-colors';

/**
 * Cores recentes vivem no localStorage de propósito: são preferência de quem
 * está editando, não conteúdo do documento. Mandar para o banco criaria
 * escrita a cada clique de cor sem nada em troca.
 */
export function lerRecentes(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const bruto = window.localStorage.getItem(CHAVE_RECENTES);
    const lista: unknown = bruto ? JSON.parse(bruto) : [];
    return Array.isArray(lista) ? lista.filter((c): c is string => typeof c === 'string') : [];
  } catch {
    // Modo privado/cota cheia não pode derrubar o editor por causa de swatch.
    return [];
  }
}

function gravarRecentes(cores: string[]): void {
  try {
    window.localStorage.setItem(CHAVE_RECENTES, JSON.stringify(cores));
  } catch {
    /* ver lerRecentes */
  }
}

/** Lê + adiciona + grava de uma vez, pra quem captura cor FORA do picker
 * (conta-gotas do tool rail). Devolve a lista nova pra quem tem estado local. */
export function registrarCorRecente(cor: string): string[] {
  const proximas = pushRecentColor(lerRecentes(), cor);
  gravarRecentes(proximas);
  return proximas;
}

/** `window.EyeDropper` só existe em Chromium. Em Safari/Firefox o botão fica desabilitado, não fake. */
type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };
function eyeDropperDisponivel(): boolean {
  return typeof window !== 'undefined' && 'EyeDropper' in window;
}

function Swatches({ titulo, cores, onPick }: { titulo: string; cores: string[]; onPick: (c: string) => void }) {
  if (cores.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="mb-1 font-mono text-[9px] uppercase tracking-wider text-nevoa">{titulo}</p>
      <div className="flex flex-wrap gap-1">
        {cores.map((cor) => (
          <button
            key={`${titulo}-${cor}`}
            type="button"
            aria-label={`${titulo}: ${cor}`}
            title={cor}
            onClick={() => onPick(cor)}
            className="size-5 rounded border border-grafite-elevado transition-transform hover:scale-110"
            style={{ backgroundColor: cor }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Seletor de cor do editor.
 *
 * `onPreview` recebe cada mudança contínua (arrastar o campo de cor) e
 * `onCommit` fecha a interação — é o que impede uma arrastada virar centenas
 * de entradas no histórico.
 */
export function ColorPicker({
  valor, onPreview, onCommit, brandColors = [], documentColors = [], label = 'Cor',
}: {
  valor: string;
  onPreview: (cor: string) => void;
  onCommit: (cor: string) => void;
  brandColors?: string[];
  documentColors?: string[];
  label?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [recentes, setRecentes] = useState<string[]>([]);
  const [texto, setTexto] = useState<string | null>(null);
  const [erroPipeta, setErroPipeta] = useState<string | null>(null);

  useEffect(() => setRecentes(lerRecentes()), []);

  const canonica = normalizeColor(valor) ?? '#000000';

  function aplicar(cor: string) {
    const c = normalizeColor(cor);
    if (!c) return;
    onCommit(c);
    const proximas = pushRecentColor(recentes, c);
    setRecentes(proximas);
    gravarRecentes(proximas);
  }

  async function usarPipeta() {
    const Ctor = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
    if (!Ctor) return;
    try {
      const { sRGBHex } = await new Ctor().open();
      aplicar(sRGBHex);
      setErroPipeta(null);
    } catch {
      // Usuário apertou Esc: não é erro, é cancelamento.
      setErroPipeta(null);
    }
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label={label}
          title={`${label}: ${canonica}`}
          onClick={() => setAberto((v) => !v)}
          className="size-7 shrink-0 rounded border border-grafite-elevado"
          style={{ backgroundColor: canonica }}
        />
        <input
          aria-label={`${label} em hexadecimal`}
          value={texto ?? canonica}
          onChange={(e) => {
            setTexto(e.target.value);
            const c = normalizeColor(e.target.value);
            if (c) onPreview(c);
          }}
          onBlur={(e) => {
            setTexto(null);
            const c = normalizeColor(e.target.value);
            if (c) aplicar(c);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setTexto(null);
            e.stopPropagation();
          }}
          className="min-w-0 flex-1 rounded border border-grafite-elevado bg-carbono px-1.5 py-1 font-mono text-[11px] text-branco-cru outline-none focus:border-roxo-eletrico/60"
        />
        <button
          type="button"
          aria-label="Conta-gotas"
          title={eyeDropperDisponivel() ? 'Conta-gotas' : 'Conta-gotas indisponível neste navegador'}
          disabled={!eyeDropperDisponivel()}
          onClick={() => void usarPipeta()}
          className="flex size-7 shrink-0 items-center justify-center rounded border border-grafite-elevado text-nevoa transition-colors hover:border-roxo-eletrico/60 hover:text-branco-cru disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Pipette size={13} />
        </button>
      </div>

      {aberto && (
        <div className="absolute right-0 z-20 mt-1.5 w-52 rounded-lg border border-grafite-elevado bg-grafite p-2 shadow-elevated">
          <input
            type="color"
            aria-label={`${label} - seletor visual`}
            value={canonica.slice(0, 7)}
            onChange={(e) => onPreview(e.target.value)}
            onBlur={(e) => aplicar(e.target.value)}
            className="h-8 w-full cursor-pointer rounded border border-grafite-elevado bg-carbono"
          />
          <div className="mt-1.5 grid gap-0.5 font-mono text-[9px] text-nevoa">
            <span>{toRgbString(canonica)}</span>
            <span>{toHslString(canonica)}</span>
          </div>
          <Swatches titulo="Marca" cores={brandColors} onPick={aplicar} />
          <Swatches titulo="Documento" cores={documentColors} onPick={aplicar} />
          <Swatches titulo="Recentes" cores={recentes} onPick={aplicar} />
          {erroPipeta && <p className={cn('mt-1 text-[9px]', 'text-nevoa')}>{erroPipeta}</p>}
        </div>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { Maximize } from 'lucide-react';
import type { UseCanvaEditorResult } from '@/hooks/use-canva-editor';
import type { AutosaveStatus } from '@/lib/canva/autosave';

/**
 * Barra de status fina no rodapé do editor (abaixo da PagesBar).
 *
 * O indicador de salvamento (`data-canva-save-status`) mora AQUI, não mais na
 * topbar - o atributo é o mesmo que os testes E2E já usam, só mudou de lugar.
 */
export function CanvaStatusBar({
  editor,
  saveStatus,
  documentWidth,
  documentHeight,
}: {
  editor: UseCanvaEditorResult;
  saveStatus: AutosaveStatus;
  documentWidth: number;
  documentHeight: number;
}) {
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const pageIndex = editor.pages.findIndex((p) => p.id === editor.activePageId);
  const pageName = editor.activePage?.name ?? `Página ${pageIndex + 1}`;

  return (
    <div
      data-canva-statusbar=""
      className="flex h-8 shrink-0 items-center justify-between border-t border-grafite-elevado bg-grafite/60 px-3 text-xs text-nevoa"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="font-mono text-[11px]">
          {documentWidth}×{documentHeight}
        </span>
        <span className="text-grafite-elevado">·</span>
        <span className="truncate">{pageName}</span>
      </div>

      <div className="flex items-center gap-2">
        {/* Mesmo dado que estava na topbar: "Salvo"/"Não salvo" compartilham
            palavra, então o estado vai como ATRIBUTO, não só texto. */}
        <span data-canva-save-status={saveStatus} className="font-mono text-[10px]">
          {saveStatus === 'salvando' ? 'Salvando...' : saveStatus === 'salvo' ? 'Salvo' : saveStatus === 'pendente' ? 'Não salvo' : ''}
        </span>

        <div className="relative">
          <button
            type="button"
            onClick={() => setZoomMenuOpen((v) => !v)}
            className="w-12 rounded px-1 py-0.5 text-center font-mono text-[11px] transition-colors hover:bg-grafite-elevado hover:text-branco-cru"
            title="Zoom"
            aria-label="Zoom"
          >
            {Math.round(editor.zoom * 100)}%
          </button>
          {zoomMenuOpen && (
            <div
              role="menu"
              className="absolute bottom-full right-0 z-10 mb-1.5 w-36 rounded-lg border border-grafite-elevado bg-grafite p-1.5 shadow-elevated"
              onMouseLeave={() => setZoomMenuOpen(false)}
            >
              {[0.5, 1, 1.5, 2, 3].map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => {
                    editor.setZoom(level);
                    setZoomMenuOpen(false);
                  }}
                  className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-branco-cru transition-colors hover:bg-grafite-elevado"
                >
                  {Math.round(level * 100)}%
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={editor.zoomToFit}
          aria-label="Ajustar à tela"
          title="Ajustar à tela (Ctrl/Cmd+0)"
          className="flex size-6 items-center justify-center rounded text-nevoa transition-colors hover:bg-grafite-elevado hover:text-branco-cru"
        >
          <Maximize size={12} />
        </button>
      </div>
    </div>
  );
}

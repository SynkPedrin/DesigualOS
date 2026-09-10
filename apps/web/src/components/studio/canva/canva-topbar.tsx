'use client';

import { useState } from 'react';
import { ArrowLeft, ChevronDown, Download, Redo2, Undo2, ZoomIn, ZoomOut } from 'lucide-react';
import type { UseCanvaEditorResult } from '@/hooks/use-canva-editor';
import { downloadBlob, downloadBlobsAsZip } from '@/lib/canva/export';
import { toast } from '@/stores/toast-store';
import { cn } from '@/lib/utils';

type ExportFormat = 'png' | 'jpeg' | 'webp';

/** Barra superior: nome do documento, status de autosave, zoom, undo/redo, exportar, voltar. */
export function CanvaTopbar({
  editor,
  documentName,
  onRenameDocument,
  saveStatus,
  onBack,
}: {
  editor: UseCanvaEditorResult;
  documentName: string;
  onRenameDocument: (name: string) => void;
  saveStatus: 'idle' | 'saving' | 'saved';
  onBack: () => void;
}) {
  const [exportOpen, setExportOpen] = useState(false);
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [name, setName] = useState(documentName);

  async function handleExport(format: ExportFormat, multiplier: number, allPages: boolean) {
    setExportOpen(false);
    setExporting(true);
    try {
      if (allPages && editor.pages.length > 1) {
        const files = await editor.exportAllPages(format, multiplier);
        await downloadBlobsAsZip(files, `${documentName || 'design'}.zip`);
      } else {
        const dataUrl = editor.exportActivePageDataUrl(format, multiplier);
        const blob = await (await fetch(dataUrl)).blob();
        downloadBlob(blob, `${documentName || 'design'}.${format}`);
      }
      toast('Exportação concluída.', 'success');
    } catch {
      toast('Não foi possível exportar. Tente de novo.', 'error');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-grafite-elevado bg-grafite px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Voltar"
          className="flex size-8 items-center justify-center rounded-md text-nevoa transition-colors hover:bg-grafite-elevado hover:text-branco-cru"
        >
          <ArrowLeft size={16} />
        </button>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => onRenameDocument(name.trim() || 'Sem título')}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
          className="min-w-0 max-w-[220px] truncate rounded-md bg-transparent px-2 py-1 text-sm font-medium text-branco-cru focus:bg-carbono focus:outline-none"
        />
        <span className="shrink-0 font-mono text-[10px] text-nevoa">
          {saveStatus === 'saving' ? 'Salvando...' : saveStatus === 'saved' ? 'Salvo' : ''}
        </span>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={editor.undo}
          disabled={!editor.canUndo}
          aria-label="Desfazer"
          title="Desfazer (Ctrl/Cmd+Z)"
          className="flex size-8 items-center justify-center rounded-md text-nevoa transition-colors hover:bg-grafite-elevado hover:text-branco-cru disabled:opacity-30"
        >
          <Undo2 size={15} />
        </button>
        <button
          type="button"
          onClick={editor.redo}
          disabled={!editor.canRedo}
          aria-label="Refazer"
          title="Refazer (Ctrl/Cmd+Shift+Z)"
          className="flex size-8 items-center justify-center rounded-md text-nevoa transition-colors hover:bg-grafite-elevado hover:text-branco-cru disabled:opacity-30"
        >
          <Redo2 size={15} />
        </button>

        <div className="relative mx-1.5 flex items-center gap-1 rounded-md border border-grafite-elevado px-1">
          <button
            type="button"
            onClick={() => editor.setZoom(editor.zoom - 0.1)}
            aria-label="Diminuir zoom"
            className="flex size-7 items-center justify-center text-nevoa transition-colors hover:text-branco-cru"
          >
            <ZoomOut size={14} />
          </button>
          <button
            type="button"
            onClick={() => setZoomMenuOpen((v) => !v)}
            className="w-12 text-center font-mono text-[11px] text-nevoa transition-colors hover:text-branco-cru"
            title="Zoom"
          >
            {Math.round(editor.zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => editor.setZoom(editor.zoom + 0.1)}
            aria-label="Aumentar zoom"
            className="flex size-7 items-center justify-center text-nevoa transition-colors hover:text-branco-cru"
          >
            <ZoomIn size={14} />
          </button>

          {zoomMenuOpen && (
            <div
              role="menu"
              className="absolute left-0 top-full z-10 mt-1.5 w-36 rounded-lg border border-grafite-elevado bg-grafite p-1.5 shadow-elevated"
              onMouseLeave={() => setZoomMenuOpen(false)}
            >
              <button
                type="button"
                onClick={() => {
                  editor.zoomToFit();
                  setZoomMenuOpen(false);
                }}
                className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-branco-cru transition-colors hover:bg-grafite-elevado"
              >
                Ajustar à tela
              </button>
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

        <div className="relative">
          <button
            type="button"
            onClick={() => setExportOpen((v) => !v)}
            disabled={exporting}
            className="flex items-center gap-1.5 rounded-md bg-roxo-eletrico px-3 py-1.5 text-xs font-semibold text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:opacity-60"
          >
            <Download size={13} />
            {exporting ? 'Exportando...' : 'Exportar'}
            <ChevronDown size={12} className={cn('transition-transform', exportOpen && 'rotate-180')} />
          </button>

          {exportOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-10 mt-1.5 w-56 rounded-lg border border-grafite-elevado bg-grafite p-1.5 shadow-elevated"
              onMouseLeave={() => setExportOpen(false)}
            >
              <p className="px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-nevoa">Formato</p>
              {(['png', 'jpeg', 'webp'] as ExportFormat[]).map((format) => (
                <div key={format} className="flex items-center justify-between px-2 py-1">
                  <span className="text-xs text-branco-cru uppercase">{format}</span>
                  <div className="flex gap-1">
                    {[1, 2, 4].map((multiplier) => (
                      <button
                        key={multiplier}
                        type="button"
                        onClick={() => void handleExport(format, multiplier, false)}
                        className="rounded border border-grafite-elevado px-1.5 py-0.5 text-[10px] text-nevoa transition-colors hover:border-roxo-eletrico/60 hover:text-branco-cru"
                      >
                        {multiplier}x
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {editor.pages.length > 1 && (
                <>
                  <div className="my-1 border-t border-grafite-elevado" />
                  <button
                    type="button"
                    onClick={() => void handleExport('png', 2, true)}
                    className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-branco-cru transition-colors hover:bg-grafite-elevado"
                  >
                    Exportar todas as {editor.pages.length} páginas (.zip)
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

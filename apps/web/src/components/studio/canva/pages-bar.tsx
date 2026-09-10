'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Plus, Trash2 } from 'lucide-react';
import type { UseCanvaEditorResult } from '@/hooks/use-canva-editor';
import { cn } from '@/lib/utils';

/** Miniaturas das páginas do documento (carrossel) - cada página guarda seus
 * próprios objetos; trocar de miniatura troca a página ativa no canvas. */
export function PagesBar({ editor, documentWidth, documentHeight }: { editor: UseCanvaEditorResult; documentWidth: number; documentHeight: number }) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const aspect = documentWidth / documentHeight;
  const sortedPages = [...editor.pages].sort((a, b) => a.order - b.order);

  return (
    <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-t border-grafite-elevado bg-grafite/60 px-3 py-2.5">
      {sortedPages.map((page, index) => {
        const isActive = page.id === editor.activePageId;
        return (
          <div key={page.id} className="group relative shrink-0">
            <button
              type="button"
              onClick={() => editor.setActivePageId(page.id)}
              onDoubleClick={() => {
                setRenamingId(page.id);
                setRenameValue(page.name ?? `Página ${index + 1}`);
              }}
              className={cn(
                'flex h-14 items-center justify-center rounded-md border-2 bg-white transition-colors',
                isActive ? 'border-roxo-eletrico' : 'border-grafite-elevado hover:border-nevoa/50',
              )}
              style={{ width: 14 * aspect * 4 }}
              title={page.name ?? `Página ${index + 1}`}
            >
              <span className="font-mono text-[10px] text-carbono/50">{index + 1}</span>
            </button>

            {renamingId === page.id && (
              <input
                autoFocus
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                onBlur={() => {
                  editor.renamePage(page.id, renameValue.trim() || `Página ${index + 1}`);
                  setRenamingId(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                  if (event.key === 'Escape') setRenamingId(null);
                }}
                className="absolute -top-7 left-0 w-full rounded-md border border-roxo-eletrico bg-carbono px-1.5 py-0.5 text-[10px] text-branco-cru focus:outline-none"
              />
            )}

            <div className="pointer-events-none absolute -top-1 -right-1 flex gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
              <button
                type="button"
                aria-label="Mover para esquerda"
                title="Mover para esquerda"
                onClick={() => editor.movePage(page.id, -1)}
                disabled={index === 0}
                className="flex size-4 items-center justify-center rounded-full bg-carbono text-nevoa disabled:opacity-30"
              >
                <ChevronLeft size={10} />
              </button>
              <button
                type="button"
                aria-label="Mover para direita"
                title="Mover para direita"
                onClick={() => editor.movePage(page.id, 1)}
                disabled={index === sortedPages.length - 1}
                className="flex size-4 items-center justify-center rounded-full bg-carbono text-nevoa disabled:opacity-30"
              >
                <ChevronRight size={10} />
              </button>
              <button
                type="button"
                aria-label="Duplicar página"
                title="Duplicar página"
                onClick={() => editor.duplicatePage(page.id)}
                className="flex size-4 items-center justify-center rounded-full bg-carbono text-nevoa"
              >
                <Copy size={9} />
              </button>
              {sortedPages.length > 1 && (
                <button
                  type="button"
                  aria-label="Excluir página"
                  title="Excluir página"
                  onClick={() => editor.deletePage(page.id)}
                  className="flex size-4 items-center justify-center rounded-full bg-carbono text-erro"
                >
                  <Trash2 size={9} />
                </button>
              )}
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={editor.addPage}
        aria-label="Adicionar página"
        title="Adicionar página"
        className="flex h-14 w-10 shrink-0 items-center justify-center rounded-md border border-dashed border-grafite-elevado text-nevoa transition-colors hover:border-roxo-eletrico/60 hover:text-branco-cru"
      >
        <Plus size={16} />
      </button>
    </div>
  );
}

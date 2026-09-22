'use client';

import { Brush, Eraser, Hand, MousePointer2, Pipette, Type } from 'lucide-react';
import type { CanvaTool, UseCanvaEditorResult } from '@/hooks/use-canva-editor';
import { cn } from '@/lib/utils';

const TOOLS: { id: CanvaTool; label: string; shortcut: string; icon: typeof MousePointer2 }[] = [
  { id: 'select', label: 'Selecionar', shortcut: 'V', icon: MousePointer2 },
  { id: 'hand', label: 'Mover', shortcut: 'H', icon: Hand },
  { id: 'text', label: 'Texto', shortcut: 'T', icon: Type },
  { id: 'brush', label: 'Pincel', shortcut: 'B', icon: Brush },
  { id: 'eraser', label: 'Borracha', shortcut: 'E', icon: Eraser },
  { id: 'eyedropper', label: 'Conta-gotas', shortcut: 'I', icon: Pipette },
];

/** Rail vertical de ferramentas - primeira coluna do editor, à esquerda da
 * sidebar de painéis. `data-canva-tool` em cada botão é o seletor de E2E. */
export function CanvaToolRail({ editor }: { editor: UseCanvaEditorResult }) {
  return (
    <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-grafite-elevado bg-grafite py-2">
      {TOOLS.map((tool) => {
        const Icon = tool.icon;
        const active = editor.activeTool === tool.id;
        return (
          <button
            key={tool.id}
            type="button"
            data-canva-tool={tool.id}
            onClick={() => editor.setActiveTool(tool.id)}
            aria-label={`${tool.label} (${tool.shortcut})`}
            aria-pressed={active}
            title={`${tool.label} (${tool.shortcut})`}
            className={cn(
              'flex size-9 items-center justify-center rounded-md transition-colors',
              active ? 'bg-roxo-eletrico text-branco-cru' : 'text-nevoa hover:bg-grafite-elevado hover:text-branco-cru',
            )}
          >
            <Icon size={16} />
          </button>
        );
      })}
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import {
  Copy,
  Download,
  ImagePlus,
  Info,
  Maximize2,
  MoreVertical,
  Pencil,
  Trash2,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useDeleteStudioAsset, useDeleteStudioJob } from '@/hooks/use-studio-assets';
import { downloadStudioGroup, loadProjectIntoStudio, useAssetAsReference } from '@/lib/studio-actions';
import { toast } from '@/stores/toast-store';
import type { StudioAsset } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';

interface MenuItem {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  danger?: boolean;
  onSelect: () => void;
}

// Altura estimada do menu (7 itens + separador) pra decidir se abre pra cima.
const MENU_HEIGHT = 300;

/** Menu ⋮ do card: todas as ações reais (visualizar, baixar, duplicar, usar como
 * referência, editar, detalhes, excluir com confirmação). Posição `fixed` pra não
 * ser cortado pelo overflow do card (mesmo padrão do menu de automações). */
export function AssetActionsMenu({
  group,
  insideStudio,
  onView,
  onDetails,
}: {
  group: StudioAsset[];
  /** true quando renderizado dentro do Studio (rota ou modal); false abre o StudioModal. */
  insideStudio: boolean;
  onView: () => void;
  onDetails: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const deleteAsset = useDeleteStudioAsset();
  const deleteJob = useDeleteStudioJob();

  const first = group[0]!;
  const isGroup = group.length > 1;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  function handleButtonClick() {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const openUpward = rect.bottom + MENU_HEIGHT > window.innerHeight && rect.top > MENU_HEIGHT;
      setPosition({
        top: openUpward ? rect.top - MENU_HEIGHT - 4 : rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
      setTimeout(() => itemRefs.current[0]?.focus(), 0);
    }
    setOpen((value) => !value);
  }

  async function handleDownload() {
    setBusy(true);
    try {
      await downloadStudioGroup(group);
      toast(isGroup ? 'Download do .zip iniciado.' : 'Download iniciado.', 'success');
    } catch {
      toast('Não foi possível baixar. Tente de novo.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleLoadIntoStudio() {
    setBusy(true);
    try {
      await loadProjectIntoStudio(first, insideStudio);
    } finally {
      setBusy(false);
    }
  }

  function handleDelete() {
    // Grupo (carousel) sai inteiro pelo job; asset avulso pelo próprio id.
    if (isGroup && first.jobId) {
      deleteJob.mutate(first.jobId, {
        onSuccess: () => {
          setConfirmingDelete(false);
          toast('Projeto excluído da galeria.', 'success');
        },
        onError: () => toast('Não foi possível excluir o projeto.', 'error'),
      });
    } else {
      deleteAsset.mutate(first.id, {
        onSuccess: () => {
          setConfirmingDelete(false);
          toast('Peça excluída da galeria.', 'success');
        },
        onError: () => toast('Não foi possível excluir a peça.', 'error'),
      });
    }
  }

  const sections: MenuItem[][] = [
    [
      { key: 'view', label: 'Visualizar', icon: Maximize2, onSelect: onView },
      { key: 'download', label: isGroup ? 'Baixar tudo (.zip)' : 'Baixar', icon: Download, onSelect: () => void handleDownload() },
    ],
    [
      { key: 'duplicate', label: 'Duplicar', icon: Copy, onSelect: () => void handleLoadIntoStudio() },
      { key: 'reference', label: 'Usar como referência', icon: ImagePlus, onSelect: () => useAssetAsReference(first, insideStudio) },
      { key: 'edit', label: 'Editar projeto', icon: Pencil, onSelect: () => void handleLoadIntoStudio() },
      { key: 'details', label: 'Ver detalhes', icon: Info, onSelect: onDetails },
    ],
    [
      { key: 'delete', label: 'Excluir', icon: Trash2, danger: true, onSelect: () => setConfirmingDelete(true) },
    ],
  ];
  const items = sections.flat();

  function handleMenuKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const current = itemRefs.current.findIndex((el) => el === document.activeElement);
    const next =
      event.key === 'ArrowDown'
        ? (current + 1) % items.length
        : (current - 1 + items.length) % items.length;
    itemRefs.current[next]?.focus();
  }

  let flatIndex = -1;

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={handleButtonClick}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Mais ações para ${first.filename}`}
        className="rounded-md p-1.5 text-nevoa transition-colors hover:bg-grafite-elevado hover:text-branco-cru disabled:opacity-50"
      >
        <MoreVertical size={14} />
      </button>

      {open && position && (
        <div
          role="menu"
          aria-label="Ações do projeto"
          onKeyDown={handleMenuKeyDown}
          style={{ position: 'fixed', top: position.top, right: position.right }}
          className="z-[95] w-52 rounded-lg border border-grafite-elevado bg-grafite p-1 shadow-elevated"
        >
          {sections.map((section, sectionIndex) => (
            <div key={sectionIndex}>
              {sectionIndex > 0 && <div className="my-1 border-t border-grafite-elevado" />}
              {section.map((item) => {
                flatIndex += 1;
                const index = flatIndex;
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    ref={(el) => {
                      itemRefs.current[index] = el;
                    }}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpen(false);
                      item.onSelect();
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
                      item.danger ? 'text-erro hover:bg-erro/10' : 'text-branco-cru hover:bg-grafite-elevado',
                    )}
                  >
                    <Icon size={14} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {confirmingDelete && (
          <ConfirmDialog
            title={isGroup ? 'Excluir projeto' : 'Excluir peça'}
            description={
              isGroup
                ? `Excluir este projeto e seus ${group.length} assets? Essa ação não pode ser desfeita.`
                : `Excluir "${first.filename}"? Essa ação não pode ser desfeita.`
            }
            isPending={deleteAsset.isPending || deleteJob.isPending}
            onConfirm={handleDelete}
            onCancel={() => setConfirmingDelete(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

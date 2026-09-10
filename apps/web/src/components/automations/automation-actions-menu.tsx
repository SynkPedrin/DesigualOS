'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Copy, History, MoreVertical, Pause, Pencil, Play, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  ToggleAutomationError,
  useDeleteAutomation,
  useDuplicateAutomation,
  useToggleAutomation,
} from '@/hooks/use-automations';
import type { Automation } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';

interface MenuItem {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  danger?: boolean;
  onSelect: () => void;
}

/** Feedback temporário ancorado no botão ⋮ com position fixed (não é cortado
 * pelo overflow da tabela). Sem toast system no app, é o padrão adotado aqui. */
function FeedbackPill({
  anchor,
  feedback,
}: {
  anchor: React.RefObject<HTMLButtonElement | null>;
  feedback: { message: string; error?: boolean };
}) {
  const [style, setStyle] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    const rect = anchor.current?.getBoundingClientRect();
    if (!rect) return;
    const opensUpward = rect.bottom + 70 > window.innerHeight;
    setStyle({
      top: opensUpward ? rect.top - 70 : rect.bottom + 4,
      right: window.innerWidth - rect.right,
    });
  }, [anchor]);

  if (!style) return null;
  return (
    <p
      role="status"
      style={{ position: 'fixed', top: style.top, right: style.right }}
      className={cn(
        'z-50 w-52 rounded-md border border-grafite-elevado bg-grafite px-2.5 py-1.5 text-xs shadow-elevated',
        feedback.error ? 'text-erro' : 'text-sucesso',
      )}
    >
      {feedback.message}
    </p>
  );
}

export function AutomationActionsMenu({
  automation,
  disabled = false,
  onRunNow,
  onEdit,
  onViewHistory,
}: {
  automation: Automation;
  disabled?: boolean;
  onRunNow: () => void;
  onEdit: () => void;
  onViewHistory: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const toggle = useToggleAutomation();
  const duplicate = useDuplicateAutomation();
  const deleteAutomation = useDeleteAutomation();

  useEffect(() => {
    if (!feedback) return;
    const timeout = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(timeout);
  }, [feedback]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  function handleToggle() {
    toggle.mutate(
      { id: automation.id, enabled: !automation.enabled },
      {
        onError: (error) => {
          if (error instanceof ToggleAutomationError) {
            setFeedback({ message: error.message, error: true });
          }
        },
      },
    );
  }

  function handleDuplicate() {
    duplicate.mutate(automation, {
      onSuccess: () => setFeedback({ message: 'Automação duplicada.' }),
      onError: () => setFeedback({ message: 'Não foi possível duplicar a automação.', error: true }),
    });
  }

  const sections: MenuItem[][] = [
    [
      { key: 'run', label: 'Executar agora', icon: Play, onSelect: onRunNow },
      { key: 'edit', label: 'Editar', icon: Pencil, onSelect: onEdit },
      { key: 'duplicate', label: 'Duplicar', icon: Copy, onSelect: handleDuplicate },
      { key: 'history', label: 'Ver histórico', icon: History, onSelect: onViewHistory },
    ],
    [
      automation.enabled
        ? { key: 'pause', label: 'Pausar', icon: Pause, onSelect: handleToggle }
        : { key: 'activate', label: 'Ativar', icon: Play, onSelect: handleToggle },
    ],
    [
      { key: 'delete', label: 'Excluir', icon: Trash2, danger: true, onSelect: () => setConfirmingDelete(true) },
    ],
  ];
  const items = sections.flat();

  // Altura estimada do menu (7 itens + 2 separadores) pra decidir se abre pra
  // baixo ou pra cima quando a linha está perto do fim da viewport.
  const MENU_HEIGHT = 290;
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);

  function handleButtonClick() {
    if (!open && buttonRef.current) {
      // `fixed` em vez de `absolute`: o dropdown não é cortado pelo
      // overflow-hidden da Surface nem vira scroll no overflow-x-auto da tabela.
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
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Ações da automação ${automation.name}`}
        className="rounded-md p-2 text-nevoa transition-colors hover:bg-grafite-elevado hover:text-branco-cru disabled:opacity-50"
      >
        <MoreVertical size={15} />
      </button>

      {open && position && (
        <div
          role="menu"
          aria-label="Ações da automação"
          onKeyDown={handleMenuKeyDown}
          style={{ position: 'fixed', top: position.top, right: position.right }}
          className="z-40 w-48 rounded-lg border border-grafite-elevado bg-grafite p-1 shadow-elevated"
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
                      item.danger
                        ? 'text-erro hover:bg-erro/10'
                        : 'text-branco-cru hover:bg-grafite-elevado',
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

      {feedback && (
        <FeedbackPill anchor={buttonRef} feedback={feedback} />
      )}

      <AnimatePresence>
        {confirmingDelete && (
          <ConfirmDialog
            title="Excluir automação"
            description={`Excluir "${automation.name}"? Ela para de disparar imediatamente. Essa ação não pode ser desfeita.`}
            isPending={deleteAutomation.isPending}
            onConfirm={() =>
              deleteAutomation.mutate(automation.id, { onSuccess: () => setConfirmingDelete(false) })
            }
            onCancel={() => setConfirmingDelete(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

'use client';

import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Ban, Image as ImageIcon, Palette, X } from 'lucide-react';
import { useUploadStudioReference } from '@/hooks/use-studio-jobs';
import type { UseCanvaEditorResult } from '@/hooks/use-canva-editor';
import { toast } from '@/stores/toast-store';
import { cn } from '@/lib/utils';

const SWATCHES = ['#ffffff', '#0f0f0f', '#9333ea', '#e1f900', '#1c1c1e', '#fafaf7', '#d946ef', '#6b21a8'];

export function BackgroundModal({ editor, onClose }: { editor: UseCanvaEditorResult; onClose: () => void }) {
  const current = editor.activePage?.background;
  const [color, setColor] = useState(current?.type === 'color' ? (current.value ?? '#ffffff') : '#ffffff');
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadStudioReference();

  async function handleImageFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    try {
      const result = await upload.mutateAsync(file);
      editor.setPageBackground({ type: 'image', value: result.url });
      onClose();
    } catch {
      toast('Não foi possível enviar a imagem de fundo.', 'error');
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-carbono/80 p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-sm rounded-lg border border-grafite-elevado bg-grafite p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-sm font-semibold uppercase tracking-wider text-branco-cru">Fundo da página</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded p-1 text-nevoa transition-colors hover:text-branco-cru">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-nevoa">
              <Palette size={11} /> Cor sólida
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {SWATCHES.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  onClick={() => {
                    setColor(swatch);
                    editor.setPageBackground({ type: 'color', value: swatch });
                  }}
                  className={cn(
                    'size-7 rounded-full border-2 transition-transform hover:scale-105',
                    current?.type === 'color' && current.value === swatch ? 'border-roxo-eletrico' : 'border-grafite-elevado',
                  )}
                  style={{ backgroundColor: swatch }}
                />
              ))}
              <input
                type="color"
                value={color}
                onChange={(event) => {
                  setColor(event.target.value);
                  editor.setPageBackground({ type: 'color', value: event.target.value });
                }}
                className="size-7 cursor-pointer rounded-full border-none bg-transparent"
                title="Cor personalizada"
              />
            </div>
          </div>

          <div>
            <p className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-nevoa">
              <ImageIcon size={11} /> Imagem
            </p>
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => void handleImageFile(event.target.files)}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={upload.isPending}
              className="w-full rounded-md border border-dashed border-grafite-elevado bg-carbono px-3 py-3 text-xs text-nevoa transition-colors hover:border-roxo-eletrico/60 disabled:opacity-60"
            >
              {upload.isPending ? 'Enviando...' : 'Enviar imagem de fundo'}
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              editor.setPageBackground({ type: 'transparent' });
              onClose();
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-xs text-nevoa transition-colors hover:border-roxo-eletrico/60 hover:text-branco-cru"
          >
            <Ban size={13} />
            Transparente
          </button>
        </div>
      </motion.div>
    </div>
  );
}

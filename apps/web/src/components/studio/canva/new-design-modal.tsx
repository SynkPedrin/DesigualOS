'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { FlipVertical, X } from 'lucide-react';
import { CANVA_SIZE_PRESETS, type CanvaSizePresetId } from '@desigual-os/types';
import { useCreateCanvaDocument } from '@/hooks/use-canva-documents';
import { ApiRequestError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type PresetChoice = CanvaSizePresetId | 'custom';

export function NewDesignModal({
  clientId,
  onClose,
  onCreated,
}: {
  clientId: string;
  onClose: () => void;
  onCreated: (documentId: string) => void;
}) {
  const [presetId, setPresetId] = useState<PresetChoice>('instagram-post');
  const [customWidth, setCustomWidth] = useState(1080);
  const [customHeight, setCustomHeight] = useState(1080);
  const [orientationFlipped, setOrientationFlipped] = useState(false);
  const [name, setName] = useState('');
  const createDocument = useCreateCanvaDocument();

  const preset = CANVA_SIZE_PRESETS.find((p) => p.id === presetId);
  const baseWidth = preset ? preset.width : customWidth;
  const baseHeight = preset ? preset.height : customHeight;
  const width = orientationFlipped ? baseHeight : baseWidth;
  const height = orientationFlipped ? baseWidth : baseHeight;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    createDocument.mutate(
      {
        clientId,
        name: name.trim() || preset?.label || 'Sem título',
        width,
        height,
      },
      { onSuccess: (doc) => onCreated(doc.id) },
    );
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-carbono/80 p-4">
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="w-full max-w-lg rounded-lg border border-grafite-elevado bg-grafite p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-sm font-semibold uppercase tracking-wider text-branco-cru">Novo design</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded p-1 text-nevoa transition-colors hover:text-branco-cru"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="design-name" className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">
              Nome
            </label>
            <input
              id="design-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={preset?.label ?? 'Meu design'}
              className="w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru placeholder:text-nevoa focus:border-roxo-eletrico/60 focus:outline-none"
            />
          </div>

          <div>
            <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-nevoa">Formato</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {CANVA_SIZE_PRESETS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setPresetId(option.id)}
                  className={cn(
                    'rounded-md border px-3 py-2 text-left text-xs transition-colors',
                    presetId === option.id
                      ? 'border-roxo-eletrico bg-roxo-eletrico/10 text-branco-cru'
                      : 'border-grafite-elevado text-nevoa hover:border-nevoa/40 hover:text-branco-cru',
                  )}
                >
                  <span className="block font-medium">{option.label}</span>
                  <span className="block font-mono text-[10px] text-nevoa">
                    {option.width}×{option.height}
                  </span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPresetId('custom')}
                className={cn(
                  'rounded-md border px-3 py-2 text-left text-xs transition-colors',
                  presetId === 'custom'
                    ? 'border-roxo-eletrico bg-roxo-eletrico/10 text-branco-cru'
                    : 'border-grafite-elevado text-nevoa hover:border-nevoa/40 hover:text-branco-cru',
                )}
              >
                <span className="block font-medium">Tamanho personalizado</span>
              </button>
            </div>
          </div>

          {presetId === 'custom' ? (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label htmlFor="width" className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">
                  Largura (px)
                </label>
                <input
                  id="width"
                  type="number"
                  min={1}
                  value={customWidth}
                  onChange={(event) => setCustomWidth(Math.max(1, Number(event.target.value)))}
                  className="w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
                />
              </div>
              <div className="flex-1">
                <label htmlFor="height" className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">
                  Altura (px)
                </label>
                <input
                  id="height"
                  type="number"
                  min={1}
                  value={customHeight}
                  onChange={(event) => setCustomHeight(Math.max(1, Number(event.target.value)))}
                  className="w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
                />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-md border border-grafite-elevado bg-carbono px-3 py-2">
              <span className="font-mono text-xs text-nevoa">
                {width}×{height}px
              </span>
              <button
                type="button"
                onClick={() => setOrientationFlipped((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-nevoa transition-colors hover:text-branco-cru"
                title="Inverter orientação"
              >
                <FlipVertical size={13} />
                Orientação
              </button>
            </div>
          )}

          {createDocument.isError && (
            <p className="text-xs text-erro">
              {createDocument.error instanceof ApiRequestError ? createDocument.error.message : 'Não foi possível criar o design.'}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm text-nevoa transition-colors hover:text-branco-cru">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={createDocument.isPending || width < 1 || height < 1}
              className="rounded-md bg-roxo-eletrico px-4 py-2 text-sm font-medium text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:opacity-50 disabled:hover:shadow-none"
            >
              {createDocument.isPending ? 'Criando...' : 'Criar design'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useCreateClient } from '@/hooks/use-clients';
import { ApiRequestError } from '@/lib/api/client';

function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos (á -> a)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Cliente criado à mão, sem lista do ClickUp vinculada — dá pra linkar depois pela
 * sincronização de Configurações → Integrações. */
export function CreateClientModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [slug, setSlug] = useState('');
  const createClient = useCreateClient();

  const effectiveSlug = slugTouched ? slug : slugify(name);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !effectiveSlug) return;
    createClient.mutate(
      { name: name.trim(), slug: effectiveSlug },
      { onSuccess: onClose },
    );
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-carbono/80 p-4">
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="w-full max-w-sm rounded-lg border border-grafite-elevado bg-grafite p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-sm font-semibold uppercase tracking-wider text-branco-cru">
            Novo projeto
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded p-1 text-nevoa transition-colors hover:text-branco-cru"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label htmlFor="client-name" className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">
              Nome do cliente
            </label>
            <input
              id="client-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex: Loja Nova"
              className="w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru placeholder:text-nevoa focus:border-roxo-eletrico/60 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="client-slug" className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">
              Identificador (slug)
            </label>
            <input
              id="client-slug"
              value={effectiveSlug}
              onChange={(event) => {
                setSlugTouched(true);
                setSlug(slugify(event.target.value));
              }}
              placeholder="loja-nova"
              className="w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru placeholder:text-nevoa focus:border-roxo-eletrico/60 focus:outline-none"
            />
          </div>

          {createClient.isError && (
            <p className="text-xs text-erro">
              {createClient.error instanceof ApiRequestError
                ? createClient.error.message
                : 'Não foi possível criar o projeto.'}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-2 text-sm text-nevoa transition-colors hover:text-branco-cru"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={createClient.isPending || !name.trim() || !effectiveSlug}
              className="rounded-md bg-roxo-eletrico px-4 py-2 text-sm font-medium text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:opacity-50 disabled:hover:shadow-none"
            >
              {createClient.isPending ? 'Criando...' : 'Criar projeto'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

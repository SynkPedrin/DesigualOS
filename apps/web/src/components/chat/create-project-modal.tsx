'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useCreateProject } from '@/hooks/use-projects';
import { useClients } from '@/hooks/use-clients';
import { ApiRequestError } from '@/lib/api/client';

/** Projeto do chat (seção "Projetos" da sidebar): nome + cliente opcional. */
export function CreateProjectModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [clientId, setClientId] = useState<string | null>(null);
  const { data: clients } = useClients();
  const createProject = useCreateProject();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    createProject.mutate(
      { name: name.trim(), client_id: clientId },
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
            <label htmlFor="project-name" className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">
              Nome do projeto
            </label>
            <input
              id="project-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex: Campanhas 3net"
              className="w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru placeholder:text-nevoa focus:border-roxo-eletrico/60 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="project-client" className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">
              Cliente (opcional)
            </label>
            <select
              id="project-client"
              value={clientId ?? ''}
              onChange={(event) => setClientId(event.target.value || null)}
              className="w-full appearance-none rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
            >
              <option value="">Sem cliente</option>
              {clients?.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </div>

          {createProject.isError && (
            <p className="text-xs text-erro">
              {createProject.error instanceof ApiRequestError
                ? createProject.error.message
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
              disabled={createProject.isPending || !name.trim()}
              className="rounded-md bg-roxo-eletrico px-4 py-2 text-sm font-medium text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:opacity-50 disabled:hover:shadow-none"
            >
              {createProject.isPending ? 'Criando...' : 'Criar projeto'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

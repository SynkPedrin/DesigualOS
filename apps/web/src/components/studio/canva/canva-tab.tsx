'use client';

import { useState } from 'react';
import { useClients } from '@/hooks/use-clients';
import { CanvaEditor } from './canva-editor';

/**
 * Wrapper carregado via next/dynamic(ssr:false) em studio-content.tsx: só ele
 * (e tudo que importa, incluindo fabric.js) nunca deve ser avaliado no
 * servidor. Seletor de cliente próprio, independente do filtro da Galeria -
 * documentos do Canva são sempre por cliente (sem "todos" pro master aqui).
 */
export default function CanvaTab() {
  const { data: clients } = useClients();
  const [clientId, setClientId] = useState('');

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">Canva</h2>
        <select
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
          aria-label="Cliente"
          className="rounded-md border border-grafite-elevado bg-carbono px-2.5 py-1.5 text-xs text-branco-cru transition-colors focus:border-roxo-eletrico/60 focus:outline-none"
        >
          <option value="">Selecione um cliente</option>
          {clients?.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
      </div>

      <CanvaEditor clientId={clientId || null} />
    </div>
  );
}

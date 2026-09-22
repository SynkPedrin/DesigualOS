'use client';

import { useCallback, useState } from 'react';
import { useClients } from '@/hooks/use-clients';
import { cn } from '@/lib/utils';
import { CanvaEditor } from './canva-editor';

/**
 * Wrapper carregado via next/dynamic(ssr:false) em studio-content.tsx: só ele
 * (e tudo que importa, incluindo fabric.js) nunca deve ser avaliado no
 * servidor. Seletor de cliente próprio, independente do filtro da Galeria -
 * documentos do Canva são sempre por cliente (sem "todos" pro master aqui).
 */
export default function CanvaTab({ onEditorOpenChange }: { onEditorOpenChange?: (open: boolean) => void } = {}) {
  const { data: clients } = useClients();
  const [clientId, setClientId] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);

  const handleEditorOpenChange = useCallback(
    (open: boolean) => {
      setEditorOpen(open);
      onEditorOpenChange?.(open);
    },
    [onEditorOpenChange],
  );

  return (
    <div className={cn('flex min-h-0 flex-col', editorOpen ? 'h-full' : 'space-y-3')}>
      {/* Com o editor aberto, o cabeçalho e o seletor saem de cena: o cliente
        * do documento já está definido e essa faixa só roubava altura útil do
        * artboard. Voltar ao grid traz os dois de volta. */}
      <div className={cn('flex shrink-0 items-center justify-between', editorOpen && 'hidden')}>
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

      <CanvaEditor clientId={clientId || null} onEditorOpenChange={handleEditorOpenChange} />
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { usePessoas, type PessoaResumoWire } from '@/hooks/use-gestao-comercial';
import { Campo, CAMPO } from '../kit';

/**
 * Escolhe um cadastro por papel (cliente, fornecedor...). Busca no servidor enquanto a pessoa digita
 * e guarda o escolhido à parte, para o nome não sumir quando a busca muda.
 */
export function SeletorDePessoa({ rotulo, papel, valor, onChange, obrigatorio = false, ajuda }: { rotulo: string; papel: 'cliente' | 'fornecedor' | 'veiculo_midia' | 'prestador'; valor: PessoaResumoWire | null; onChange: (p: PessoaResumoWire | null) => void; obrigatorio?: boolean; ajuda?: string }) {
  const [busca, setBusca] = useState('');
  const [termo, setTermo] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setTermo(busca.trim()), 250);
    return () => clearTimeout(t);
  }, [busca]);
  const { data, isFetching } = usePessoas(papel, termo);
  const opcoes = data?.items ?? [];
  return (
    <Campo rotulo={rotulo + (obrigatorio ? ' *' : '')} ajuda={ajuda ?? (valor ? undefined : 'Digite parte do nome ou do documento para buscar.')}>
      {(p) => (
        <div className="space-y-1.5">
          {valor && (
            <div className="flex items-center justify-between gap-2 rounded-md border border-sinal/50 bg-carbono px-3 py-2 text-sm text-branco-cru">
              <span className="min-w-0 truncate">{valor.name}</span>
              <button type="button" onClick={() => onChange(null)} className="shrink-0 text-xs text-nevoa underline hover:text-branco-cru">Trocar</button>
            </div>
          )}
          {!valor && (
            <>
              <input {...p} type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar…" className={CAMPO} autoComplete="off" />
              <ul role="listbox" aria-label={`Resultados para ${rotulo}`} className="max-h-40 overflow-y-auto rounded-md border border-grafite-elevado bg-carbono text-sm">
                {isFetching && opcoes.length === 0 && <li className="px-3 py-2 text-nevoa">Buscando…</li>}
                {!isFetching && opcoes.length === 0 && <li className="px-3 py-2 text-nevoa">Nenhum cadastro com esse papel{termo ? ' para essa busca' : ''}.</li>}
                {opcoes.map((o) => (
                  <li key={o.id} role="option" aria-selected={false}>
                    <button type="button" onClick={() => { onChange(o); setBusca(''); }} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-branco-cru hover:bg-grafite-elevado">
                      <span className="min-w-0 truncate">{o.name}</span>
                      {o.document && <span className="shrink-0 font-mono text-[11px] text-nevoa">{o.document}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </Campo>
  );
}

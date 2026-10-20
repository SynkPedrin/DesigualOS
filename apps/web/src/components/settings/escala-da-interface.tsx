'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * TAMANHO DA INTERFACE. O padrão ("Automático") já cresce com a largura da tela
 * (ver `html` em styles/tokens.css); este seletor deixa cada pessoa ajustar para mais ou para menos
 * em cima disso. É preferência DO NAVEGADOR de quem usa (localStorage), como o cache do tema:
 * o monitor de 27" do Pedro e o notebook da Alicia não precisam do mesmo número.
 */
const OPCOES = [
  { value: 'compact', label: 'Compacto', hint: 'Mais coisa na tela' },
  { value: 'auto', label: 'Automático', hint: 'Acompanha o tamanho da tela' },
  { value: 'comfortable', label: 'Confortável', hint: 'Um pouco maior' },
  { value: 'large', label: 'Grande', hint: 'Bem maior, para leitura' },
] as const;

type Escala = (typeof OPCOES)[number]['value'];
const CHAVE = 'desigual:ui-scale';

export function aplicarEscala(valor: Escala): void {
  if (valor === 'auto') document.documentElement.removeAttribute('data-ui-scale');
  else document.documentElement.setAttribute('data-ui-scale', valor);
}

export function EscalaDaInterface() {
  const [escala, setEscala] = useState<Escala>('auto');

  useEffect(() => {
    try {
      const salvo = window.localStorage.getItem(CHAVE) as Escala | null;
      if (salvo && OPCOES.some((o) => o.value === salvo)) setEscala(salvo);
    } catch {
      /* sem storage: fica no automático */
    }
  }, []);

  function escolher(valor: Escala) {
    setEscala(valor);
    aplicarEscala(valor);
    try {
      if (valor === 'auto') window.localStorage.removeItem(CHAVE);
      else window.localStorage.setItem(CHAVE, valor);
    } catch {
      /* a mudança vale nesta sessão mesmo sem storage */
    }
  }

  return (
    <div className="flex flex-col gap-2" role="radiogroup" aria-label="Tamanho da interface">
      {OPCOES.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={escala === o.value}
          onClick={() => escolher(o.value)}
          className={cn(
            'flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors',
            escala === o.value ? 'border-roxo-eletrico bg-roxo-eletrico/10 text-branco-cru' : 'border-grafite-elevado text-nevoa hover:text-branco-cru',
          )}
        >
          <span>{o.label}</span>
          <span className="text-xs text-nevoa">{o.hint}</span>
        </button>
      ))}
    </div>
  );
}

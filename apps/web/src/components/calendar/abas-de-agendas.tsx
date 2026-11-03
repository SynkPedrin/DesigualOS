'use client';

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { MenuDoCabecalho } from '@/components/inbox/menu-do-cabecalho';
import { cn } from '@/lib/utils';
import { TODAS, type AgendaPintada } from './cores-das-agendas';

/**
 * Uma aba por agenda do Outlook (pedido do Pedro, 03/11/2026: "uma aba pra eu ver calendário da Desigual, calendário
 * da Manada Filmes"), no Calendário e no Daily. "Todas" junta tudo; o "+ Agenda" traz as agendas da conta que ainda
 * não foram vinculadas, para nenhuma ficar de fora sem a pessoa saber que existe.
 */

export interface AbaExtra {
  id: string;
  rotulo: string;
}

/**
 * A aba escolhida, lembrada neste navegador (conveniência: sem armazenamento, começa em "Todas"). Aba que não existe
 * mais (agenda desvinculada) vale como "Todas".
 */
export function useAbaDeAgenda(chave: string, agendas: AgendaPintada[], extras: AbaExtra[] = []): [string, (aba: string) => void] {
  const [aba, setAba] = useState(TODAS);
  useEffect(() => {
    try {
      const salva = localStorage.getItem(chave);
      if (salva) setAba(salva);
    } catch {
      /* navegador sem armazenamento: fica em "Todas" */
    }
  }, [chave]);
  function escolher(nova: string) {
    setAba(nova);
    try {
      localStorage.setItem(chave, nova);
    } catch {
      /* idem */
    }
  }
  const existe = aba === TODAS || agendas.some((a) => a.id === aba) || extras.some((e) => e.id === aba);
  return [existe ? aba : TODAS, escolher];
}

export function AbasDeAgendas({ agendas, ativa, onEscolher, contagem, extras = [], paraAdicionar = [], onAdicionar, adicionando = false }: {
  agendas: AgendaPintada[];
  ativa: string;
  onEscolher: (aba: string) => void;
  /** Número ao lado do nome de cada aba (eventos no período na tela). */
  contagem?: Map<string, number> | undefined;
  extras?: AbaExtra[];
  paraAdicionar?: Array<{ id: string; nome: string }>;
  onAdicionar?: (id: string) => void;
  adicionando?: boolean;
}) {
  if (agendas.length === 0 && paraAdicionar.length === 0) return null;

  const aba = (id: string, rotulo: string, ponto?: string) => (
    <button
      key={id}
      type="button"
      role="tab"
      aria-selected={ativa === id}
      onClick={() => onEscolher(id)}
      className={cn(
        'flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors',
        ativa === id ? 'border-roxo-eletrico bg-roxo-eletrico/15 text-branco-cru' : 'border-grafite-elevado text-nevoa hover:border-roxo-eletrico/60 hover:text-branco-cru',
      )}
    >
      {ponto && <span aria-hidden className={cn('size-2 rounded-full', ponto)} />}
      {rotulo}
      {contagem?.has(id) && <span className="tabular-nums text-nevoa">{contagem.get(id)}</span>}
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div role="tablist" aria-label="Agendas" className="flex flex-wrap items-center gap-1.5">
        {aba(TODAS, 'Todas')}
        {agendas.map((a) => aba(a.id, a.nome, a.cor.ponto))}
        {extras.map((e) => aba(e.id, e.rotulo))}
      </div>
      {paraAdicionar.length > 0 && onAdicionar && (
        <MenuDoCabecalho
          rotulo="Adicionar agenda"
          texto={adicionando ? 'Vinculando…' : 'Agenda'}
          icone={<Plus size={13} />}
          alinhar="esquerda"
          classeDoBotao="flex h-8 items-center gap-1 rounded-full border border-dashed border-grafite-elevado px-3 text-xs text-nevoa hover:border-roxo-eletrico/60 hover:text-branco-cru"
          itens={paraAdicionar.map((c) => ({ rotulo: c.nome, acao: () => onAdicionar(c.id) }))}
        />
      )}
    </div>
  );
}

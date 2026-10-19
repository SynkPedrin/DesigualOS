'use client';

import { useState } from 'react';
import { Check, ChevronDown, Users } from 'lucide-react';
import { EntityAvatar } from '@/components/ui/entity-avatar';
import type { ColaboradorDaAgenda } from '@/components/calendar/resource-timeline-view';

/** Seleção de colaboradores para o Calendário da Agência (§7: "permitir
 * selecionar colaboradores", "não sobrepor todos os calendários numa única
 * bagunça visual" — por isso a tela não abre com todo mundo marcado). */
export function ResourcePicker({
  colaboradores,
  selecionados,
  onAlternar,
}: {
  colaboradores: ColaboradorDaAgenda[];
  selecionados: Set<string>;
  onAlternar: (userId: string) => void;
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border border-grafite-elevado px-3 py-1.5 text-sm text-nevoa hover:text-branco-cru"
      >
        <Users size={14} />
        {selecionados.size === 0 ? 'Colaboradores' : `${selecionados.size} colaborador${selecionados.size > 1 ? 'es' : ''}`}
        <ChevronDown size={14} />
      </button>

      {aberto && (
        <>
          <div className="fixed inset-0 z-[95]" onClick={() => setAberto(false)} />
          <div className="absolute left-0 top-full z-[96] mt-1 max-h-80 w-64 overflow-y-auto rounded-lg border border-grafite-elevado bg-grafite p-1.5 shadow-xl">
            {colaboradores.map((colaborador) => {
              const marcado = selecionados.has(colaborador.userId);
              return (
                <button
                  key={colaborador.userId}
                  type="button"
                  onClick={() => onAlternar(colaborador.userId)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-branco-cru hover:bg-grafite-elevado"
                >
                  <EntityAvatar name={colaborador.name} photoUrl={colaborador.avatarUrl} kind="person" size="sm" />
                  <span className="min-w-0 flex-1 truncate">{colaborador.name}</span>
                  {marcado && <Check size={14} className="shrink-0 text-roxo-eletrico" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

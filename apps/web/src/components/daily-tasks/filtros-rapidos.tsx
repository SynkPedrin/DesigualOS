'use client';

import { useMemo, useState } from 'react';
import { CalendarDays, Check, ChevronDown, UserRound } from 'lucide-react';
import type { WorkMember } from '@/hooks/use-work';
import { diaEmSaoPaulo } from '@/lib/prazo';
import { cn } from '@/lib/utils';
import { CampoDeData, rotuloDoDia } from './calendario';
import { Avatar, Popover } from './primitivas';

/**
 * Responsável e prazo direto na barra do Daily (pedido do Pedro, 29/10/2026). Os dois já existiam, mas escondidos no
 * botão "Filtros" e com três opções de prazo; aqui ficam à vista, o responsável com busca e o prazo com atrasadas,
 * amanhã e um período escolhido no calendário. O estado continua sendo o da página (e do endereço).
 */

export type Prazo = '' | 'atrasadas' | 'hoje' | 'amanha' | 'semana' | 'mes' | 'periodo';

export const ROTULO_DO_PRAZO: Record<Exclude<Prazo, ''>, string> = {
  atrasadas: 'Atrasadas', hoje: 'Vence hoje', amanha: 'Vence amanhã', semana: 'Próximos 7 dias', mes: 'Este mês', periodo: 'Período',
};

const somarDias = (dia: string, n: number) => { const d = new Date(`${dia}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const inicioDoDia = (dia: string) => new Date(`${dia}T00:00:00-03:00`);
const fimDoDia = (dia: string) => new Date(inicioDoDia(somarDias(dia, 1)).getTime() - 1);

/** O prazo escolhido → a janela que a API filtra (dias de São Paulo). Atrasadas só olha as abertas. */
export function janelaDoPrazo(prazo: Prazo, de: string | null, ate: string | null, agora = new Date()): { dueFrom?: string; dueTo?: string; soAbertas?: boolean } {
  const hoje = diaEmSaoPaulo(agora);
  const janela = (ini: string | null, fim: string | null) => ({ ...(ini ? { dueFrom: inicioDoDia(ini).toISOString() } : {}), ...(fim ? { dueTo: fimDoDia(fim).toISOString() } : {}) });
  switch (prazo) {
    case 'atrasadas': return { dueTo: new Date(inicioDoDia(hoje).getTime() - 1).toISOString(), soAbertas: true };
    case 'hoje': return janela(hoje, hoje);
    case 'amanha': return janela(somarDias(hoje, 1), somarDias(hoje, 1));
    case 'semana': return janela(hoje, somarDias(hoje, 6));
    case 'mes': { const ini = `${hoje.slice(0, 8)}01`; const prox = new Date(`${ini}T12:00:00Z`); prox.setUTCMonth(prox.getUTCMonth() + 1); return janela(ini, somarDias(prox.toISOString().slice(0, 10), -1)); }
    case 'periodo': return de || ate ? janela(de, ate) : {};
    default: return {};
  }
}

export function rotuloDoPeriodo(prazo: Prazo, de: string | null, ate: string | null): string {
  if (!prazo) return 'Prazo';
  if (prazo !== 'periodo') return ROTULO_DO_PRAZO[prazo];
  if (de && ate) return de === ate ? rotuloDoDia(de) : `${rotuloDoDia(de)} – ${rotuloDoDia(ate)}`;
  if (de) return `a partir de ${rotuloDoDia(de)}`;
  if (ate) return `até ${rotuloDoDia(ate)}`;
  return 'Período';
}

const gatilho = (ativo: boolean) => cn('flex max-w-56 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm transition-colors', ativo ? 'border-roxo-eletrico/60 bg-roxo-eletrico/15 text-branco-cru' : 'border-grafite-elevado text-branco-cru hover:border-roxo-eletrico/60');
const opcao = 'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-branco-cru hover:bg-grafite-elevado';

export function FiltroDeResponsavel({ membros, valor, semResponsavel, eu, onEscolher }: {
  membros: WorkMember[];
  valor: string | null;
  semResponsavel: boolean;
  eu: string | null;
  /** `null` = todos; `'sem'` = sem responsável; senão o id da pessoa. */
  onEscolher: (v: string | null | 'sem') => void;
}) {
  const [busca, setBusca] = useState('');
  const escolhido = membros.find((m) => m.id === valor) ?? null;
  const lista = useMemo(() => {
    const t = busca.trim().toLocaleLowerCase('pt-BR');
    const ordenados = [...membros].sort((a, b) => (a.id === eu ? -1 : b.id === eu ? 1 : a.name.localeCompare(b.name, 'pt-BR')));
    return t ? ordenados.filter((m) => m.name.toLocaleLowerCase('pt-BR').includes(t)) : ordenados;
  }, [membros, busca, eu]);
  const rotulo = semResponsavel ? 'Sem responsável' : escolhido ? (escolhido.id === eu ? 'Eu' : escolhido.name) : 'Responsável';
  return (
    <Popover label="Filtrar por responsável" alturaMax={420} largura={260}
      trigger={<span className={gatilho(Boolean(escolhido) || semResponsavel)}>{escolhido ? <Avatar nome={escolhido.name} url={escolhido.avatarUrl} size={16} /> : <UserRound size={14} />}<span className="truncate">{rotulo}</span><ChevronDown size={13} className="shrink-0 text-nevoa" /></span>}>
      {(fechar) => {
        const escolher = (v: string | null | 'sem') => { onEscolher(v); setBusca(''); fechar(); };
        return (
          <div className="w-60">
            <input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pessoa..." aria-label="Buscar pessoa"
              className="mb-1 w-full rounded border border-grafite-elevado bg-grafite px-2 py-1.5 text-xs text-branco-cru outline-none placeholder:text-nevoa/60 focus:border-roxo-eletrico/50" />
            {!busca && (
              <>
                <button type="button" className={opcao} onClick={() => escolher(null)}>Todos{!valor && !semResponsavel && <Check size={12} className="ml-auto" />}</button>
                <button type="button" className={opcao} onClick={() => escolher('sem')}>Sem responsável{semResponsavel && <Check size={12} className="ml-auto" />}</button>
                <div className="my-1 border-t border-grafite-elevado" />
              </>
            )}
            {lista.map((m) => (
              <button key={m.id} type="button" className={opcao} onClick={() => escolher(m.id)}>
                <Avatar nome={m.name} url={m.avatarUrl} size={18} />
                <span className="truncate">{m.id === eu ? `${m.name} (eu)` : m.name}</span>
                {m.soNoClickUp && <span className="shrink-0 text-[10px] text-nevoa/60">ClickUp</span>}
                {valor === m.id && <Check size={12} className="ml-auto shrink-0" />}
              </button>
            ))}
            {lista.length === 0 && <p className="px-2 py-3 text-center text-xs text-nevoa">Ninguém com esse nome.</p>}
          </div>
        );
      }}
    </Popover>
  );
}

export function FiltroDePrazo({ prazo, de, ate, onMudar }: { prazo: Prazo; de: string | null; ate: string | null; onMudar: (p: Prazo, de: string | null, ate: string | null) => void }) {
  return (
    <Popover label="Filtrar por prazo" alturaMax={460} largura={260}
      trigger={<span className={gatilho(Boolean(prazo))}><CalendarDays size={14} /><span className="truncate">{rotuloDoPeriodo(prazo, de, ate)}</span><ChevronDown size={13} className="shrink-0 text-nevoa" /></span>}>
      {(fechar) => (
        <div className="w-60">
          {(['', 'atrasadas', 'hoje', 'amanha', 'semana', 'mes'] as const).map((p) => (
            <button key={p || 'qualquer'} type="button" className={opcao} onClick={() => { onMudar(p, null, null); fechar(); }}>
              {p ? ROTULO_DO_PRAZO[p] : 'Qualquer prazo'}{prazo === p && <Check size={12} className="ml-auto" />}
            </button>
          ))}
          <div className="mt-1 border-t border-grafite-elevado px-2 pb-1 pt-2 text-xs text-nevoa">
            <p className="mb-1.5">Período</p>
            <div className="grid gap-1.5">
              <span className="flex items-center justify-between gap-2">De <CampoDeData rotulo="Prazo a partir de" vazio="escolher" valor={prazo === 'periodo' ? de : null} onChange={(d) => onMudar('periodo', d, prazo === 'periodo' ? ate : null)} /></span>
              <span className="flex items-center justify-between gap-2">Até <CampoDeData rotulo="Prazo até" vazio="escolher" valor={prazo === 'periodo' ? ate : null} onChange={(d) => onMudar('periodo', prazo === 'periodo' ? de : null, d)} /></span>
            </div>
          </div>
        </div>
      )}
    </Popover>
  );
}

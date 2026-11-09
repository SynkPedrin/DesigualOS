'use client';

import { useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { diaEmSaoPaulo } from '@/lib/prazo';
import { cn } from '@/lib/utils';
import { Popover } from './primitivas';

/**
 * Calendário do Daily, no lugar do `<input type="date">` do navegador (pedido do Pedro, 29/10/2026: "o calendário
 * está muito feio"). Trabalha com o dia como texto `AAAA-MM-DD` no fuso de São Paulo; quem chama decide o horário.
 */

const SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const doisDigitos = (n: number) => String(n).padStart(2, '0');
const textoDoDia = (a: number, m: number, d: number) => `${a}-${doisDigitos(m + 1)}-${doisDigitos(d)}`;
function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const diaDaSemana = (dia: string) => new Date(`${dia}T12:00:00Z`).getUTCDay();

/** "AAAA-MM-DD" → "29 out" (com o ano só quando não é o corrente). */
export function rotuloDoDia(dia: string): string {
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number];
  const ano = Number(diaEmSaoPaulo(new Date()).slice(0, 4));
  return `${d} ${MESES[m - 1]!.slice(0, 3)}${a !== ano ? ` ${a}` : ''}`;
}

/** Dia escolhido → instante salvo (meio-dia de São Paulo, o mesmo que o campo antigo gravava). */
export const instanteDoDia = (dia: string | null): string | null => (dia ? new Date(`${dia}T12:00:00-03:00`).toISOString() : null);

export function Calendario({ valor, onEscolher }: { valor: string | null; onEscolher: (dia: string | null) => void }) {
  const hoje = diaEmSaoPaulo(new Date());
  const base = valor ?? hoje;
  const [mes, setMes] = useState(() => ({ ano: Number(base.slice(0, 4)), mes: Number(base.slice(5, 7)) - 1 }));

  const primeiro = new Date(Date.UTC(mes.ano, mes.mes, 1)).getUTCDay();
  const diasNoMes = new Date(Date.UTC(mes.ano, mes.mes + 1, 0)).getUTCDate();
  const inicio = somarDias(textoDoDia(mes.ano, mes.mes, 1), -primeiro);
  const celulas = Array.from({ length: 42 }, (_, i) => somarDias(inicio, i));
  const semanas = primeiro + diasNoMes > 35 ? 6 : 5;
  const andar = (n: number) => setMes((m) => { const d = new Date(Date.UTC(m.ano, m.mes + n, 1)); return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() }; });

  const proximaSegunda = somarDias(hoje, ((8 - diaDaSemana(hoje)) % 7) || 7);
  const atalhos: Array<[string, string]> = [['Hoje', hoje], ['Amanhã', somarDias(hoje, 1)], ['Próx. segunda', proximaSegunda], ['Em 1 semana', somarDias(hoje, 7)]];

  return (
    <div className="w-64 p-2">
      <div className="mb-2 grid grid-cols-2 gap-1">
        {atalhos.map(([rotulo, dia]) => (
          <button key={rotulo} type="button" onClick={() => onEscolher(dia)} className={cn('rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-grafite-elevado', dia === valor ? 'bg-roxo-eletrico/15 text-branco-cru' : 'text-branco-cru/85')}>
            {rotulo}<span className="ml-1 text-nevoa/70">{rotuloDoDia(dia)}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-grafite-elevado px-1 pb-1 pt-2">
        <span className="text-sm font-semibold capitalize text-branco-cru">{MESES[mes.mes]} {mes.ano}</span>
        <span className="flex items-center gap-0.5">
          <button type="button" aria-label="Mês anterior" onClick={() => andar(-1)} className="flex size-7 items-center justify-center rounded-md text-nevoa hover:bg-grafite-elevado hover:text-branco-cru"><ChevronLeft size={15} /></button>
          <button type="button" aria-label="Mês seguinte" onClick={() => andar(1)} className="flex size-7 items-center justify-center rounded-md text-nevoa hover:bg-grafite-elevado hover:text-branco-cru"><ChevronRight size={15} /></button>
        </span>
      </div>
      <div className="grid grid-cols-7 text-center">
        {SEMANA.map((d, i) => <span key={i} className="py-1 font-mono text-[10px] uppercase text-nevoa/60">{d}</span>)}
        {celulas.slice(0, semanas * 7).map((dia) => {
          const doMes = Number(dia.slice(5, 7)) - 1 === mes.mes;
          const escolhido = dia === valor;
          const ehHoje = dia === hoje;
          return (
            <button
              key={dia}
              type="button"
              aria-label={rotuloDoDia(dia)}
              aria-pressed={escolhido}
              onClick={() => onEscolher(dia)}
              className={cn(
                'mx-auto flex size-8 items-center justify-center rounded-full text-xs tabular-nums transition-colors',
                escolhido ? 'bg-roxo-eletrico font-semibold text-white' : 'hover:bg-grafite-elevado',
                !escolhido && (doMes ? 'text-branco-cru' : 'text-nevoa/40'),
                !escolhido && ehHoje && 'font-semibold text-roxo-eletrico ring-1 ring-roxo-eletrico/60',
              )}
            >
              {Number(dia.slice(8, 10))}
            </button>
          );
        })}
      </div>
      {valor && (
        <button type="button" onClick={() => onEscolher(null)} className="mt-2 flex w-full items-center justify-center gap-1 rounded-md border-t border-grafite-elevado pt-2 text-xs text-nevoa hover:text-branco-cru">
          <X size={12} /> Limpar data
        </button>
      )}
    </div>
  );
}

/** Campo de data para formulários: um botão com o dia (ou o texto de vazio) que abre o calendário. */
export function CampoDeData({ valor, onChange, vazio = 'Sem data', rotulo }: { valor: string | null; onChange: (dia: string | null) => void; vazio?: string; rotulo: string }) {
  return (
    <Popover
      label={rotulo}
      alturaMax={420}
      largura={272}
      trigger={<span className={cn('inline-flex items-center gap-1.5 text-sm', valor ? 'text-branco-cru' : 'text-nevoa')}><CalendarDays size={14} className="text-nevoa" />{valor ? rotuloDoDia(valor) : vazio}</span>}
    >
      {(fechar) => <Calendario valor={valor} onEscolher={(dia) => { fechar(); onChange(dia); }} />}
    </Popover>
  );
}

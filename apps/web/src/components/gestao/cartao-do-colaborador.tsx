'use client';

import Link from 'next/link';
import { CalendarClock, CalendarOff, ChevronRight, CircleDot, Lock, Video } from 'lucide-react';
import { EntityAvatar } from '@/components/ui/entity-avatar';
import { formatClockTime, formatRelativeTime } from '@/lib/format';
import type { EventoDaGestao, PessoaDaGestao } from '@/hooks/use-gestao';
import { cn } from '@/lib/utils';

/**
 * Um colaborador num cartão: o que está fazendo, quanto tem, o que atrasou e a
 * agenda de hoje. O cartão aparece sempre inteiro (nada cortado) — clicar abre
 * a pessoa com tudo listado.
 */

export function tituloDoEvento(e: EventoDaGestao) {
  return e.visible ? e.title ?? 'Compromisso' : 'Ocupado';
}

export function situacao(p: PessoaDaGestao, agora = Date.now()): { texto: string; tom: 'reuniao' | 'online' | 'neutro' } {
  if (p.agenda.agora) return { texto: `Em ${p.agenda.agora.visible ? 'reunião' : 'compromisso'} até ${formatClockTime(p.agenda.agora.end_at)}`, tom: 'reuniao' };
  if (p.last_seen_at && agora - Date.parse(p.last_seen_at) < 10 * 60_000) return { texto: 'Usando o sistema agora', tom: 'online' };
  if (p.last_seen_at) return { texto: `Visto ${formatRelativeTime(p.last_seen_at).toLowerCase()}`, tom: 'neutro' };
  return { texto: 'Ainda não entrou no sistema', tom: 'neutro' };
}

function Numero({ valor, rotulo, alerta = false }: { valor: number | null; rotulo: string; alerta?: boolean }) {
  return (
    <div className="min-w-0">
      <p className={cn('font-heading text-xl font-semibold tabular-nums', alerta && (valor ?? 0) > 0 ? 'text-erro' : 'text-branco-cru')}>{valor ?? '–'}</p>
      <p className="truncate text-[11px] text-nevoa">{rotulo}</p>
    </div>
  );
}

export function CartaoDoColaborador({ p }: { p: PessoaDaGestao }) {
  const s = situacao(p);
  const t = p.tarefas;
  return (
    <Link
      href={`/gestao/${p.id}`}
      aria-label={`Abrir ${p.name}`}
      className="group flex flex-col gap-4 rounded-xl border border-grafite-elevado bg-grafite p-4 transition-colors hover:border-roxo-eletrico/50"
    >
      <div className="flex items-center gap-3">
        <EntityAvatar name={p.name} photoUrl={p.avatar_url} kind="person" size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-heading text-base font-semibold text-branco-cru">{p.name}</p>
          <p className={cn('flex items-center gap-1.5 truncate text-xs', s.tom === 'reuniao' ? 'text-roxo-eletrico' : s.tom === 'online' ? 'text-sucesso' : 'text-nevoa')}>
            {s.tom === 'reuniao' ? <Video size={12} /> : <CircleDot size={11} />} {s.texto}
          </p>
        </div>
        <ChevronRight size={16} className="shrink-0 text-nevoa transition-transform group-hover:translate-x-0.5" />
      </div>

      <div className="grid grid-cols-4 gap-2 rounded-lg bg-carbono/40 px-3 py-2.5">
        <Numero valor={t?.abertas ?? null} rotulo="abertas" />
        <Numero valor={t?.atrasadas ?? null} rotulo="atrasadas" alerta />
        <Numero valor={t?.vencem_hoje ?? null} rotulo="vencem hoje" />
        <Numero valor={t?.concluidas_7d ?? null} rotulo="entregues 7d" />
      </div>

      <div>
        <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-nevoa">Fazendo agora</p>
        {!t ? (
          <p className="text-xs text-nevoa">Tarefas do ClickUp indisponíveis agora.</p>
        ) : t.agora.length === 0 ? (
          <p className="text-xs text-nevoa">{t.abertas === 0 ? 'Nenhuma tarefa aberta.' : 'Nada em andamento nem atrasado.'}</p>
        ) : (
          <ul className="space-y-1">
            {t.agora.map((x) => (
              <li key={x.id} className="flex items-center gap-2 text-sm">
                <span className={cn('size-1.5 shrink-0 rounded-full', x.atrasada ? 'bg-erro' : 'bg-roxo-eletrico')} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-branco-cru" title={x.name}>{x.name}</span>
                <span className={cn('shrink-0 text-[11px]', x.atrasada ? 'text-erro' : 'text-nevoa')}>{x.atrasada ? 'atrasada' : x.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="mb-1.5 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-nevoa">
          <span>Agenda de hoje</span>
          {p.agenda.conectada && <span className="normal-case tracking-normal">{p.agenda.hoje} {p.agenda.hoje === 1 ? 'compromisso' : 'compromissos'}</span>}
        </p>
        {!p.agenda.conectada ? (
          <p className="flex items-center gap-1.5 text-xs text-nevoa"><CalendarOff size={12} /> Não conectou o Outlook.</p>
        ) : p.agenda.eventos.length === 0 ? (
          <p className="text-xs text-nevoa">Agenda livre hoje.</p>
        ) : (
          <ul className="space-y-1">
            {p.agenda.eventos.slice(0, 3).map((e) => (
              <li key={e.id} className="flex items-center gap-2 text-sm">
                <span className="w-11 shrink-0 font-mono text-[11px] text-nevoa">{formatClockTime(e.start_at)}</span>
                <span className={cn('min-w-0 flex-1 truncate', e.visible ? 'text-branco-cru' : 'text-nevoa')}>
                  {!e.visible && <Lock size={11} className="mr-1 inline" />}{tituloDoEvento(e)}
                </span>
              </li>
            ))}
            {p.agenda.eventos.length > 3 && <li className="text-[11px] text-nevoa">+{p.agenda.eventos.length - 3} depois</li>}
          </ul>
        )}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-grafite-elevado pt-3 text-xs text-nevoa">
        <span>{p.clientes} {p.clientes === 1 ? 'cliente' : 'clientes'}</span>
        <span>Quinzenas: {p.demandas.abertas}{p.demandas.atrasadas > 0 && <span className="text-erro"> ({p.demandas.atrasadas} atrasada{p.demandas.atrasadas > 1 ? 's' : ''})</span>}</span>
        {p.aprovacoes_pendentes > 0 && <span className="text-sinal">{p.aprovacoes_pendentes} aprovação{p.aprovacoes_pendentes > 1 ? 'ões' : ''} esperando</span>}
      </div>
      {p.ultima_atividade && (
        <p className="-mt-2 flex items-start gap-1.5 text-xs text-nevoa">
          <CalendarClock size={12} className="mt-0.5 shrink-0" />
          <span className="line-clamp-2">{p.ultima_atividade.summary ?? 'Atividade no ClickUp'} · {formatRelativeTime(p.ultima_atividade.at).toLowerCase()}</span>
        </p>
      )}
    </Link>
  );
}

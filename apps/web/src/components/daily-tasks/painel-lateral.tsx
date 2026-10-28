'use client';

import { Prazo } from '@/components/ui/prazo';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, CalendarDays, CheckCircle2, Circle, Clock, Users } from 'lucide-react';
import { useUpdateTask } from '@/hooks/use-work';
import type { WorkOverview } from '@/hooks/use-work-extra';
import { cn } from '@/lib/utils';
import { LogoDoCliente, nomeLimpo, useClientIndex } from './cliente';
import { prazoRelativo } from './ui';

export type FiltroRapido = 'hoje' | 'atrasadas' | 'bloqueadas' | 'prontas' | null;

const Cartao = ({ titulo, icone, acao, children }: { titulo: string; icone?: React.ReactNode; acao?: React.ReactNode; children: React.ReactNode }) => (
  <section className="space-y-2.5 rounded-xl border border-grafite-elevado/70 bg-grafite/60 p-3.5">
    <div className="flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-nevoa">{icone}{titulo}</h2>{acao}</div>
    {children}
  </section>
);

/** Coluna da direita: o que fazer hoje, o que merece atenção e o que vem aí. Tudo calculado no servidor, no escopo da tela. */
export function PainelLateral({ overview, aoAbrir, aoFiltrar }: { overview: WorkOverview | undefined; aoAbrir: (id: string) => void; aoFiltrar: (f: FiltroRapido) => void }) {
  const clientes = useClientIndex();
  const atualizar = useUpdateTask();
  const c = overview?.contagens;
  const hoje = new Date();
  const foco = overview?.focoDoDia ?? [];
  const feitas = foco.filter((f) => f.feita).length;
  const pct = foco.length ? Math.round((feitas / foco.length) * 100) : 0;
  const alternar = (f: WorkOverview['focoDoDia'][number]) => {
    const alvo = f.feita ? f.initialId : f.finalId;
    if (alvo) atualizar.mutate({ id: f.id, expectedVersion: f.version, statusId: alvo });
  };
  const alertas = [
    { n: c?.atrasadas ?? 0, titulo: 'tarefas atrasadas', sub: 'Precisam de atenção', f: 'atrasadas' as const, icone: AlertTriangle, cor: 'text-red-400' },
    { n: c?.bloqueadas ?? 0, titulo: 'tarefas bloqueadas', sub: 'Aguardando resolução', f: 'bloqueadas' as const, icone: Clock, cor: 'text-aviso' },
    { n: c?.prontasSemEncerrar ?? 0, titulo: 'prontas, não encerradas', sub: 'Entregues, falta encerrar', f: 'prontas' as const, icone: CheckCircle2, cor: 'text-sucesso' },
    { n: c?.concluidasComSubtarefaAberta ?? 0, titulo: 'concluídas com subtarefa aberta', sub: 'Conferir se terminou mesmo', f: null, icone: AlertTriangle, cor: 'text-aviso' },
    { n: c?.semResponsavel ?? 0, titulo: 'sem responsável', sub: 'Ninguém vai fazer ainda', f: null, icone: Users, cor: 'text-nevoa' },
    { n: c?.clientesSemAtividade ?? 0, titulo: 'clientes sem atividade', sub: 'Nada mexido há 7 dias', f: null, icone: Users, cor: 'text-nevoa' },
  ].filter((a) => a.n > 0);
  return (
    <aside aria-label="Resumo do dia" className="space-y-4">
      <Cartao titulo="Hoje" icone={<CalendarDays size={15} />}>
        <div>
          <p className="font-heading text-lg font-semibold capitalize text-branco-cru">{hoje.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          <p className="text-sm capitalize text-nevoa">{hoje.toLocaleDateString('pt-BR', { weekday: 'long' })}</p>
        </div>
        <Link href="/daily-tasks/calendario" className="flex w-fit items-center gap-2 rounded-lg border border-grafite-elevado px-3 py-1.5 text-sm text-branco-cru hover:bg-grafite-elevado">Abrir calendário <ArrowRight size={14} /></Link>
      </Cartao>

      <Cartao titulo="Foco do dia" icone={<CheckCircle2 size={15} className="text-sucesso" />} acao={<span className="text-xs text-nevoa">{feitas} de {foco.length} concluídas</span>}>
        {foco.length === 0 ? <p className="text-sm text-nevoa">Nenhuma tarefa sua vence hoje. Aproveite para adiantar o que vem aí.</p> : (
          <>
            <div className="flex items-center gap-2"><span className="h-1.5 flex-1 overflow-hidden rounded bg-grafite-elevado"><span className="block h-full bg-sucesso" style={{ width: `${pct}%` }} /></span><span className="text-xs tabular-nums text-nevoa">{pct}%</span></div>
            <ul className="space-y-1.5">
              {foco.map((f) => (
                <li key={f.id}><button type="button" onClick={() => alternar(f)} title={f.feita ? 'Reabrir' : 'Marcar como concluída'} className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-sm hover:bg-grafite-elevado/60">
                  {f.feita ? <CheckCircle2 size={16} className="shrink-0 text-sucesso" /> : <Circle size={16} className="shrink-0 text-nevoa" />}
                  <span className={cn('truncate', f.feita ? 'text-nevoa line-through' : 'text-branco-cru')}>{f.title}</span>
                </button></li>
              ))}
            </ul>
          </>
        )}
      </Cartao>

      <Cartao titulo="Alertas" icone={<AlertTriangle size={15} className="text-red-400" />} acao={alertas.length > 0 ? <span className="rounded-full bg-red-500 px-2 text-xs font-semibold text-white">{alertas.length}</span> : undefined}>
        {alertas.length === 0 ? <p className="text-sm text-nevoa">Nada pedindo atenção. 🎯</p> : (
          <ul className="space-y-1">
            {alertas.map((a) => (
              <li key={a.titulo}><button type="button" disabled={!a.f} onClick={() => a.f && aoFiltrar(a.f)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-grafite-elevado/60 disabled:cursor-default disabled:hover:bg-transparent">
                <a.icone size={18} className={a.cor} />
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-branco-cru">{a.n} {a.titulo}</span><span className="block text-xs text-nevoa">{a.sub}</span></span>
                {a.f && <ArrowRight size={14} className="text-nevoa" />}
              </button></li>
            ))}
          </ul>
        )}
      </Cartao>

      <Cartao titulo="Próximas entregas" icone={<Clock size={15} />}>
        {(overview?.proximasEntregas?.length ?? 0) === 0 ? <p className="text-sm text-nevoa">Nenhuma entrega com prazo à frente.</p> : (
          <ul className="space-y-1">
            {(overview?.proximasEntregas ?? []).map((e) => {
              const p = prazoRelativo(e.dueAt, false);
              const nome = (e.clientId && clientes.get(e.clientId)) || nomeLimpo(e.lista);
              return (
                <li key={e.id}><button type="button" onClick={() => aoAbrir(e.id)} className="flex w-full items-center gap-3 rounded-lg px-1.5 py-1.5 text-left hover:bg-grafite-elevado/60">
                  <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-grafite-elevado"><LogoDoCliente nome={nome} className="!size-7" /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-branco-cru">{e.title}</span><span className="block truncate text-xs text-nevoa">{nome}</span></span>
                  <span className="shrink-0 text-right text-xs"><span className="block text-branco-cru">{p?.data.slice(0, 5)}</span><Prazo prazo={e.dueAt} className="mt-0.5" /></span>
                </button></li>
              );
            })}
          </ul>
        )}
      </Cartao>
    </aside>
  );
}

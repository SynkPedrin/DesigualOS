'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertTriangle, ArrowLeft, CalendarOff, ExternalLink, Lock, ShieldAlert } from 'lucide-react';
import { EntityAvatar } from '@/components/ui/entity-avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { Surface } from '@/components/ui/surface';
import { useDetalheDoColaborador, type TarefaDaGestao } from '@/hooks/use-gestao';
import { useIsMaster } from '@/hooks/use-is-master';
import { formatClockTime, formatRelativeTime } from '@/lib/format';
import { tituloDoEvento } from '@/components/gestao/cartao-do-colaborador';
import { cn } from '@/lib/utils';

/**
 * UM COLABORADOR, POR INTEIRO — tudo de trabalho que está com ele: tarefas
 * agrupadas por urgência (com link para o ClickUp), agenda dos próximos 7 dias,
 * quinzenas, aprovações esperando, clientes e o que andou fazendo.
 */

const DIA = 24 * 60 * 60_000;
const data = (ms: number) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(new Date(ms));
const diaDaSemana = (iso: string) => new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(iso));
const RESPONSABILIDADE: Record<string, string> = { manager: 'Gestão', account: 'Atendimento', traffic: 'Tráfego', design: 'Design', video: 'Vídeo', social: 'Social', copy: 'Redação', sales: 'Comercial', other: 'Outro' };

function Secao({ titulo, contagem, children }: { titulo: string; contagem?: number; children: React.ReactNode }) {
  return (
    <section aria-label={titulo}>
      <h2 className="mb-2 flex items-center gap-2 font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">
        {titulo}{contagem !== undefined && <span className="rounded-full bg-grafite-elevado px-1.5 font-mono text-[10px] normal-case tracking-normal text-branco-cru">{contagem}</span>}
      </h2>
      {children}
    </section>
  );
}

function LinhaDeTarefa({ t }: { t: TarefaDaGestao }) {
  const conteudo = (
    <>
      <span className={cn('size-1.5 shrink-0 rounded-full', t.atrasada ? 'bg-erro' : t.em_andamento ? 'bg-roxo-eletrico' : 'bg-nevoa/50')} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-branco-cru">{t.name}</span>
        <span className="block truncate text-[11px] text-nevoa">{[t.client?.name, t.list_name, t.status].filter(Boolean).join(' · ')}</span>
      </span>
      <span className={cn('shrink-0 font-mono text-[11px]', t.atrasada ? 'text-erro' : 'text-nevoa')}>{t.due_date ? data(t.due_date) : 'sem prazo'}</span>
      {t.url && <ExternalLink size={13} className="shrink-0 text-nevoa" aria-hidden />}
    </>
  );
  return (
    <li>
      {t.url
        ? <a href={t.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-grafite-elevado/60" aria-label={`${t.name} no ClickUp`}>{conteudo}</a>
        : <div className="flex items-center gap-2.5 px-2 py-1.5">{conteudo}</div>}
    </li>
  );
}

export default function ColaboradorPage() {
  const { id } = useParams<{ id: string }>();
  const { isMaster, isPending: carregandoPapel } = useIsMaster();
  const detalhe = useDetalheDoColaborador(id);

  if (!carregandoPapel && !isMaster) return <EmptyState icon={ShieldAlert} title="Acesso restrito" description="A gestão da equipe é de quem administra a operação." />;
  if (detalhe.isPending) return <div className="mx-auto max-w-[1400px]"><div className="h-40 animate-pulse rounded-xl bg-grafite" /></div>;
  if (detalhe.isError || !detalhe.data) return <EmptyState icon={AlertTriangle} title="Colaborador não encontrado" description="Ele pode ter saído da equipe ou não ser desta empresa." />;

  const d = detalhe.data;
  const agora = Date.now();
  const inicioDeHoje = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) + 'T00:00:00-03:00').getTime();
  const lista = d.tarefas.disponivel ? d.tarefas.lista : [];
  const grupos: Array<[string, TarefaDaGestao[]]> = [
    ['Atrasadas', lista.filter((t) => t.atrasada)],
    ['Vencem hoje', lista.filter((t) => !t.atrasada && t.due_date !== null && t.due_date < inicioDeHoje + DIA)],
    ['Nesta semana', lista.filter((t) => !t.atrasada && t.due_date !== null && t.due_date >= inicioDeHoje + DIA && t.due_date < inicioDeHoje + 7 * DIA)],
    ['Mais adiante', lista.filter((t) => t.due_date !== null && t.due_date >= inicioDeHoje + 7 * DIA)],
    ['Sem prazo', lista.filter((t) => t.due_date === null)],
  ];
  const diasDaAgenda = new Map<string, typeof d.agenda.eventos>();
  for (const e of d.agenda.eventos) {
    const dia = diaDaSemana(e.start_at);
    diasDaAgenda.set(dia, [...(diasDaAgenda.get(dia) ?? []), e]);
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 pb-8">
      <Link href="/gestao" className="inline-flex items-center gap-1.5 text-sm text-nevoa hover:text-branco-cru"><ArrowLeft size={15} /> Gestão da equipe</Link>

      <header className="flex flex-wrap items-center gap-4">
        <EntityAvatar name={d.pessoa.name} photoUrl={d.pessoa.avatar_url} kind="person" size="xl" />
        <div className="min-w-0 flex-1">
          <h1 className="font-heading text-2xl font-semibold text-branco-cru">{d.pessoa.name}</h1>
          <p className="text-sm text-nevoa">{[d.pessoa.job_title, d.pessoa.email, d.pessoa.last_seen_at ? `visto ${formatRelativeTime(d.pessoa.last_seen_at).toLowerCase()}` : 'ainda não entrou'].filter(Boolean).join(' · ')}</p>
        </div>
        {d.tarefas.disponivel && (
          <dl className="grid grid-cols-4 gap-4 rounded-xl border border-grafite-elevado bg-grafite px-4 py-3 text-center">
            {([['abertas', d.tarefas.abertas, false], ['atrasadas', d.tarefas.atrasadas, true], ['hoje', d.tarefas.vencem_hoje, false], ['entregues 7d', d.tarefas.concluidas_7d, false]] as const).map(([rotulo, valor, alerta]) => (
              <div key={rotulo}><dt className="text-[11px] text-nevoa">{rotulo}</dt><dd className={cn('font-heading text-xl font-semibold tabular-nums', alerta && valor > 0 ? 'text-erro' : 'text-branco-cru')}>{valor}</dd></div>
            ))}
          </dl>
        )}
      </header>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Surface level="grafite" className="space-y-5 p-4">
          {!d.tarefas.disponivel ? (
            <p className="flex items-center gap-2 text-sm text-nevoa"><AlertTriangle size={15} className="text-sinal" /> {d.tarefas.erro}</p>
          ) : lista.length === 0 ? (
            <p className="text-sm text-nevoa">Nenhuma tarefa aberta no ClickUp.</p>
          ) : grupos.filter(([, ts]) => ts.length > 0).map(([titulo, ts]) => (
            <Secao key={titulo} titulo={titulo} contagem={ts.length}><ul className="-mx-2">{ts.map((t) => <LinhaDeTarefa key={t.id} t={t} />)}</ul></Secao>
          ))}
        </Surface>

        <div className="space-y-6">
          <Surface level="grafite" className="p-4">
            <Secao titulo="Agenda dos próximos 7 dias">
              {!d.agenda.conectada ? (
                <p className="flex items-center gap-2 text-sm text-nevoa"><CalendarOff size={14} /> Ainda não conectou o Outlook. A agenda aparece aqui quando conectar em Integrações.</p>
              ) : d.agenda.eventos.length === 0 ? (
                <p className="text-sm text-nevoa">Nenhum compromisso nos próximos 7 dias.</p>
              ) : (
                <div className="space-y-3">
                  {[...diasDaAgenda].map(([dia, eventos]) => (
                    <div key={dia}>
                      <p className="mb-1 text-xs font-medium capitalize text-branco-cru">{dia}</p>
                      <ul className="space-y-1">
                        {eventos.map((e) => {
                          const agoraNele = Date.parse(e.start_at) <= agora && Date.parse(e.end_at) > agora;
                          return (
                            <li key={e.id} className={cn('flex items-center gap-2 rounded-md px-2 py-1 text-sm', agoraNele && 'bg-roxo-eletrico/10')}>
                              <span className="w-24 shrink-0 font-mono text-[11px] text-nevoa">{formatClockTime(e.start_at)}–{formatClockTime(e.end_at)}</span>
                              <span className={cn('min-w-0 flex-1 truncate', e.visible ? 'text-branco-cru' : 'text-nevoa')}>{!e.visible && <Lock size={11} className="mr-1 inline" />}{tituloDoEvento(e)}</span>
                              {agoraNele && <span className="shrink-0 text-[11px] text-roxo-eletrico">agora</span>}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </Secao>
          </Surface>

          <Surface level="grafite" className="space-y-5 p-4">
            <Secao titulo="Quinzenas" contagem={d.demandas.length}>
              {d.demandas.length === 0 ? <p className="text-sm text-nevoa">Nenhuma quinzena aberta.</p> : (
                <ul className="space-y-1">{d.demandas.map((q) => (
                  <li key={q.id} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-branco-cru">{q.title}{q.client_name && <span className="text-nevoa"> · {q.client_name}</span>}</span>
                    <span className={cn('shrink-0 font-mono text-[11px]', q.atrasada ? 'text-erro' : 'text-nevoa')}>{q.due_date ? data(Date.parse(q.due_date)) : 'sem prazo'}</span>
                  </li>
                ))}</ul>
              )}
            </Secao>
            <Secao titulo="Aprovações esperando" contagem={d.aprovacoes.length}>
              {d.aprovacoes.length === 0 ? <p className="text-sm text-nevoa">Nada esperando a aprovação dele.</p> : (
                <ul className="space-y-1">{d.aprovacoes.map((a) => <li key={a.id} className="text-sm text-branco-cru">{a.resource_type}{a.client_name && <span className="text-nevoa"> · {a.client_name}</span>} <span className="text-[11px] text-nevoa">· {formatRelativeTime(a.created_at).toLowerCase()}</span></li>)}</ul>
              )}
            </Secao>
            <Secao titulo="Clientes" contagem={d.clientes.length}>
              {d.clientes.length === 0 ? <p className="text-sm text-nevoa">Nenhum cliente atribuído.</p> : (
                <ul className="flex flex-wrap gap-2">{d.clientes.map((c) => (
                  <li key={c.id}><Link href={`/clients/${c.id}`} className="inline-flex items-center gap-1.5 rounded-md border border-grafite-elevado px-2 py-1 text-xs text-branco-cru hover:border-roxo-eletrico/60">{c.name}<span className="text-nevoa">{c.responsabilidades.map((r) => RESPONSABILIDADE[r] ?? r).join(', ')}</span></Link></li>
                ))}</ul>
              )}
            </Secao>
          </Surface>

          <Surface level="grafite" className="p-4">
            <Secao titulo="O que andou fazendo">
              {d.atividade.length === 0 ? <p className="text-sm text-nevoa">Nenhuma atividade registrada nos últimos 30 dias.</p> : (
                <ol className="space-y-2">{d.atividade.map((a, i) => (
                  <li key={i} className="text-sm">
                    <p className="text-branco-cru">{a.summary ?? a.type}</p>
                    <p className="text-[11px] text-nevoa">{[a.client_name, a.source === 'clickup' ? 'ClickUp' : a.source, formatRelativeTime(a.at).toLowerCase()].filter(Boolean).join(' · ')}</p>
                  </li>
                ))}</ol>
              )}
            </Secao>
          </Surface>
        </div>
      </div>
    </div>
  );
}

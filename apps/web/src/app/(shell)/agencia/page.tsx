'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { ArrowRight, Briefcase, Calendar, CheckSquare, ClipboardList, MessageSquare, SquareKanban, TrendingUp, Users } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Surface } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { EntityAvatar } from '@/components/ui/entity-avatar';
import { ControleDaAgencia } from '@/components/control/controle-da-agencia';
import { useAgencyControlCenter } from '@/hooks/use-agency-control-center';
import { useDemands } from '@/hooks/use-demands';
import { useCollaborators } from '@/hooks/use-collaborators';
import { useCalendarEventsForMembers } from '@/hooks/use-calendar';
import { useClients } from '@/hooks/use-clients';
import { usePipelines } from '@/hooks/use-pipelines';
import { FunilDeClientes, cartoesDoDominio, estagiosDoDominio } from '@/components/control/funil-de-clientes';
import { formatarCentavos, resumoDoQuadro } from '@/lib/pipeline-resumo';
import { formatClockTime } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Os mesmos rótulos da tela de Clientes. Status que não estiver aqui aparece
 *  com o nome cru: melhor a pessoa ler "pontual" do que o número sumir. */
const ROTULO_DE_STATUS: Record<string, string> = {
  active: 'ativos', onboarding: 'em onboarding', paused: 'em pausa', inactive: 'inativos', pontual: 'pontuais',
};

const DEMAND_STATUS_LABEL: Record<string, string> = {
  new: 'Nova', briefing: 'Em briefing', in_production: 'Em produção', done: 'Concluída', cancelled: 'Cancelada',
};
const DEMAND_STATUS_CLASS: Record<string, string> = {
  new: 'bg-roxo-eletrico/15 text-roxo-eletrico', briefing: 'bg-info/15 text-info', in_production: 'bg-aviso/15 text-aviso',
  done: 'bg-sinal/15 text-sinal', cancelled: 'bg-nevoa/15 text-nevoa',
};

function inicioDoDia(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}
function fimDoDia(d: Date): Date {
  const c = new Date(d);
  c.setHours(23, 59, 59, 999);
  return c;
}

/**
 * VISÃO DA AGÊNCIA — a tela de quem gerencia a Desigual inteira, não só o
 * próprio dia (07/10/2026). Clicar em "Desigual · Agência" na sidebar cai
 * aqui, não no Control Plane (que é sobre uso de IA/infra — pergunta
 * diferente). Sem Inbox de propósito: conversa é operação de UMA pessoa por
 * vez, não faz sentido numa visão agregada da agência inteira.
 */
export default function AgenciaPage() {
  const { data: control, isPending: controlPending, isError: controlError } = useAgencyControlCenter();
  const demandas = useDemands({});
  const { data: collaboratorsData } = useCollaborators();
  const colaboradores = useMemo(
    () => (collaboratorsData?.collaborators ?? []).map((c) => ({ userId: c.userId, name: c.name, avatarUrl: c.avatarUrl })),
    [collaboratorsData],
  );
  const agora = useMemo(() => new Date(), []);
  const idsDaEquipe = useMemo(() => colaboradores.map((c) => c.userId), [colaboradores]);
  const { eventosPorMembro, isPending: calendarioPending } = useCalendarEventsForMembers(idsDaEquipe, inicioDoDia(agora), fimDoDia(agora));
  const eventosHojeDaEquipe = useMemo(() => {
    const todos = Array.from(eventosPorMembro.entries()).flatMap(([memberId, eventos]) => eventos.map((e) => ({ ...e, memberId })));
    const vistos = new Set<string>();
    return todos
      .filter((e) => (vistos.has(e.id) ? false : (vistos.add(e.id), true)))
      .sort((a, b) => a.start_at.localeCompare(b.start_at));
  }, [eventosPorMembro]);

  /**
   * A EMPRESA, não só o dia. O Pedro pediu que esta tela soubesse "de tudo da
   * agência" (10/10/2026): carteira, gente, trabalho e dinheiro. Os quatro
   * números abaixo respondem isso, e cada um sai de UMA fonte, nunca de duas
   * somadas, pra não haver dois totais do mesmo assunto que não fecham.
   *
   * A carteira sai de `useClients`, e NÃO do `clientes_ativos` do painel de
   * controle: aquele conta todo cliente não apagado da organização, sem olhar
   * `status`. Usá-lo aqui e derivar "inativos" por status produziria dois
   * números com definições diferentes, lado a lado, que não somam.
   */
  const clientes = useClients();
  const carteira = (clientes.data ?? []).filter((c) => c.natureza === 'CLIENTE');
  const foraDaCarteira = (clientes.data ?? []).length - carteira.length;

  /**
   * A QUEBRA PRECISA FECHAR. A primeira versão disto listava "ativos, em pausa
   * e inativos" e somava 29 de 49: vinte clientes em outros estados
   * (onboarding, pontual) sumiam do rodapé sem deixar rastro, e quem lesse
   * concluiria que a carteira tem 29. Agora a lista sai do dado, não de três
   * status escolhidos a dedo, e status desconhecido aparece com o nome cru em
   * vez de evaporar.
   */
  const distribuicao = (() => {
    const mapa = new Map<string, number>();
    for (const c of carteira) mapa.set(c.status, (mapa.get(c.status) ?? 0) + 1);
    return [...mapa.entries()].sort((a, b) => b[1] - a[1]);
  })();
  const resumoDaCarteira = distribuicao.map(([st, n]) => `${n} ${ROTULO_DE_STATUS[st] ?? st}`).join(' · ');

  const pipelines = usePipelines();
  const quadrosDaAgencia = (pipelines.data?.boards ?? []).filter((b) => b.escopo === 'agencia' && b.tipo === 'cliente');
  const valorNoFunil = quadrosDaAgencia.reduce((soma, q) => soma + resumoDoQuadro(estagiosDoDominio(q.stages), cartoesDoDominio(q.cards)).somaCentavos, 0);
  const cartoesSemValor = quadrosDaAgencia.reduce((n, q) => n + resumoDoQuadro(estagiosDoDominio(q.stages), cartoesDoDominio(q.cards)).semValor, 0);
  const clientesNoFunil = quadrosDaAgencia.reduce((n, q) => n + q.cards.length, 0);

  const tarefas = control?.clickup_summary ?? null;
  const comCargaHoje = (control?.operacao_por_colaborador ?? []).filter((c) => c.em_andamento > 0).length;

  const demandasAtivas = (demandas.data ?? []).filter((d) => d.status !== 'done' && d.status !== 'cancelled');
  const reunioesHoje = control?.kpis.previstas_hoje ?? 0;

  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader eyebrow="Agência" title="Bom dia, Desigual." description="Como está a operação da agência inteira, agora." />
        <p className="pb-2 text-right text-sm text-nevoa">
          {new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(agora).replace(/^\w/, (c) => c.toUpperCase())}
        </p>
      </div>

      {/* A EMPRESA. A faixa abaixo responde "o que a Desigual é": carteira,
          gente, trabalho e dinheiro. A faixa seguinte responde "como ela está
          hoje". Eram só a segunda, e por isso a tela sabia do dia e não sabia
          da agência. */}
      <div className="grid max-w-[1400px] gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Briefcase}
          iconClassName="bg-sinal/15 text-sinal"
          label="Clientes na carteira"
          value={carteira.length}
          isLoading={clientes.isPending}
          isError={clientes.isError}
          href="/clients"
          footer={carteira.length === 0 ? 'Nenhum cliente cadastrado' : resumoDaCarteira}
        />
        <StatCard
          icon={Users}
          iconClassName="bg-info/15 text-info"
          label="Colaboradores"
          value={colaboradores.length}
          isLoading={controlPending}
          isError={controlError}
          href="/people"
          footer={comCargaHoje > 0 ? `${comCargaHoje} com trabalho em andamento` : 'Ninguém com carga agora'}
        />
        <StatCard
          icon={CheckSquare}
          iconClassName="bg-roxo-eletrico/15 text-roxo-eletrico"
          label="Tarefas na agência"
          value={tarefas?.total_tarefas ?? 0}
          isLoading={controlPending}
          isError={controlError}
          href="/tasks"
          {...(tarefas && tarefas.atrasadas > 0 ? { sublabel: { text: `${tarefas.atrasadas} atrasadas`, tone: 'warning' as const } } : {})}
          footer={
            /* Sem `clickup_summary` a API é antiga ou não tem ClickUp ligado.
               Dizer isso é melhor que estampar 0, que leria como "nenhuma
               tarefa na agência". */
            tarefas ? `${tarefas.abertas} abertas de ${tarefas.total_tarefas}` : 'Sem leitura do ClickUp agora'
          }
        />
        <StatCard
          icon={TrendingUp}
          iconClassName="bg-ametista/15 text-ametista"
          label="Valor no funil"
          value={valorNoFunil}
          isLoading={pipelines.isPending}
          isError={pipelines.isError}
          href="/pipeline"
          formatValue={(v) => formatarCentavos(Math.round(v))}
          footer={
            clientesNoFunil === 0
              ? 'Nenhum cliente em negociação'
              : `${clientesNoFunil} em negociação${cartoesSemValor > 0 ? ` · ${cartoesSemValor} sem valor legível` : ''}`
          }
        />
      </div>

      <div className="grid max-w-[1400px] gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={MessageSquare}
          iconClassName="bg-roxo-eletrico/15 text-roxo-eletrico"
          label="Conversas aguardando"
          value={control?.kpis.conversas_aguardando ?? 0}
          isLoading={controlPending}
          isError={controlError}
          href="/inbox"
        />
        <StatCard
          icon={ClipboardList}
          iconClassName="bg-sucesso/15 text-sucesso"
          label="Demandas abertas"
          value={control?.kpis.demandas_abertas ?? 0}
          isLoading={controlPending}
          isError={controlError}
          href="/demands"
          {...(control && control.kpis.atrasados > 0 ? { sublabel: { text: `${control.kpis.atrasados} atrasadas`, tone: 'warning' as const } } : {})}
        />
        <StatCard
          icon={Calendar}
          iconClassName="bg-magenta-spark/15 text-magenta-spark"
          label="Reuniões hoje"
          value={reunioesHoje}
          isLoading={controlPending}
          isError={controlError}
          href="/calendar"
        />
        <StatCard
          icon={SquareKanban}
          iconClassName="bg-ametista/15 text-ametista"
          label="Aguardando aprovação"
          value={control?.kpis.aguardando_aprovacao ?? 0}
          isLoading={controlPending}
          isError={controlError}
          href="/approvals"
        />
      </div>

      <Surface className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-base font-semibold text-branco-cru">Calendário da Desigual, hoje</h2>
          <Link href="/calendar" className="flex items-center gap-1 font-mono text-[11px] text-nevoa hover:text-branco-cru">
            Ver agenda da agência <ArrowRight size={11} />
          </Link>
        </div>
        {calendarioPending ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : eventosHojeDaEquipe.length === 0 ? (
          <p className="py-6 text-center text-sm text-nevoa">Nenhum compromisso da equipe registrado pra hoje.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {eventosHojeDaEquipe.map((e) => {
              const colaborador = colaboradores.find((c) => c.userId === e.memberId);
              return (
                <li key={`${e.id}-${e.memberId}`} className="flex items-center gap-3 rounded-md border border-grafite-elevado bg-carbono px-3 py-2.5">
                  <EntityAvatar name={colaborador?.name ?? '?'} photoUrl={colaborador?.avatarUrl ?? null} kind="person" size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-branco-cru">{e.visible ? e.title : 'Ocupado'}</p>
                    <p className="truncate text-xs text-nevoa">{colaborador?.name ?? 'Equipe'} · {formatClockTime(e.start_at)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Surface>

      <Surface className="flex flex-col gap-4 p-5">
        <h2 className="font-heading text-base font-semibold text-branco-cru">Visão geral da Desigual</h2>
        <ControleDaAgencia />
      </Surface>

      <div className="grid gap-6 lg:grid-cols-2">
        <Surface className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-base font-semibold text-branco-cru">Demandas da Desigual</h2>
            <Link href="/demands" className="flex items-center gap-1 font-mono text-[11px] text-nevoa hover:text-branco-cru">
              Ver todas <ArrowRight size={11} />
            </Link>
          </div>
          {demandas.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : demandasAtivas.length === 0 ? (
            <p className="py-6 text-center text-sm text-nevoa">Nenhuma demanda ativa agora.</p>
          ) : (
            <ul className="divide-y divide-grafite-elevado">
              {demandasAtivas.slice(0, 6).map((d) => (
                <li key={d.id}>
                  <Link href={`/demands/${d.id}`} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <EntityAvatar name={d.clientName ?? 'Cliente'} kind="client" size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-branco-cru">{d.title}</p>
                      <p className="truncate text-xs text-nevoa">{d.clientName}</p>
                    </div>
                    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', DEMAND_STATUS_CLASS[d.status])}>
                      {DEMAND_STATUS_LABEL[d.status] ?? d.status}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Surface>

        <FunilDeClientes />
      </div>
    </div>
  );
}

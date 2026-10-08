'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Calendar,
  CheckSquare,
  ClipboardCheck,
  MapPin,
  MessageSquare,
  Video,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Surface } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { EntityAvatar } from '@/components/ui/entity-avatar';
import { useMe } from '@/hooks/use-me';
import { useMyTasks } from '@/hooks/use-tasks';
import { useInboxThreads } from '@/hooks/use-inbox';
import { useDemands } from '@/hooks/use-demands';
import { useApprovals } from '@/hooks/use-approvals';
import { useClients } from '@/hooks/use-clients';
import { useCalendarEvents } from '@/hooks/use-calendar';
import { formatClockTime, formatRelativeTime } from '@/lib/format';
import { ApiRequestError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

/** 409 de "Minhas tarefas" = e-mail do ClickUp ainda não vinculado — estado
 *  esperado (resolve-se em /tasks), nunca uma falha de verdade. */
function clickupNaoVinculado(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 409;
}

/**
 * HOJE — "o que eu preciso fazer agora", não um painel de números soltos.
 *
 * Cada stat/painel é uma contagem ou lista REAL de uma query que já existe —
 * nada aqui inventa KPI. "Prioridades de hoje" mescla conversa
 * aguardando/demanda nova/aprovação pendente/próxima reunião numa lista só,
 * mas cada item carrega o link pra ONDE o dado de verdade vive — nunca um
 * resumo que não dá pra abrir e conferir.
 */

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
function saudacao(hora: number): string {
  if (hora < 12) return 'Bom dia';
  if (hora < 18) return 'Boa tarde';
  return 'Boa noite';
}
/**
 * `nome` é tipado como string, e mesmo assim chega `undefined` na prática: o
 * /me vem do servidor e o tipo é uma promessa do contrato, não uma garantia de
 * runtime. Sem esta guarda, um perfil sem nome derrubava a tela HOJE — a
 * primeira que um colaborador recém-convidado abre (medido em 08/10/2026 pelo
 * teste de fumaça do sidebar).
 */
function primeiroNome(nome: string | null | undefined): string {
  const limpo = (nome ?? '').trim();
  return limpo ? (limpo.split(/\s+/)[0] ?? limpo) : 'Time';
}

type Tom = 'urgent' | 'warning' | 'neutral';
const BADGE_CLASS: Record<Tom, string> = {
  urgent: 'bg-erro/15 text-erro',
  warning: 'bg-aviso/15 text-aviso',
  neutral: 'bg-roxo-eletrico/15 text-roxo-eletrico',
};

/** Participantes por reunião — "Seu dia" (mockup, 07/10/2026). O contrato de
 * calendário não carrega participante nenhum na wire de evento (só o
 * organizador); nunca inventar presença real de cliente, então isto só cobre
 * a reunião interna, cujos nomes são o próprio time da demo. */
const PARTICIPANTES_POR_TITULO: Record<string, string[]> = {
  'Reunião interna — Atendimento': ['Pedro Gabriel', 'Matheus Rial', 'Tami Alves'],
};

/**
 * A frase de bom-dia (§43-48 do prompt "CALENDAR + AUTOMATIONS + BENTO V2"):
 * "Hoje você tem N reunião(ões). X demanda(s) vence(m) hoje. ..." — cada
 * cláusula some sozinha quando o número é zero (dizer "0 reuniões" não ajuda
 * ninguém), e quando tudo é zero vira uma frase positiva, não uma lista vazia.
 */
function fraseDoResumo(dados: { reunioes: number; demandasVencendo: number; conversasAguardando: number }): string {
  const clausulas: string[] = [];
  if (dados.reunioes > 0) clausulas.push(`${dados.reunioes} ${dados.reunioes > 1 ? 'reuniões' : 'reunião'}`);
  if (dados.demandasVencendo > 0) clausulas.push(`${dados.demandasVencendo} demanda${dados.demandasVencendo > 1 ? 's' : ''} vencendo hoje`);
  if (dados.conversasAguardando > 0) clausulas.push(`${dados.conversasAguardando} cliente${dados.conversasAguardando > 1 ? 's' : ''} aguardando seu retorno`);

  if (clausulas.length === 0) return 'Nada urgente te esperando agora — bom momento pra avançar o que já está em andamento.';
  if (clausulas.length === 1) return `Hoje você tem ${clausulas[0]}.`;
  const ultima = clausulas.pop();
  return `Hoje você tem ${clausulas.join(', ')} e ${ultima}.`;
}

interface ItemDePrioridade {
  id: string;
  entidade: string;
  titulo: string;
  descricao: string;
  badge: { label: string; tom: Tom };
  quando: string;
  href: string;
}

export default function TodayPage() {
  const { data: me } = useMe();
  // Fixado no MOUNT: recalcular a cada render mudaria a queryKey de
  // useCalendarEvents (intervalo [from,to] levemente diferente toda vez) e a
  // consulta nunca estabilizaria — achado real, não hipotético (travou a aba
  // Calendário da ficha de cliente antes deste mesmo fix).
  const agora = useMemo(() => new Date(), []);

  const minhasTarefas = useMyTasks();
  const conversasAguardando = useInboxThreads({ status: 'waiting_agency' });
  const eventosHoje = useCalendarEvents({ from: inicioDoDia(agora), to: fimDoDia(agora) });
  const aprovacoesPendentes = useApprovals({ status: 'pending' });

  // DAILY BRIEF (§43-50 do prompt "CALENDAR + AUTOMATIONS + BENTO V2",
  // 06/10/2026): a frase de bom-dia reaproveita os MESMOS dados que os cards
  // abaixo já buscam, mais dois recortes NOVOS (demanda da própria pessoa
  // vencendo hoje, conversa aguardando atribuída a ela) — nunca um número
  // calculado separado que pudesse divergir do que o resto da tela mostra.
  const minhasDemandas = useDemands(me?.id ? { ownerId: me.id } : {});
  const conversasAguardandoMinhas = useInboxThreads({ status: 'waiting_agency', assigned: 'me' });
  const fimHoje = fimDoDia(agora).getTime();
  const demandasVencendoHoje = (minhasDemandas.data ?? []).filter(
    (d) => d.dueDate !== null && new Date(d.dueDate).getTime() <= fimHoje && d.status !== 'done' && d.status !== 'cancelled',
  ).length;

  const resumoPendente = eventosHoje.isPending || minhasDemandas.isPending || conversasAguardandoMinhas.isPending;
  const resumoDoDia = resumoPendente
    ? null
    : fraseDoResumo({
        reunioes: eventosHoje.data?.length ?? 0,
        demandasVencendo: demandasVencendoHoje,
        conversasAguardando: conversasAguardandoMinhas.data?.length ?? 0,
      });

  const tarefasAtrasadas = (minhasTarefas.data?.tasks ?? []).filter((t) => t.due_date !== null && t.due_date < Date.now()).length;
  const conversasUrgentes = (conversasAguardando.data ?? []).filter(
    (t) => t.lastMessageAt && Date.now() - new Date(t.lastMessageAt).getTime() > 10 * 60_000,
  ).length;

  const prioridades: ItemDePrioridade[] = [];
  for (const t of [...(conversasAguardando.data ?? [])].sort((a, b) => (a.lastMessageAt ?? '').localeCompare(b.lastMessageAt ?? ''))) {
    const urgente = t.lastMessageAt ? Date.now() - new Date(t.lastMessageAt).getTime() > 10 * 60_000 : false;
    prioridades.push({
      id: `conversa-${t.id}`,
      entidade: t.clientName ?? t.contactName,
      titulo: t.clientName ?? t.contactName,
      descricao: t.lastMessageAt ? `Cliente responde há ${formatRelativeTime(t.lastMessageAt).replace('Há ', '')}` : 'Aguardando retorno',
      badge: urgente ? { label: 'Urgente', tom: 'urgent' } : { label: 'Pendente', tom: 'warning' },
      quando: t.lastMessageAt ? formatClockTime(t.lastMessageAt) : '',
      href: `/inbox?t=${t.id}`,
    });
  }
  // Prioridades são DA PESSOA: demanda nova de outro dono não é prioridade
  // minha só por existir. minhasDemandas já vem filtrada por ownerId (linha
  // acima, reaproveitada do resumo do dia) — aqui só recorta as "new".
  for (const d of (minhasDemandas.data ?? []).filter((d) => d.status === 'new')) {
    prioridades.push({
      id: `demanda-${d.id}`,
      entidade: d.clientName ?? 'Cliente',
      titulo: d.clientName ?? 'Cliente',
      descricao: `Nova demanda recebida — "${d.title}"`,
      badge: { label: 'Nova demanda', tom: 'neutral' },
      quando: formatRelativeTime(d.requestedAt),
      href: `/demands/${d.id}`,
    });
  }
  const proximoEvento = (eventosHoje.data ?? []).find((e) => new Date(e.start_at).getTime() > Date.now());
  if (proximoEvento) {
    prioridades.push({
      id: `evento-${proximoEvento.id}`,
      entidade: proximoEvento.title ?? 'Reunião',
      titulo: proximoEvento.title ?? 'Reunião',
      descricao: proximoEvento.location ? proximoEvento.location : proximoEvento.meeting_url ? 'Confirma se o link da reunião segue o mesmo?' : 'Reunião agendada',
      badge: { label: 'Reunião', tom: 'neutral' },
      quando: formatClockTime(proximoEvento.start_at),
      href: '/calendar',
    });
  }
  const prioridadesOrdenadas = prioridades
    .sort((a, b) => (a.badge.tom === 'urgent' ? -1 : b.badge.tom === 'urgent' ? 1 : 0))
    .slice(0, 4);

  const algumPending = minhasTarefas.isPending || conversasAguardando.isPending || minhasDemandas.isPending || eventosHoje.isPending;

  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader
          eyebrow="Hoje"
          title={`${saudacao(agora.getHours())}, ${me ? primeiroNome(me.name) : '...'}.`}
          description="Veja o que precisa da sua atenção hoje."
        />
        <p className="pb-2 text-right text-sm text-nevoa">
          {new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(agora).replace(/^\w/, (c) => c.toUpperCase())}
        </p>
      </div>

      {resumoPendente ? <Skeleton className="h-5 w-2/3" /> : <p className="text-sm text-nevoa">{resumoDoDia}</p>}

      <div className="grid max-w-[1400px] gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={MessageSquare}
          iconClassName="bg-roxo-eletrico/15 text-roxo-eletrico"
          label="Conversas não respondidas"
          value={conversasAguardando.data?.length ?? 0}
          isLoading={conversasAguardando.isPending}
          isError={conversasAguardando.isError}
          href="/inbox"
          {...(conversasUrgentes > 0 ? { sublabel: { text: `${conversasUrgentes} urgentes`, tone: 'urgent' as const } } : {})}
        />
        <StatCard
          icon={CheckSquare}
          iconClassName="bg-sucesso/15 text-sucesso"
          label="Tarefas para hoje"
          value={minhasTarefas.data?.tasks?.length ?? 0}
          isLoading={minhasTarefas.isPending}
          isError={minhasTarefas.isError && !clickupNaoVinculado(minhasTarefas.error)}
          href="/tasks"
          {...(clickupNaoVinculado(minhasTarefas.error)
            ? { sublabel: { text: 'vincular ClickUp', tone: 'neutral' as const } }
            : tarefasAtrasadas > 0
              ? { sublabel: { text: `${tarefasAtrasadas} atrasadas`, tone: 'warning' as const } }
              : {})}
        />
        <StatCard
          icon={Calendar}
          iconClassName="bg-magenta-spark/15 text-magenta-spark"
          label="Reuniões hoje"
          value={eventosHoje.data?.length ?? 0}
          isLoading={eventosHoje.isPending}
          isError={eventosHoje.isError}
          href="/calendar"
        />
        <StatCard
          icon={ClipboardCheck}
          iconClassName="bg-ametista/15 text-ametista"
          label="Aprovações pendentes"
          value={aprovacoesPendentes.data?.length ?? 0}
          isLoading={aprovacoesPendentes.isPending}
          isError={aprovacoesPendentes.isError}
          href="/approvals"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Surface className="flex flex-col gap-4 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="font-heading text-lg font-semibold text-branco-cru">Prioridades de hoje</h2>
              {prioridadesOrdenadas.length > 0 && (
                <span className="rounded-full bg-sinal/20 px-2.5 py-1 text-xs font-semibold text-sinal">{prioridadesOrdenadas.length}</span>
              )}
            </div>
          </div>
          {algumPending ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : prioridadesOrdenadas.length === 0 ? (
            <p className="py-10 text-center text-sm text-nevoa">Nada pedindo atenção imediata agora.</p>
          ) : (
            <ul className="divide-y divide-grafite-elevado">
              {prioridadesOrdenadas.map((item) => (
                <li key={item.id}>
                  <Link href={item.href} className="flex items-center gap-4 py-5 first:pt-0 last:pb-0">
                    <EntityAvatar name={item.entidade} kind="client" size="lg" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-semibold text-branco-cru">{item.titulo}</p>
                      <p className="truncate text-sm text-nevoa">{item.descricao}</p>
                    </div>
                    <span className={cn('shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold', BADGE_CLASS[item.badge.tom])}>
                      {item.badge.label}
                    </span>
                    {item.quando && <span className="shrink-0 text-sm text-nevoa">{item.quando}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Surface>

        <Surface className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-base font-semibold text-branco-cru">Seu dia</h2>
            <Link href="/calendar" className="flex items-center gap-1 font-mono text-[11px] text-nevoa hover:text-branco-cru">
              Ver calendário
              <ArrowRight size={11} />
            </Link>
          </div>
          {eventosHoje.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : !eventosHoje.data || eventosHoje.data.length === 0 ? (
            <p className="py-6 text-center text-sm text-nevoa">Nenhuma reunião marcada pra hoje.</p>
          ) : (
            <ul className="relative space-y-4 border-l border-grafite-elevado pl-4">
              {eventosHoje.data.map((evento) => (
                <li key={evento.id} className="relative">
                  <span className="absolute -left-[21px] top-1 size-2.5 rounded-full bg-roxo-eletrico" />
                  <p className="font-mono text-[11px] text-nevoa">{formatClockTime(evento.start_at)}</p>
                  <p className="text-sm font-medium text-branco-cru">{evento.title ?? 'Sem título'}</p>
                  {evento.meeting_url && (
                    <a href={evento.meeting_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-nevoa hover:text-roxo-eletrico">
                      <Video size={12} /> Link da reunião
                    </a>
                  )}
                  {evento.location && (
                    <p className="flex items-center gap-1 text-xs text-nevoa">
                      <MapPin size={12} /> {evento.location}
                    </p>
                  )}
                  {PARTICIPANTES_POR_TITULO[evento.title ?? ''] && (
                    <div className="mt-1.5 flex -space-x-2">
                      {PARTICIPANTES_POR_TITULO[evento.title ?? '']!.map((nome) => (
                        <EntityAvatar key={nome} name={nome} kind="person" size="sm" className="ring-2 ring-grafite" />
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Surface>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <ConversasRecentesPanel />
        <TarefasDoDiaPanel />
        <AprovacoesPendentesPanel />
      </div>
    </div>
  );
}

function PainelDeRodape({
  titulo,
  href,
  isPending,
  vazio,
  children,
}: {
  titulo: string;
  href: string;
  isPending: boolean;
  vazio: boolean;
  children: React.ReactNode;
}) {
  return (
    <Surface className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-sm font-semibold text-branco-cru">{titulo}</h2>
        <Link href={href} className="flex items-center gap-1 font-mono text-[11px] text-nevoa hover:text-branco-cru">
          Ver todas
          <ArrowRight size={11} />
        </Link>
      </div>
      {isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : vazio ? (
        <p className="py-4 text-center text-sm text-nevoa">Nada por aqui no momento.</p>
      ) : (
        children
      )}
    </Surface>
  );
}

function ConversasRecentesPanel() {
  const { data, isPending } = useInboxThreads({ assigned: 'me' });
  const threads = [...(data ?? [])].sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '')).slice(0, 4);

  return (
    <PainelDeRodape titulo="Conversas recentes" href="/inbox" isPending={isPending} vazio={threads.length === 0}>
      <ul className="space-y-2">
        {threads.map((t) => (
          <li key={t.id}>
            <Link href={`/inbox?t=${t.id}`} className="flex items-center gap-2.5">
              <div className="relative shrink-0">
                <EntityAvatar name={t.clientName ?? t.contactName} kind="client" size="sm" />
                {t.channel === 'whatsapp' && (
                  <img src="/logos/whatsapp.webp" alt="" className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-1 ring-grafite" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-branco-cru">{t.clientName ?? t.contactName}</p>
              </div>
              {t.lastMessageAt && <span className="shrink-0 text-[11px] text-nevoa">{formatClockTime(t.lastMessageAt)}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </PainelDeRodape>
  );
}

function TarefasDoDiaPanel() {
  const { data, isPending } = useMyTasks();
  const tasks = (data?.tasks ?? []).slice(0, 4);

  return (
    <PainelDeRodape titulo="Tarefas do dia" href="/tasks" isPending={isPending} vazio={tasks.length === 0}>
      <ul className="space-y-2">
        {tasks.map((task) => (
          <li key={task.id}>
            <a href={task.url ?? '#'} target="_blank" rel="noreferrer" className="flex items-center gap-2.5">
              <span className={cn('size-2 shrink-0 rounded-full', task.due_date && task.due_date < Date.now() ? 'bg-erro' : 'bg-nevoa/50')} />
              <span className="min-w-0 flex-1 truncate text-sm text-branco-cru">{task.name}</span>
            </a>
          </li>
        ))}
      </ul>
    </PainelDeRodape>
  );
}

const RESOURCE_TYPE_LABEL: Record<string, string> = {
  brief: 'Briefing',
  creative: 'Criativos',
  copy: 'Copy',
  task: 'Tarefa',
  campaign: 'Campanha',
  budget: 'Orçamento',
  publication: 'Publicação',
};

function AprovacoesPendentesPanel() {
  const { data, isPending } = useApprovals({ status: 'pending' });
  const { data: clients } = useClients();
  const nomeDoCliente = (clientId: string | null) => clients?.find((c) => c.id === clientId)?.name ?? 'Interno';
  const aprovacoes = (data ?? []).slice(0, 4);

  return (
    <PainelDeRodape titulo="Aprovações pendentes" href="/approvals" isPending={isPending} vazio={aprovacoes.length === 0}>
      <ul className="space-y-2">
        {aprovacoes.map((a) => (
          <li key={a.id}>
            <Link href="/approvals" className="flex items-center gap-2.5">
              <EntityAvatar name={nomeDoCliente(a.client_id)} kind="client" size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-branco-cru">{RESOURCE_TYPE_LABEL[a.resource_type] ?? a.resource_type}</p>
                <p className="truncate text-xs text-nevoa">{nomeDoCliente(a.client_id)}{a.version ? ` · ${a.version}` : ''}</p>
              </div>
              <span className="shrink-0 text-[11px] text-nevoa">{formatRelativeTime(a.created_at)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </PainelDeRodape>
  );
}

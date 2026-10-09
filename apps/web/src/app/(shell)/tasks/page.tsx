'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CircleDot, ClipboardList, Clock, Columns3, Link2, List, ListChecks, Search, User } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Surface } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import { BentoBriefing, type InsightDoBento } from '@/components/bento/painel-de-insights';
import { AgencyTaskRow } from '@/components/tasks/agency-task-row';
import { TaskKanbanBoard } from '@/components/tasks/task-kanban-board';
import { useAgencyTasks, useMyTasks } from '@/hooks/use-tasks';
import { useMe } from '@/hooks/use-me';
import { useUpdateMe } from '@/hooks/use-update-me';
import { ApiRequestError } from '@/lib/api/client';
import { classificarPrioridade } from '@/lib/prioridade-de-tarefa';
import { cn } from '@/lib/utils';

type Scope = 'agency' | 'mine';

function inicioDoDia(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

/** Formulário inline pra vincular o e-mail do ClickUp (pedido explícito: "ela
 * só coloca o email de acesso e vincula") - reusa a mesma mutação de perfil já
 * usada em Configurações, sem obrigar a sair da Central de Tasks pra linkar. */
function LinkClickUpEmailPrompt() {
  const { data: me } = useMe();
  const updateMe = useUpdateMe();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState(me?.clickupEmail ?? '');

  // O /me pode resolver DEPOIS do mount: sem isso o campo ficava vazio mesmo
  // com e-mail já vinculado. Só preenche se a pessoa ainda não digitou nada.
  useEffect(() => {
    const clickupEmail = me?.clickupEmail;
    if (clickupEmail) setEmail((current) => current || clickupEmail);
  }, [me?.clickupEmail]);

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-3 rounded-lg border border-dashed border-grafite-elevado px-8 py-16 text-center">
      <Link2 size={28} className="text-nevoa" />
      <p className="font-heading text-lg font-semibold text-branco-cru">Vincule seu e-mail do ClickUp</p>
      <p className="text-sm text-nevoa">
        Pra ver suas tarefas atribuídas, informe o e-mail da sua conta no ClickUp (pode ser diferente do seu login aqui).
      </p>
      <div className="flex w-full gap-2">
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="seu-email@clickup"
          className="w-full min-w-0 rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
        />
        <button
          type="button"
          disabled={!email || updateMe.isPending}
          onClick={() =>
            updateMe.mutate(
              { clickupEmail: email },
              {
                // Sem invalidar, a lista "Minhas tarefas" só aparecia após reload.
                onSuccess: () => queryClient.invalidateQueries({ queryKey: ['clickup', 'tasks', 'me'] }),
              },
            )
          }
          className="shrink-0 rounded-md bg-roxo-eletrico px-4 py-2 text-sm font-semibold text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:opacity-50 disabled:hover:shadow-none"
        >
          {updateMe.isPending ? 'Vinculando…' : 'Vincular'}
        </button>
      </div>
      {updateMe.isError && <p className="text-[11px] text-erro">Não foi possível vincular. Tente de novo.</p>}
      {updateMe.isSuccess && <p className="text-[11px] text-sinal">Vinculado! Buscando suas tarefas…</p>}
    </div>
  );
}

/**
 * Quantas tarefas cada recorte tem, no próprio botão. Sem isto, descobrir que
 * "Minhas tarefas" tem 26 e não 0 exige clicar — e os dois recortes existem
 * justamente para serem comparados de relance.
 */
function Contador({ n, ativo }: { n: number; ativo: boolean }) {
  return (
    <span
      className={cn(
        'ml-0.5 rounded-full px-1.5 py-0.5 font-mono text-[10px] leading-none',
        ativo ? 'bg-branco-cru/20 text-branco-cru' : 'bg-grafite-elevado text-nevoa',
      )}
    >
      {n}
    </span>
  );
}

type ViewMode = 'list' | 'kanban';

export default function TasksPage() {
  const [scope, setScope] = useState<Scope>('agency');
  const [view, setView] = useState<ViewMode>('list');
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [ownerFilter, setOwnerFilter] = useState<string>('all');

  const agency = useAgencyTasks();
  /**
   * As DUAS consultas saem juntas. A versão anterior só buscava "minhas" ao
   * clicar na aba, para poupar um 409 de quem não vinculou e-mail — mas isso
   * também significava que o contador da aba só existia depois do clique, e a
   * pergunta "tenho algo meu?" exigia navegar para ser respondida. O 409
   * continua sendo estado esperado (vira o convite de vincular), e `retry`
   * já o trata sem insistir.
   */
  const mine = useMyTasks();
  const active = scope === 'agency' ? agency : mine;

  const notLinkedYet = scope === 'mine' && mine.isError && mine.error instanceof ApiRequestError && mine.error.status === 409;

  const clientOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const task of agency.data?.tasks ?? []) {
      if (task.client) names.set(task.client.id, task.client.name);
    }
    return [...names.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [agency.data]);

  const statusOptions = useMemo(() => {
    const statuses = new Set<string>();
    for (const task of active.data?.tasks ?? []) {
      if (task.status) statuses.add(task.status);
    }
    return [...statuses].sort();
  }, [active.data]);

  /** Responsáveis que de fato aparecem nas tarefas carregadas. A opção "sem
   *  responsável" é um valor de verdade nesta tela, não ausência de filtro:
   *  tarefa órfã é o estado que a supervisão mais precisa achar. */
  const ownerOptions = useMemo(() => {
    const nomes = new Set<string>();
    let temOrfa = false;
    for (const task of active.data?.tasks ?? []) {
      const donos = task.assignees.filter((a) => a.trim().length > 0);
      if (donos.length === 0) temOrfa = true;
      for (const d of donos) nomes.add(d);
    }
    return { nomes: [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR')), temOrfa };
  }, [active.data]);

  const filteredTasks = useMemo(() => {
    const tasks = active.data?.tasks ?? [];
    const query = search.trim().toLowerCase();
    return tasks.filter((task) => {
      if (query && !task.name.toLowerCase().includes(query)) return false;
      if (clientFilter !== 'all' && task.client?.id !== clientFilter) return false;
      if (statusFilter !== 'all' && task.status !== statusFilter) return false;
      if (ownerFilter !== 'all') {
        const donos = task.assignees.filter((a) => a.trim().length > 0);
        if (ownerFilter === '__sem__' ? donos.length > 0 : !donos.includes(ownerFilter)) return false;
      }
      return true;
    });
  }, [active.data, search, clientFilter, statusFilter, ownerFilter]);

  /**
   * OS QUATRO NÚMEROS DO MOCKUP. Todos saem do MESMO conjunto que a lista
   * abaixo mostra, então nunca divergem dela: trocar de recorte troca os
   * quatro junto. O mockup traz ainda um delta ("12% vs mês anterior") que
   * NÃO entrou: não existe série histórica de tarefa em lugar nenhum do
   * contrato, e um delta inventado é pior que um cartão sem delta.
   */
  const todas = active.data?.tasks ?? [];
  const abertas = todas.filter((t) => t.status_type !== 'closed');
  const agora = Date.now();
  const fimDeHoje = inicioDoDia(new Date()).getTime() + 24 * 60 * 60_000 - 1;
  const vencemHoje = abertas.filter((t) => t.due_date !== null && t.due_date >= agora && t.due_date <= fimDeHoje).length;
  const atrasadas = abertas.filter((t) => t.due_date !== null && t.due_date < agora).length;

  /** "Bento sugere" do mockup, derivado das mesmas tarefas que estão na tela. */
  const emSeteDias = abertas.filter(
    (t) => t.due_date !== null && t.due_date >= agora && t.due_date <= agora + 7 * 24 * 60 * 60_000,
  );
  const altaPrioridade = emSeteDias.filter((t) => classificarPrioridade(t.priority) === 'alta').length;
  const semResponsavel = abertas.filter((t) => t.assignees.filter((a) => a.trim().length > 0).length === 0).length;

  const sugestoes: InsightDoBento[] = [];
  if (atrasadas > 0) {
    sugestoes.push({
      id: 'atrasadas',
      tom: 'urgente',
      texto: (
        <>
          <strong className="font-semibold text-branco-cru">{atrasadas} tarefa{atrasadas > 1 ? 's' : ''}</strong> já passou do prazo
          {atrasadas > 1 ? '. Elas precisam' : '. Ela precisa'} de ação antes do resto.
        </>
      ),
    });
  }
  if (emSeteDias.length > 0) {
    sugestoes.push({
      id: 'semana',
      tom: 'atencao',
      texto: (
        <>
          <strong className="font-semibold text-branco-cru">{emSeteDias.length} tarefa{emSeteDias.length > 1 ? 's' : ''}</strong> vence
          {emSeteDias.length > 1 ? 'm' : ''} nos próximos 7 dias
          {altaPrioridade > 0 ? (
            <>
              , {altaPrioridade} {altaPrioridade > 1 ? 'delas marcadas' : 'dela marcada'} como alta prioridade.
            </>
          ) : (
            '.'
          )}
        </>
      ),
    });
  }
  if (semResponsavel > 0) {
    sugestoes.push({
      id: 'sem-responsavel',
      tom: 'atencao',
      texto: (
        <>
          <strong className="font-semibold text-branco-cru">{semResponsavel} tarefa{semResponsavel > 1 ? 's' : ''} aberta{semResponsavel > 1 ? 's' : ''}</strong> sem
          responsável. Sem dono, ninguém é cobrado por {semResponsavel > 1 ? 'elas' : 'ela'}.
        </>
      ),
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="ClickUp"
        title="Tarefas"
        description="Tudo que está no ClickUp da agência, ou só o que está atribuído a você."
      />

      {!notLinkedYet && (
        <>
          <BentoBriefing
            subtitulo="Sobre as tarefas desta tela"
            itens={sugestoes}
            carregando={active.isPending}
            vazio="Nenhuma tarefa atrasada nem vencendo na semana. Nada a priorizar com urgência."
            {...(active.isError ? { erro: 'Não consegui ler as tarefas, então não dá pra dizer o que priorizar.' } : {})}
          />

          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon={ClipboardList}
              iconClassName="bg-roxo-eletrico/15 text-roxo-eletrico"
              label="Total de tarefas"
              value={todas.length}
              isLoading={active.isPending}
              isError={active.isError}
              footer={scope === 'agency' ? 'Em todos os clientes com ClickUp' : 'Atribuídas a você'}
            />
            <StatCard
              icon={CircleDot}
              iconClassName="bg-sucesso/15 text-sucesso"
              label="Tarefas abertas"
              value={abertas.length}
              isLoading={active.isPending}
              isError={active.isError}
              footer={`${todas.length - abertas.length} já concluída(s)`}
            />
            <StatCard
              icon={Clock}
              iconClassName="bg-aviso/15 text-aviso"
              label="Vencem hoje"
              value={vencemHoje}
              isLoading={active.isPending}
              isError={active.isError}
              footer={vencemHoje === 0 ? 'Nada vencendo hoje' : 'Fique atento'}
            />
            <StatCard
              icon={AlertCircle}
              iconClassName="bg-erro/15 text-erro"
              label="Atrasadas"
              value={atrasadas}
              isLoading={active.isPending}
              isError={active.isError}
              footer={atrasadas === 0 ? 'Nenhuma passou do prazo' : 'Precisa de ação'}
              {...(atrasadas > 0 ? { sublabel: { text: 'precisa de ação', tone: 'urgent' as const } } : {})}
            />
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-grafite-elevado bg-grafite p-1">
          <button
            type="button"
            onClick={() => setScope('agency')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              scope === 'agency' ? 'bg-roxo-eletrico text-branco-cru' : 'text-nevoa hover:text-branco-cru',
            )}
          >
            <ListChecks size={14} />
            Todas as tarefas
            {agency.data && <Contador n={agency.data.tasks.length} ativo={scope === 'agency'} />}
          </button>
          <button
            type="button"
            onClick={() => setScope('mine')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              scope === 'mine' ? 'bg-roxo-eletrico text-branco-cru' : 'text-nevoa hover:text-branco-cru',
            )}
          >
            <User size={14} />
            Minhas tarefas
            {mine.data && <Contador n={mine.data.tasks.length} ativo={scope === 'mine'} />}
          </button>
        </div>

        <div className="flex rounded-lg border border-grafite-elevado bg-grafite p-1">
          <button
            type="button"
            onClick={() => setView('list')}
            title="Lista"
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
              view === 'list' ? 'bg-roxo-eletrico text-branco-cru' : 'text-nevoa hover:text-branco-cru',
            )}
          >
            <List size={14} />
          </button>
          <button
            type="button"
            onClick={() => setView('kanban')}
            title="Kanban"
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
              view === 'kanban' ? 'bg-roxo-eletrico text-branco-cru' : 'text-nevoa hover:text-branco-cru',
            )}
          >
            <Columns3 size={14} />
          </button>
        </div>

        {!notLinkedYet && (
          <>
            <div className="relative min-w-[220px] flex-1">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-nevoa" />
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por nome da tarefa…"
                className="w-full rounded-md border border-grafite-elevado bg-carbono py-1.5 pl-8 pr-3 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
              />
            </div>

            {scope === 'agency' && clientOptions.length > 0 && (
              <select
                value={clientFilter}
                onChange={(event) => setClientFilter(event.target.value)}
                className="rounded-md border border-grafite-elevado bg-carbono px-2 py-1.5 text-sm text-branco-cru focus:outline-none"
              >
                <option value="all">Todos os clientes</option>
                {clientOptions.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            )}

            {statusOptions.length > 0 && (
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="rounded-md border border-grafite-elevado bg-carbono px-2 py-1.5 text-sm text-branco-cru focus:outline-none"
              >
                <option value="all">Todos os status</option>
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            )}

            {(ownerOptions.nomes.length > 0 || ownerOptions.temOrfa) && (
              <select
                value={ownerFilter}
                onChange={(event) => setOwnerFilter(event.target.value)}
                className="rounded-md border border-grafite-elevado bg-carbono px-2 py-1.5 text-sm text-branco-cru focus:outline-none"
              >
                <option value="all">Todos responsáveis</option>
                {ownerOptions.temOrfa && <option value="__sem__">Sem responsável</option>}
                {ownerOptions.nomes.map((nome) => (
                  <option key={nome} value={nome}>
                    {nome}
                  </option>
                ))}
              </select>
            )}
          </>
        )}
      </div>

      <Surface level="grafite" className="p-2">
        {notLinkedYet ? (
          <LinkClickUpEmailPrompt />
        ) : active.isPending ? (
          <div className="space-y-2 p-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-16 w-full" />
            ))}
          </div>
        ) : active.isError ? (
          <EmptyState
            icon={ListChecks}
            title="Não foi possível carregar as tarefas"
            description="Confira o acesso ao ClickUp em Configurações e tente de novo."
          />
        ) : filteredTasks.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title={scope === 'agency' ? 'Nenhuma tarefa encontrada' : 'Nenhuma tarefa atribuída a você'}
            description={
              scope === 'agency'
                ? 'O ClickUp da agência não devolveu nenhuma tarefa aberta, ou o filtro está muito restrito.'
                : 'Nenhuma tarefa aberta está atribuída a você no ClickUp agora.'
            }
          />
        ) : view === 'kanban' ? (
          <div className="p-2">
            <TaskKanbanBoard tasks={filteredTasks} showClient={scope === 'agency'} />
          </div>
        ) : (
          <div className="divide-y divide-grafite-elevado">
            {filteredTasks.map((task) => (
              <AgencyTaskRow key={task.id} task={task} showClient={scope === 'agency'} />
            ))}
          </div>
        )}
      </Surface>

      {active.data?.truncated && (
        <p className="text-center font-mono text-[10px] text-nevoa">
          Mostrando um recorte das tarefas mais recentes. O total real pode ser maior.
        </p>
      )}

      {active.data?.unavailable_clients && active.data.unavailable_clients.length > 0 && (
        <p className="text-center font-mono text-[10px] text-aviso">
          Não foi possível ler o ClickUp de: {active.data.unavailable_clients.join(', ')}. As tarefas desses clientes não
          aparecem aqui agora.
        </p>
      )}
    </div>
  );
}

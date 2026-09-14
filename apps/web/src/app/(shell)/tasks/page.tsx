'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link2, ListChecks, Search, User } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Surface } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { AgencyTaskRow } from '@/components/tasks/agency-task-row';
import { useAgencyTasks, useMyTasks } from '@/hooks/use-tasks';
import { useMe } from '@/hooks/use-me';
import { useUpdateMe } from '@/hooks/use-update-me';
import { ApiRequestError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type Scope = 'agency' | 'mine';

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

export default function TasksPage() {
  const [scope, setScope] = useState<Scope>('agency');
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const agency = useAgencyTasks();
  const mine = useMyTasks({ enabled: scope === 'mine' });
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

  const filteredTasks = useMemo(() => {
    const tasks = active.data?.tasks ?? [];
    const query = search.trim().toLowerCase();
    return tasks.filter((task) => {
      if (query && !task.name.toLowerCase().includes(query)) return false;
      if (clientFilter !== 'all' && task.client?.id !== clientFilter) return false;
      if (statusFilter !== 'all' && task.status !== statusFilter) return false;
      return true;
    });
  }, [active.data, search, clientFilter, statusFilter]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="ClickUp"
        title="Central de Tasks"
        description="Todas as tarefas da agência, ou só as suas, direto do ClickUp."
      />

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
                ? 'Nenhum cliente com lista vinculada no ClickUp tem tarefas, ou o filtro está muito restrito.'
                : 'Você não tem tarefas atribuídas no momento neste conjunto de clientes.'
            }
          />
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
          Mostrando um recorte das tarefas mais recentes — o total real pode ser maior.
        </p>
      )}
    </div>
  );
}

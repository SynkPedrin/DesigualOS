'use client';

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Calendar,
  CheckSquare,
  ClipboardCheck,
  ClipboardList,
  MapPin,
  MessageCircle,
  Video,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Surface } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { StatCard } from '@/components/ui/stat-card';
import { EntityAvatar } from '@/components/ui/entity-avatar';
import { useClientWorkspace } from '@/hooks/use-client-workspace';
import { useMyWorkspace } from '@/hooks/use-my-workspace';
import { useClientOverview } from '@/hooks/use-client-overview';
import { useInboxThreads } from '@/hooks/use-inbox';
import { useDemands } from '@/hooks/use-demands';
import { useApprovals } from '@/hooks/use-approvals';
import { useCalendarEvents } from '@/hooks/use-calendar';
import { ClientOverviewPanel } from '@/components/clients/client-overview-panel';
import { ClientDemandsPanel } from '@/components/clients/client-demands-panel';
import { ClientTasksPanel } from '@/components/clients/client-tasks-panel';
import { ClientStudioGallery } from '@/components/clients/client-studio-gallery';
import { ClientMetaAdsPanel } from '@/components/clients/client-meta-ads-panel';
import { ClientGoogleAdsPanel } from '@/components/clients/client-google-ads-panel';
import { ClientReportsPanel } from '@/components/clients/client-reports-panel';
import { ClientTeamPanel } from '@/components/clients/client-team-panel';
import { GrantAccessForm } from '@/components/clients/grant-access-form';
import { ApiRequestError } from '@/lib/api/client';
import { formatClockTime, formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const STATUS_META: Record<string, { label: string; className: string }> = {
  active: { label: 'Ativo', className: 'border-sinal/40 bg-sinal/10 text-sinal' },
  pontual: { label: 'Pontual', className: 'border-roxo-eletrico/40 bg-roxo-eletrico/10 text-roxo-eletrico' },
  inactive: { label: 'Inativo', className: 'border-grafite-elevado bg-carbono text-nevoa' },
};

/**
 * "Mídia" entra aqui em 08/10/2026 e isso NÃO é tela nova — é tela achada.
 *
 * `ClientMetaAdsPanel` e `ClientGoogleAdsPanel` existem inteiros desde 06/10,
 * com as três etapas que a operação pediu (conectar a conta → escolher BM e
 * conta de anúncio deste cliente → ver performance). Só que o único lugar que
 * os renderizava era `client-detail-overlay.tsx`, um componente que NINGUÉM
 * importa. O backend dessas rotas — com teste de isolamento entre clientes e
 * tudo — nunca foi chamado em produção uma vez sequer.
 *
 * Os dois painéis tratam 403 devolvendo `null`, então o gate de módulo
 * (`meta_ads` / `google_ads` no workspace da pessoa) continua valendo sozinho:
 * quem não tem mídia no workspace vê a aba vazia, nunca um erro.
 *
 * "Acesso" entra pelo mesmo motivo, e fecha uma promessa quebrada: a tela de
 * Governança (/admin) diz, com todas as letras, que "acesso a um cliente
 * específico é concedido na aba Acesso da tela daquele cliente". Essa aba não
 * existia — `GrantAccessForm` também só vivia no overlay órfão. Era uma
 * instrução apontando para lugar nenhum.
 */
const TABS = ['Visão geral', 'Conversas', 'Demandas', 'Tarefas', 'Arquivos', 'Calendário', 'Aprovações', 'Mídia', 'Relatórios', 'Acesso'] as const;
type Tab = (typeof TABS)[number];

function inicioDoDia(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

export default function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: workspace, isPending, isError, error } = useClientWorkspace(id);
  const [tab, setTab] = useState<Tab>('Visão geral');

  /**
   * A aba Mídia só aparece para quem tem mídia no workspace.
   *
   * Os dois painéis já somem sozinhos no 403, mas sem este filtro a aba
   * continuaria clicável e abriria em branco — e tela vazia não ensina nada a
   * quem clicou. `modules` ausente (carregando, ou API antiga) conta como
   * PERMITIDO, mesma regra da barra lateral: esconder um item permitido por um
   * instante é pior que mostrá-lo.
   */
  const { data: meuWorkspace } = useMyWorkspace();
  const temMidia =
    !meuWorkspace || meuWorkspace.modules.includes('meta_ads') || meuWorkspace.modules.includes('google_ads');
  const abasVisiveis = TABS.filter((t) => t !== 'Mídia' || temMidia);

  const overview = useClientOverview(id);
  const threadsQuery = useInboxThreads({});
  const threadsDoCliente = (threadsQuery.data ?? []).filter((t) => t.clientId === id);
  const demandsQuery = useDemands({ clientId: id });
  const demandasAtivas = (demandsQuery.data ?? []).filter((d) => d.status !== 'done' && d.status !== 'cancelled');
  const approvalsQuery = useApprovals({});
  const aprovacoesDoCliente = (approvalsQuery.data ?? []).filter((a) => a.client_id === id);

  // `agora` fixado no MOUNT (useMemo, deps vazias): recalcular `new Date()` a
  // cada render alimentaria `useCalendarEvents` com um intervalo [from,to]
  // ligeiramente diferente toda vez, o que muda a queryKey e faz a consulta
  // nunca estabilizar (visto isso travar a aba Calendário num loading eterno
  // antes deste fix).
  const { from: inicioDoIntervalo, to: fimDoIntervalo } = useMemo(() => {
    const agora = new Date();
    return { from: inicioDoDia(agora), to: new Date(agora.getTime() + 30 * 86_400_000) };
  }, []);
  const eventosQuery = useCalendarEvents({ from: inicioDoIntervalo, to: fimDoIntervalo, clientId: id });
  const proximoEvento = (eventosQuery.data ?? []).find((e) => new Date(e.start_at).getTime() > Date.now());

  if (isPending) {
    return (
      <div className="mx-auto w-full max-w-[1800px] space-y-6">
        <PageHeader eyebrow="Clientes" title="Carregando…" />
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !workspace) {
    const msg = error instanceof ApiRequestError ? error.message : '';
    return (
      <div className="mx-auto w-full max-w-[1800px]">
        <VoltarParaClientes />
        <EmptyState
          icon={MessageCircle}
          title={/not found/i.test(msg) ? 'Este cliente não existe ou não é seu' : 'Não conseguimos carregar este cliente'}
          {...(/not found/i.test(msg) ? {} : { description: 'A consulta falhou, tente de novo.' })}
        />
      </div>
    );
  }

  const client = workspace.client;
  const statusMeta = STATUS_META[client.status] ?? STATUS_META.active!;
  const primeiraThread = threadsDoCliente[0] ?? null;

  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-6">
      <VoltarParaClientes />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <EntityAvatar name={client.name} kind="client" size="xl" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-heading text-2xl font-bold text-branco-cru">{client.name}</h1>
              <span className={cn('rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider', statusMeta.className)}>
                {statusMeta.label}
              </span>
            </div>
            <p className="mt-1 font-mono text-[11px] text-nevoa">
              {client.clickupListId ? `lista ${client.clickupListId}` : 'sem vínculo no ClickUp'}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {primeiraThread && (
            <Link
              href={`/inbox?t=${primeiraThread.id}`}
              className="flex items-center gap-1.5 rounded-md border border-sinal/40 bg-sinal/10 px-3 py-2 text-sm text-sinal transition-colors hover:border-sinal/70"
            >
              <MessageCircle size={14} />
              Abrir no WhatsApp
            </Link>
          )}
          <button
            type="button"
            onClick={() => setTab('Demandas')}
            className="rounded-md bg-roxo-eletrico px-3 py-2 text-sm font-semibold text-branco-cru transition-all hover:opacity-90"
          >
            Nova demanda
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-grafite-elevado">
        {abasVisiveis.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={cn(
              'rounded-t-md px-3 py-2 text-sm font-medium transition-colors',
              tab === item ? 'border-b-2 border-roxo-eletrico text-branco-cru' : 'text-nevoa hover:text-branco-cru',
            )}
          >
            {item}
          </button>
        ))}
      </div>

      {tab === 'Visão geral' && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon={ClipboardList}
              iconClassName="bg-roxo-eletrico/15 text-roxo-eletrico"
              label="Demandas ativas"
              value={demandasAtivas.length}
              isLoading={demandsQuery.isPending}
              isError={demandsQuery.isError}
            />
            <StatCard
              icon={CheckSquare}
              iconClassName="bg-sucesso/15 text-sucesso"
              label="Tarefas abertas"
              value={overview.data?.clickup?.open_tasks ?? 0}
              isLoading={overview.isPending}
              isError={overview.isError}
            />
            <StatCard
              icon={MessageCircle}
              iconClassName="bg-info/15 text-info"
              label="Conversas"
              value={threadsDoCliente.length}
              isLoading={threadsQuery.isPending}
              href="/inbox"
            />
            <StatCard
              icon={Calendar}
              iconClassName="bg-aviso/15 text-aviso"
              label="Próxima reunião"
              value={proximoEvento ? 1 : 0}
              isLoading={eventosQuery.isPending}
              formatValue={() => (proximoEvento ? formatClockTime(proximoEvento.start_at) : ', ')}
            />
          </div>

          <Surface className="p-5">
            <ClientOverviewPanel clientId={id} />
          </Surface>
        </div>
      )}

      {tab === 'Conversas' && (
        <Surface className="p-5">
          {threadsQuery.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : threadsDoCliente.length === 0 ? (
            <p className="py-8 text-center text-sm text-nevoa">Nenhuma conversa com este cliente ainda.</p>
          ) : (
            <ul className="divide-y divide-grafite-elevado">
              {threadsDoCliente.map((t) => (
                <li key={t.id}>
                  <Link href={`/inbox?t=${t.id}`} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <EntityAvatar name={t.contactName} kind="person" size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-branco-cru">{t.contactName}</p>
                      <p className="truncate text-xs text-nevoa">{t.contactPhone}</p>
                    </div>
                    {t.lastMessageAt && <span className="shrink-0 text-xs text-nevoa">{formatRelativeTime(t.lastMessageAt)}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Surface>
      )}

      {tab === 'Demandas' && (
        <Surface className="p-5">
          <ClientDemandsPanel clientId={id} />
        </Surface>
      )}

      {tab === 'Tarefas' && (
        <Surface className="p-5">
          <ClientTasksPanel clientId={id} clickupUrl={client.clickupUrl} />
        </Surface>
      )}

      {tab === 'Arquivos' && (
        <Surface className="p-5">
          <ClientStudioGallery clientId={id} />
        </Surface>
      )}

      {tab === 'Calendário' && (
        <Surface className="p-5">
          {eventosQuery.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : !eventosQuery.data || eventosQuery.data.length === 0 ? (
            <p className="py-8 text-center text-sm text-nevoa">Nenhuma reunião marcada com este cliente nos próximos 30 dias.</p>
          ) : (
            <ul className="space-y-3">
              {eventosQuery.data.map((evento) => (
                <li key={evento.id} className="rounded-lg border border-grafite-elevado bg-carbono p-3">
                  <p className="font-mono text-[11px] text-nevoa">
                    {new Date(evento.start_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} · {formatClockTime(evento.start_at)}
                  </p>
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
                </li>
              ))}
            </ul>
          )}
        </Surface>
      )}

      {tab === 'Aprovações' && (
        <Surface className="p-5">
          {approvalsQuery.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : aprovacoesDoCliente.length === 0 ? (
            <p className="py-8 text-center text-sm text-nevoa">Nenhuma aprovação registrada para este cliente ainda.</p>
          ) : (
            <ul className="space-y-2">
              {aprovacoesDoCliente.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 rounded-lg border border-grafite-elevado bg-carbono px-3.5 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <ClipboardCheck size={14} className="text-nevoa" />
                    <span className="text-sm text-branco-cru">{a.resource_type === 'brief' ? 'Briefing' : a.resource_type}</span>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider',
                      a.status === 'pending' ? 'border-aviso/40 bg-aviso/10 text-aviso' : 'border-grafite-elevado bg-carbono text-nevoa',
                    )}
                  >
                    {a.status === 'pending' ? 'Pendente' : a.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Surface>
      )}

      {tab === 'Mídia' && (
        <div className="space-y-4">
          <ClientMetaAdsPanel clientId={id} />
          <ClientGoogleAdsPanel clientId={id} />
        </div>
      )}

      {tab === 'Relatórios' && (
        <Surface className="p-5">
          <ClientReportsPanel clientId={id} />
        </Surface>
      )}

      {tab === 'Acesso' && (
        <div className="space-y-4">
          <ClientTeamPanel clientId={id} />
          <Surface className="p-5">
            <GrantAccessForm clientId={id} />
          </Surface>
        </div>
      )}
    </div>
  );
}

function VoltarParaClientes() {
  return (
    <Link href="/clients" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-nevoa transition-colors hover:text-branco-cru">
      <ArrowLeft size={13} />
      Clientes
    </Link>
  );
}

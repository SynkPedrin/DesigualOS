'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Calendar, ClipboardList, FileText, Plus, Search, Users } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { EntityAvatar } from '@/components/ui/entity-avatar';
import { useClients } from '@/hooks/use-clients';
import { logoDoCliente } from '@/lib/client-logos';
import { useClientWorkspace } from '@/hooks/use-client-workspace';
import { useDemands } from '@/hooks/use-demands';
import { useInboxThreads } from '@/hooks/use-inbox';
import { useCalendarEvents } from '@/hooks/use-calendar';
import { useClientClickUpTasks } from '@/hooks/use-client-clickup-tasks';
import { ClientDemandsPanel } from '@/components/clients/client-demands-panel';
import { ClientTasksPanel } from '@/components/clients/client-tasks-panel';
import { ClientStudioGallery } from '@/components/clients/client-studio-gallery';
import { ClientTeamPanel } from '@/components/clients/client-team-panel';
import { ClientMemoryPanel } from '@/components/clients/client-memory-panel';
import { CreateClientModal } from '@/components/clients/create-client-modal';
import { corDaRecencia, pesoDeParado, textoDaRecencia, type OrdemDaGrade } from '@/components/clients/client-grid';
import { DEMO_CLIENT_INFO, DEMO_CLIENT_INFO_FALLBACK } from '@/mocks/demo-client-info';
import { DEMO_MODE } from '@/lib/demo-mode';
import { formatRelativeTime } from '@/lib/format';
import type { ClientSummary } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';

/**
 * CLIENTES — mestre-detalhe (mockup "Clientes", 07/10/2026): lista à esquerda,
 * ficha do cliente selecionado ao centro, resumo operacional à direita.
 * Substitui o grid-de-cards+modal como view padrão desta rota — a lógica de
 * busca/recorte por natureza que o grid tinha não morre, os MESMOS hooks e
 * painéis (`ClientDemandsPanel`, `ClientTasksPanel`, `ClientStudioGallery`,
 * `ClientTeamPanel`) são reaproveitados aqui, só o container muda de grid
 * para lista.
 */

const STATUS_CHIPS = [
  { key: 'todos', label: 'Todos' },
  { key: 'active', label: 'Ativos' },
  { key: 'onboarding', label: 'Em Onboarding' },
  { key: 'paused', label: 'Em Pausa' },
  { key: 'inactive', label: 'Inativos' },
] as const;
type StatusChip = (typeof STATUS_CHIPS)[number]['key'];

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  active: { label: 'Ativo', className: 'border-sinal/40 bg-sinal/10 text-sinal' },
  onboarding: { label: 'Em onboarding', className: 'border-info/40 bg-info/10 text-info' },
  paused: { label: 'Em pausa', className: 'border-aviso/40 bg-aviso/10 text-aviso' },
  inactive: { label: 'Inativo', className: 'border-grafite-elevado bg-carbono text-nevoa' },
  pontual: { label: 'Pontual', className: 'border-roxo-eletrico/40 bg-roxo-eletrico/10 text-roxo-eletrico' },
};

const CENTER_TABS = ['Visão geral', 'Demandas', 'Tarefas', 'Calendário', 'Arquivos', 'Equipe', 'Memória', 'Mais'] as const;
type CenterTab = (typeof CENTER_TABS)[number];

function ClientsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: clients, isPending, isError, refetch } = useClients();
  const [busca, setBusca] = useState('');
  const [statusChip, setStatusChip] = useState<StatusChip>('todos');
  const [ordem, setOrdem] = useState<OrdemDaGrade>('natureza');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<CenterTab>('Visão geral');

  // Deep link ?id=<cliente> (⌘K) seleciona direto, sem precisar achar na lista.
  const deepLinkId = searchParams.get('id');
  useEffect(() => {
    if (deepLinkId) setSelectedId(deepLinkId);
  }, [deepLinkId]);
  useEffect(() => {
    if (!selectedId && clients && clients.length > 0) setSelectedId(clients[0]!.id);
  }, [clients, selectedId]);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const resultado = (clients ?? []).filter((c) => {
      if (statusChip !== 'todos' && c.status !== statusChip) return false;
      return !termo || c.name.toLowerCase().includes(termo);
    });
    if (ordem === 'parados') {
      // Parados primeiro: quem nunca se mexeu no topo, quem não pôde ser medido
      // no fim — ver pesoDeParado em client-grid.tsx pro porquê da ordem.
      return [...resultado].sort((a, b) => pesoDeParado(b) - pesoDeParado(a));
    }
    // COM LOGO PRIMEIRO, EM ORDEM ALFABÉTICA (08/10/2026). Quem opera varre a
    // lista pela MARCA, não pelo nome escrito: reconhecer a logo é mais rápido
    // que ler. Misturar cliente com e sem logo quebrava essa varredura, porque
    // o olho perdia o ritmo a cada bloco de iniciais.
    //
    // Não é juízo de valor sobre o cliente: é pôr junto o que se reconhece de
    // relance. Quem ainda não tem logo fica logo abaixo, também em ordem, e
    // aparece igual na busca.
    return [...resultado].sort((a, b) => {
      const comLogoA = logoDoCliente(a.name) ? 0 : 1;
      const comLogoB = logoDoCliente(b.name) ? 0 : 1;
      if (comLogoA !== comLogoB) return comLogoA - comLogoB;
      return a.name.localeCompare(b.name, 'pt-BR');
    });
  }, [clients, busca, statusChip, ordem]);

  /**
   * CARTEIRA NÃO É TUDO QUE ESTÁ NA TABELA (mesma regra de
   * resumo-da-operacao.tsx): fixture sai da contagem, interno fica à parte.
   */
  const carteira = (clients ?? []).filter((c) => c.natureza === 'CLIENTE');
  const internos = (clients ?? []).filter((c) => c.natureza === 'INTERNO');
  const fixtures = (clients ?? []).filter((c) => c.natureza === 'FIXTURE');

  const selecionado = (clients ?? []).find((c) => c.id === selectedId) ?? null;

  return (
    <div>
      <PageHeader
        eyebrow="Contas"
        title="Clientes"
        description="Gerencie seus clientes, conversas, demandas e performance."
        actions={
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-2 rounded-md bg-roxo-eletrico px-3.5 py-2 text-sm font-semibold text-branco-cru transition-all hover:opacity-90 hover:shadow-glow"
          >
            <Plus size={15} />
            Novo cliente
          </button>
        }
      />

      {!isPending && !isError && clients && clients.length > 0 && (
        <p className="mb-2 text-[13px] text-branco-cru">
          <span className="font-medium">{carteira.length}</span>
          <span className="text-nevoa"> na carteira</span>
          {internos.length > 0 && <span className="text-nevoa"> · {internos.length} internos</span>}
          {fixtures.length > 0 && <span className="text-nevoa/60"> · {fixtures.length} fixture</span>}
        </p>
      )}

      {!isPending && !isError && clients && clients.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setOrdem(ordem === 'parados' ? 'natureza' : 'parados')}
              aria-pressed={ordem === 'parados'}
              className={cn(
                'rounded-full border px-3 py-1.5 text-[13px] transition-colors',
                ordem === 'parados' ? 'border-roxo-eletrico/60 bg-roxo-eletrico/15 text-branco-cru' : 'border-grafite-elevado text-nevoa hover:text-branco-cru',
              )}
            >
              Parados primeiro
            </button>
            {STATUS_CHIPS.map(({ key, label }) => {
              const quantos = key === 'todos' ? clients.length : clients.filter((c) => c.status === key).length;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStatusChip(key)}
                  aria-pressed={statusChip === key}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-[13px] transition-colors',
                    statusChip === key ? 'border-roxo-eletrico/60 bg-roxo-eletrico/15 text-branco-cru' : 'border-grafite-elevado text-nevoa hover:text-branco-cru',
                  )}
                >
                  {label} <span className="text-nevoa/60">{quantos}</span>
                </button>
              );
            })}
          </div>
          <div className="relative w-full sm:w-64">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-nevoa" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar cliente..."
              aria-label="Buscar cliente"
              className="w-full rounded-md border border-grafite-elevado bg-grafite py-2 pl-9 pr-3 text-[14px] text-branco-cru placeholder:text-nevoa/60 focus:border-roxo-eletrico/60 focus:outline-none"
            />
          </div>
        </div>
      )}

      {isPending ? (
        <div className="grid grid-cols-[300px_1fr_300px] gap-4">
          <Skeleton className="h-[600px]" />
          <Skeleton className="h-[600px]" />
          <Skeleton className="h-[600px]" />
        </div>
      ) : isError ? (
        <div className="space-y-4">
          <EmptyState icon={Users} title="Não conseguimos carregar seus clientes." description="Verifique sua conexão e tente novamente." />
          <div className="flex justify-center">
            <button type="button" onClick={() => refetch()} className="rounded-md bg-roxo-eletrico px-4 py-2 text-sm font-medium text-branco-cru transition-all hover:opacity-90 hover:shadow-glow">
              Tentar novamente
            </button>
          </div>
        </div>
      ) : !clients || clients.length === 0 ? (
        <EmptyState icon={Users} title="Nenhum cliente ainda" description="Importe os clientes do ClickUp em Configurações → Integrações, ou clique em Novo cliente." />
      ) : (
        <div className="grid grid-cols-[300px_1fr_300px] gap-4" style={{ minHeight: 'calc(100vh - 260px)' }}>
          <div className="flex flex-col overflow-hidden rounded-lg border border-grafite-elevado">
            <div className="flex-1 divide-y divide-grafite-elevado overflow-y-auto">
              {filtrados.length === 0 ? (
                <p className="p-4 text-center text-sm text-nevoa">Nada com esse filtro.</p>
              ) : (
                filtrados.map((client) => {
                  const badge = STATUS_BADGE[client.status];
                  return (
                    <button
                      key={client.id}
                      type="button"
                      data-client-id={client.id}
                      onClick={() => { setSelectedId(client.id); setTab('Visão geral'); }}
                      className={cn(
                        'flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-grafite-elevado/60',
                        selectedId === client.id && 'bg-grafite-elevado',
                      )}
                    >
                      <div className="flex items-center gap-2.5">
                        <EntityAvatar name={client.name} kind="client" size="sm" />
                        <span className="min-w-0 flex-1 truncate font-semibold text-branco-cru">{client.name}</span>
                        {badge && <span className={cn('shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium', badge.className)}>{badge.label}</span>}
                      </div>
                      <p className={cn('truncate pl-[34px] text-xs', corDaRecencia(client.ultimaAtividade))}>
                        {textoDaRecencia(client.ultimaAtividade)}
                      </p>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {selecionado ? (
            <ClientCenterPanel client={selecionado} tab={tab} onTab={setTab} />
          ) : (
            <div className="flex items-center justify-center rounded-lg border border-grafite-elevado">
              <EmptyState icon={Users} title="Selecione um cliente" description="Escolha um cliente na lista pra ver a ficha completa." />
            </div>
          )}

          {selecionado ? <ClientSidePanel client={selecionado} /> : <div className="rounded-lg border border-grafite-elevado" />}
        </div>
      )}

      {creating && <CreateClientModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function ClientCenterPanel({ client, tab, onTab }: { client: ClientSummary; tab: CenterTab; onTab: (t: CenterTab) => void }) {
  // Segmento/e-mail/telefone/observações não têm coluna no contrato real —
  // só existem como fixture da demo (auditoria §10). Em produção cai no
  // fallback "[CONFIRMAR: ...]", que é honesto: diz que o campo não tem fonte,
  // em vez de atribuir um telefone inventado a um cliente de verdade.
  const info = (DEMO_MODE ? DEMO_CLIENT_INFO[client.id] : undefined) ?? DEMO_CLIENT_INFO_FALLBACK;
  const badge = STATUS_BADGE[client.status];
  const demandasAtivas = useDemands({ clientId: client.id });
  const tarefas = useClientClickUpTasks(client.id);
  const now = useMemo(() => new Date(), []);
  const proximos30d = useMemo(() => new Date(now.getTime() + 30 * 86_400_000), [now]);
  const eventos = useCalendarEvents({ from: now, to: proximos30d, clientId: client.id });
  const threadsDoCliente = useInboxThreads({});

  const ativasCount = (demandasAtivas.data ?? []).filter((d) => d.status !== 'done' && d.status !== 'cancelled').length;
  const emAndamentoCount = (demandasAtivas.data ?? []).filter((d) => d.status === 'in_production').length;
  const tarefasAndamento = tarefas.data?.filter((t) => t.status_type !== 'closed').length ?? 0;
  const proximaReuniao = (eventos.data ?? []).find((e) => new Date(e.start_at).getTime() > Date.now());
  const conversas = (threadsDoCliente.data ?? []).filter((t) => t.clientId === client.id).slice(0, 4);

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-grafite-elevado">
      <div className="flex items-center justify-between gap-3 border-b border-grafite-elevado px-5 py-4">
        <div className="flex items-center gap-3">
          <EntityAvatar name={client.name} kind="client" size="lg" />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-heading text-lg font-semibold text-branco-cru">{client.name}</h2>
              {badge && <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-medium', badge.className)}>{badge.label}</span>}
            </div>
            <p className="text-xs text-nevoa">Cliente desde {info.clienteDesde}</p>
          </div>
        </div>
        <Link
          href={`/inbox?t=${conversas[0]?.id ?? ''}`}
          className="rounded-md bg-roxo-eletrico px-3.5 py-2 text-sm font-semibold text-branco-cru transition-all hover:opacity-90 hover:shadow-glow"
        >
          Abrir conversa
        </Link>
      </div>

      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-grafite-elevado px-3 py-2">
        {CENTER_TABS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onTab(item)}
            className={cn(
              'shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              tab === item ? 'bg-grafite-elevado text-branco-cru' : 'text-nevoa hover:text-branco-cru',
            )}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {tab === 'Visão geral' && (
          <div className="space-y-6">
            <div className="grid max-w-2xl grid-cols-3 gap-3">
              <div className="rounded-lg border border-grafite-elevado bg-carbono p-4">
                <p className="font-mono text-[10px] uppercase tracking-wider text-nevoa">Demandas ativas</p>
                <p className="mt-1 font-display text-2xl text-branco-cru">{ativasCount}</p>
              </div>
              <div className="rounded-lg border border-grafite-elevado bg-carbono p-4">
                <p className="font-mono text-[10px] uppercase tracking-wider text-nevoa">Tarefas em andamento</p>
                <p className="mt-1 font-display text-2xl text-branco-cru">{tarefasAndamento || emAndamentoCount}</p>
              </div>
              <div className="rounded-lg border border-grafite-elevado bg-carbono p-4">
                <p className="font-mono text-[10px] uppercase tracking-wider text-nevoa">Próxima reunião</p>
                <p className="mt-1 text-sm font-semibold text-branco-cru">
                  {proximaReuniao ? new Date(proximaReuniao.start_at).toLocaleDateString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : 'Nenhuma agendada'}
                </p>
              </div>
            </div>

            {info.badges.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {info.badges.map((b) => (
                  <span key={b} className="rounded-full bg-grafite-elevado px-2.5 py-1 text-xs text-nevoa">{b}</span>
                ))}
              </div>
            )}

            <section className="space-y-2">
              <h3 className="font-mono text-[11px] uppercase tracking-wider text-nevoa">Informações do cliente</h3>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-grafite-elevado bg-carbono p-4 text-sm">
                <div><dt className="text-xs text-nevoa">Segmento</dt><dd className="text-branco-cru">{info.segmento}</dd></div>
                <div><dt className="text-xs text-nevoa">E-mail</dt><dd className="text-branco-cru">{info.email}</dd></div>
                <div><dt className="text-xs text-nevoa">Telefone</dt><dd className="text-branco-cru">{info.telefone}</dd></div>
                <div><dt className="text-xs text-nevoa">Localização</dt><dd className="text-branco-cru">{info.localizacao}</dd></div>
                <div className="col-span-2"><dt className="text-xs text-nevoa">Observações</dt><dd className="text-branco-cru">{info.observacoes}</dd></div>
              </dl>
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-mono text-[11px] uppercase tracking-wider text-nevoa">Últimas conversas</h3>
                <Link href="/inbox" className="flex items-center gap-1 text-[11px] text-nevoa hover:text-branco-cru">Ver todas <ArrowRight size={11} /></Link>
              </div>
              {conversas.length === 0 ? (
                <p className="text-sm text-nevoa">Nenhuma conversa registrada ainda.</p>
              ) : (
                <ul className="space-y-1.5">
                  {conversas.map((c) => (
                    <li key={c.id}>
                      <Link href={`/inbox?t=${c.id}`} className="flex items-center justify-between gap-3 rounded-md border border-grafite-elevado bg-carbono px-3 py-2 hover:border-roxo-eletrico/40">
                        <span className="min-w-0 flex-1 truncate text-sm text-branco-cru">{c.lastMessagePreview ?? c.contactName}</span>
                        {c.lastMessageAt && <span className="shrink-0 font-mono text-[10px] text-nevoa">{formatRelativeTime(c.lastMessageAt)}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

        {tab === 'Demandas' && <ClientDemandsPanel clientId={client.id} />}
        {tab === 'Tarefas' && <ClientTasksPanel clientId={client.id} clickupUrl={client.clickupUrl} />}
        {tab === 'Calendário' && <ClienteCalendarioTab clientId={client.id} />}
        {tab === 'Arquivos' && <ClientStudioGallery clientId={client.id} />}
        {tab === 'Equipe' && <ClientTeamPanel clientId={client.id} />}
        {tab === 'Memória' && <ClientMemoryPanel clientId={client.id} />}
        {tab === 'Mais' && (
          <div className="space-y-2 text-sm text-nevoa">
            <p>Mais opções pra {client.name}:</p>
            <ul className="list-inside list-disc space-y-1">
              <li><Link href={`/clients/${client.id}`} className="text-roxo-eletrico hover:underline">Abrir ficha completa</Link></li>
              {client.clickupUrl && <li><a href={client.clickupUrl} target="_blank" rel="noreferrer" className="text-roxo-eletrico hover:underline">Ver no ClickUp</a></li>}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function ClienteCalendarioTab({ clientId }: { clientId: string }) {
  const agora = useMemo(() => new Date(), []);
  const fimJanela = useMemo(() => new Date(agora.getTime() + 60 * 86_400_000), [agora]);
  const { data: eventos, isPending } = useCalendarEvents({ from: agora, to: fimJanela, clientId });

  if (isPending) return <Skeleton className="h-40 w-full" />;
  if (!eventos || eventos.length === 0) {
    return <EmptyState icon={Calendar} title="Nada agendado" description="Sem reuniões ou prazos nos próximos 60 dias pra este cliente." />;
  }
  return (
    <ul className="space-y-2">
      {eventos.map((e) => (
        <li key={e.id} className="flex items-center gap-3 rounded-md border border-grafite-elevado bg-carbono px-3 py-2">
          <Calendar size={14} className="shrink-0 text-nevoa" />
          <span className="min-w-0 flex-1 truncate text-sm text-branco-cru">{e.visible ? e.title : 'Ocupado'}</span>
          <span className="shrink-0 font-mono text-[11px] text-nevoa">{new Date(e.start_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</span>
        </li>
      ))}
    </ul>
  );
}

function ClientSidePanel({ client }: { client: ClientSummary }) {
  const { data: demands, isPending: demandsPending } = useDemands({ clientId: client.id });
  const { data: workspace, isPending: workspacePending } = useClientWorkspace(client.id);
  const emAndamento = (demands ?? []).filter((d) => d.status !== 'done' && d.status !== 'cancelled').slice(0, 3);
  const arquivos = (workspace?.studioAssets ?? []).slice(0, 3);

  return (
    <div className="flex flex-col gap-4 overflow-y-auto rounded-lg border border-grafite-elevado p-4">
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 font-heading text-sm font-semibold text-branco-cru"><ClipboardList size={14} /> Demandas em andamento</h3>
        </div>
        {demandsPending ? (
          <Skeleton className="h-16 w-full" />
        ) : emAndamento.length === 0 ? (
          <p className="text-sm text-nevoa">Nenhuma demanda em andamento.</p>
        ) : (
          <ul className="space-y-1.5">
            {emAndamento.map((d) => (
              <li key={d.id}>
                <Link href={`/demands/${d.id}`} className="block rounded-md border border-grafite-elevado bg-carbono px-3 py-2 hover:border-roxo-eletrico/40">
                  <p className="truncate text-sm font-medium text-branco-cru">{d.title}</p>
                  <p className="text-xs text-nevoa">{d.dueDate ? formatRelativeTime(d.dueDate) : 'Sem prazo'}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="flex items-center gap-1.5 font-heading text-sm font-semibold text-branco-cru"><FileText size={14} /> Arquivos recentes</h3>
        {workspacePending ? (
          <Skeleton className="h-16 w-full" />
        ) : arquivos.length === 0 ? (
          <p className="text-sm text-nevoa">Nenhum arquivo gerado ainda.</p>
        ) : (
          <ul className="space-y-1.5">
            {arquivos.map((a) => (
              <li key={a.id} className="flex items-center gap-2 rounded-md border border-grafite-elevado bg-carbono px-3 py-2">
                <FileText size={14} className={cn('shrink-0', /\.pdf$/i.test(a.filename) ? 'text-erro' : 'text-nevoa')} />
                <span className="min-w-0 flex-1 truncate text-sm text-branco-cru">{a.filename}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function ClientsPage() {
  return (
    <Suspense fallback={null}>
      <ClientsPageContent />
    </Suspense>
  );
}

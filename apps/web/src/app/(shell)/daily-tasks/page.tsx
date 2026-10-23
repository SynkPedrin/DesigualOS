'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Building2, CalendarClock, CalendarDays, ChevronRight, Columns3, Filter, GanttChart, List as ListIcon, ListChecks, Plus, Search, Settings2, SlidersHorizontal, Table2, Ban } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Arvore } from '@/components/daily-tasks/tree';
import { BoardView } from '@/components/daily-tasks/board-view';
import { CalendarView } from '@/components/daily-tasks/calendar-view';
import { GanttView } from '@/components/daily-tasks/gantt-view';
import { ListView, type TaskActions } from '@/components/daily-tasks/list-view';
import { TableView } from '@/components/daily-tasks/table-view';
import { TaskDrawer } from '@/components/daily-tasks/task-drawer';
import type { FiltroRapido} from '@/components/daily-tasks/painel-lateral';
import { PainelLateral } from '@/components/daily-tasks/painel-lateral';
import { LogoDoCliente, nomeLimpo } from '@/components/daily-tasks/cliente';
import { Popover } from '@/components/daily-tasks/primitivas';
import { StatCard } from '@/components/daily-tasks/ui';
import {
  PRIORIDADES,
  useCreateStatus,
  useCreateTask,
  useSpaceStatuses,
  useUpdateTask,
  useWorkMembers,
  useWorkTasks,
  useWorkTree,
  type WorkTaskWire,
} from '@/hooks/use-work';
import { COLUNAS_DA_LISTA, PREFERENCIAS_PADRAO, useBulkUpdate, usePreferences, useSavePreferences, useSavedViewActions, useSavedViews, useTaskArchiveActions, useWorkOverview, type ColunaDaLista } from '@/hooks/use-work-extra';
import { useDailyTasksAccess } from '@/hooks/use-daily-tasks-access';
import { useClients } from '@/hooks/use-clients';
import { ApiRequestError } from '@/lib/api/client';
import { toast } from '@/stores/toast-store';
import { cn } from '@/lib/utils';

type Visao = 'lista' | 'quadro' | 'calendario' | 'tabela' | 'gantt';
type Escopo = 'todas' | 'minhas' | 'criadas' | 'sigo' | 'sem_resp' | 'sem_prazo';
type Prazo = '' | 'hoje' | 'semana' | 'mes';
const ESCOPOS: Array<{ id: Escopo; rotulo: string }> = [{ id: 'todas', rotulo: 'Todas' }, { id: 'minhas', rotulo: 'Atribuídas a mim' }, { id: 'criadas', rotulo: 'Criadas por mim' }, { id: 'sigo', rotulo: 'Que eu sigo' }, { id: 'sem_resp', rotulo: 'Sem responsável' }, { id: 'sem_prazo', rotulo: 'Sem prazo' }];
const ROTULO_COLUNA: Record<ColunaDaLista, string> = { cliente: 'Cliente', andamento: 'Andamento', responsavel: 'Responsável', prazo: 'Prazo', prioridade: 'Prioridade', status: 'Status', tags: 'Tags' };
const VISOES: Array<{ id: Visao; label: string; icon: typeof ListIcon }> = [
  { id: 'lista', label: 'Lista', icon: ListIcon },
  { id: 'quadro', label: 'Quadro', icon: Columns3 },
  { id: 'calendario', label: 'Calendário', icon: CalendarDays },
  { id: 'tabela', label: 'Tabela', icon: Table2 },
  { id: 'gantt', label: 'Gantt', icon: GanttChart },
];
const campo = 'rounded-lg border border-grafite-elevado bg-carbono px-2.5 py-1.5 text-sm text-branco-cru outline-none focus:border-sinal/60';

export default function DailyTasksPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [arquivados, setArquivados] = useState(false);
  const eu = useDailyTasksAccess().data?.userId ?? null;
  const prefsQ = usePreferences();
  const prefs = prefsQ.data ?? PREFERENCIAS_PADRAO;
  const salvarPrefs = useSavePreferences();
  const expandir = prefs.subtarefasAbertas;
  const agrupar = prefs.agrupar;
  const concluidas = prefs.mostrarConcluidas;
  const [escopo, setEscopo] = useState<Escopo>((params.get('escopo') as Escopo | null) ?? 'todas');
  const [tag, setTag] = useState(params.get('tag') ?? '');
  const [prazo, setPrazo] = useState<Prazo>((params.get('prazo') as Prazo | null) ?? '');
  const [filtroCli, setFiltroCli] = useState<string | null>(params.get('cli'));
  const [filtroStatus, setFiltroStatus] = useState<string | null>(params.get('status'));
  const [rapido, setRapido] = useState<FiltroRapido>(null);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const clientes = useClients().data ?? [];
  const tree = useWorkTree(arquivados);
  const membrosQ = useWorkMembers();
  const [listId, setListId] = useState<string | null>(params.get('lista'));
  const [spaceId, setSpaceId] = useState<string | null>(params.get('espaco'));
  const [visaoLocal, setVisao] = useState<Visao | null>((params.get('visao') as Visao | null) ?? null);
  const visao: Visao = visaoLocal ?? prefs.visaoPadrao;
  const [q, setQ] = useState(params.get('q') ?? '');
  const [filtroResp, setFiltroResp] = useState<string | null>(params.get('resp'));
  const [filtroPrio, setFiltroPrio] = useState<number | null>(params.get('prio') ? Number(params.get('prio')) : null);
  const [abertaLocal, setAberta] = useState<string | null>(null);
  // `?task=<id>` abre a gaveta direto (links de notificação, Comunicação, Mídia).
  const aberta = abertaLocal ?? params.get('task');
  const fechar = () => { setAberta(null); if (params.get('task')) router.replace('/daily-tasks', { scroll: false }); };
  const [erro, setErro] = useState<string | null>(null);
  const [novaTarefa, setNovaTarefa] = useState('');
  const quickRef = useRef<HTMLInputElement>(null);
  const views = useSavedViews();
  const { salvar: salvarView } = useSavedViewActions();
  // Os filtros ficam no endereço: dá para copiar o link da tela filtrada e mandar para alguém.
  useEffect(() => {
    const t = setTimeout(() => {
      const u = new URLSearchParams();
      const set = (k: string, v: string | number | null | undefined) => { if (v !== null && v !== undefined && v !== '' && v !== 'todas') u.set(k, String(v)); };
      set('espaco', spaceId); set('lista', listId); set('visao', visaoLocal); set('resp', filtroResp); set('prio', filtroPrio); set('cli', filtroCli); set('status', filtroStatus);
      set('q', q.trim()); set('escopo', escopo); set('tag', tag.trim()); set('prazo', prazo);
      const tarefa = new URLSearchParams(window.location.search).get('task'); if (tarefa) u.set('task', tarefa);
      const novo = u.toString();
      if (novo !== window.location.search.replace(/^\?/, '')) router.replace(`/daily-tasks${novo ? `?${novo}` : ''}`, { scroll: false });
    }, 400);
    return () => clearTimeout(t);
  }, [spaceId, listId, visaoLocal, filtroResp, filtroPrio, filtroCli, filtroStatus, q, escopo, tag, prazo, router]);

  const spaces = tree.data?.spaces ?? [];
  const spaceAtivo = spaceId ?? spaces.find((s) => s.lists.length > 0)?.id ?? spaces[0]?.id ?? null;
  const space = spaces.find((s) => s.id === spaceAtivo) ?? null;
  const lista = useMemo(() => space?.lists.find((l) => l.id === listId) ?? null, [space, listId]);
  const pasta = lista?.folderId ? space?.folders.find((f) => f.id === lista.folderId) ?? null : null;
  const nomeCliente = lista?.clientId ? clientes.find((c) => c.id === lista.clientId)?.name ?? null : null;

  // Entrar numa lista de verdade ao abrir: um espaço sozinho não tem tarefas para criar.
  useEffect(() => { if (!listId && space) { const alvo = [...space.lists].sort((a, b) => b.openTaskCount - a.openTaskCount)[0]; if (alvo) setListId(alvo.id); } }, [space, listId]);
  // Trocar de lista limpa a seleção e o atalho do dia: o que estava marcado não está mais na tela.
  useEffect(() => { setSelecionadas(new Set()); setRapido(null); setFiltroStatus(null); }, [listId, spaceId]);

  const janela = useMemo(() => {
    if (!prazo) return {};
    const ini = new Date(); ini.setHours(0, 0, 0, 0);
    const fim = new Date(ini);
    if (prazo === 'hoje') fim.setDate(fim.getDate() + 1);
    else if (prazo === 'semana') fim.setDate(fim.getDate() + 7);
    else { ini.setDate(1); fim.setTime(new Date(ini.getFullYear(), ini.getMonth() + 1, 1).getTime()); }
    return { dueFrom: ini.toISOString(), dueTo: fim.toISOString() };
  }, [prazo]);
  const soAbertas = (visao === 'lista' || visao === 'tabela' || visao === 'gantt') && !concluidas;
  const tasks = useWorkTasks({ listId, spaceId: listId ? null : spaceAtivo, q: q.trim() || undefined, assigneeId: escopo === 'minhas' ? eu : filtroResp, priorities: filtroPrio === null ? [] : [filtroPrio], statusIds: filtroStatus ? [filtroStatus] : [], includeArchived: arquivados, clientId: filtroCli, completed: soAbertas ? false : undefined, tag: tag.trim() || null, ...janela,
    ...(escopo === 'minhas' ? { assigneeId: eu } : {}), ...(escopo === 'criadas' ? { createdBy: eu } : {}), ...(escopo === 'sigo' ? { followerId: eu } : {}), ...(escopo === 'sem_resp' ? { unassigned: true } : {}), ...(escopo === 'sem_prazo' ? { dueNone: true } : {}) });
  const statuses = useSpaceStatuses(spaceAtivo);
  const overview = useWorkOverview({ spaceId: spaceAtivo, listId, clientId: filtroCli });
  const membros = membrosQ.data?.members ?? [];
  const criarStatus = useCreateStatus(spaceAtivo);
  const criarTarefa = useCreateTask();
  const atualizar = useUpdateTask();
  const bulk = useBulkUpdate();
  const { arquivar } = useTaskArchiveActions();

  const mostrarErro = useCallback((e: unknown) => setErro(e instanceof ApiRequestError ? (e.status === 409 ? 'Outra pessoa alterou esta tarefa; a lista foi atualizada.' : e.message) : 'Algo deu errado.'), []);
  const actions: TaskActions = useMemo(() => ({
    abrir: (t: WorkTaskWire) => setAberta(t.id),
    atualizar: (t, patch) => { setErro(null); atualizar.mutate({ id: t.id, expectedVersion: t.version, ...patch }, { onError: mostrarErro }); },
    criar: (b) => { setErro(null); criarTarefa.mutate(b, { onError: mostrarErro }); },
  }), [atualizar, criarTarefa, mostrarErro]);

  const st = statuses.data?.statuses ?? [];
  const todas = tasks.data?.rows ?? [];
  const rows = useMemo(() => {
    if (!rapido) return todas;
    const hoje = new Date();
    return todas.filter((t) => {
      if (rapido === 'hoje') return !t.completedAt && t.dueAt !== null && new Date(t.dueAt).toDateString() === hoje.toDateString();
      if (rapido === 'atrasadas') return !t.completedAt && t.dueAt !== null && new Date(t.dueAt) < hoje && new Date(t.dueAt).toDateString() !== hoje.toDateString();
      return !t.completedAt && t.status?.category === 'blocked';
    });
  }, [todas, rapido]);
  const pronto = !tree.isPending && !tasks.isPending && !statuses.isPending;
  const c = overview.data?.contagens;
  const filtrosAtivos = [filtroResp, filtroPrio !== null ? 1 : null, filtroCli, filtroStatus, q.trim() || null, rapido, escopo !== 'todas' ? 1 : null, tag.trim() || null, prazo || null].filter(Boolean).length;
  const limparFiltros = () => { setFiltroResp(null); setFiltroPrio(null); setFiltroCli(null); setFiltroStatus(null); setQ(''); setRapido(null); setEscopo('todas'); setTag(''); setPrazo(''); };

  const paraSelecionadas = (fn: (ids: string[]) => void) => { const ids = [...selecionadas]; if (ids.length) fn(ids); };
  const concluirSelecionadas = () => paraSelecionadas((ids) => {
    const final = st.find((s) => s.category === 'done');
    if (!final) return toast('Este espaço não tem um status de concluído.', 'error');
    bulk.mutate({ ids, patch: { statusId: final.id } }, { onSuccess: (r) => { toast(`${r.okCount} tarefa(s) concluída(s).`, 'success'); setSelecionadas(new Set()); }, onError: mostrarErro });
  });
  const prioridadeSelecionadas = (p: number) => paraSelecionadas((ids) => bulk.mutate({ ids, patch: { priority: p } }, { onSuccess: (r) => { toast(`Prioridade alterada em ${r.okCount} tarefa(s).`, 'success'); setSelecionadas(new Set()); }, onError: mostrarErro }));
  const arquivarSelecionadas = () => paraSelecionadas(async (ids) => {
    if (!window.confirm(`Arquivar ${ids.length} tarefa(s)? Dá para restaurar depois.`)) return;
    await Promise.all(ids.map((id) => arquivar.mutateAsync({ id, arquivar: true }).catch(() => undefined)));
    toast(`${ids.length} tarefa(s) arquivada(s).`, 'success'); setSelecionadas(new Set());
  });

  const painel = <PainelLateral overview={overview.data} aoAbrir={setAberta} aoFiltrar={(f) => { setRapido(f); setVisao('lista'); }} />;

  return (
    <div className="space-y-3">
      <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)] 2xl:grid-cols-[210px_minmax(0,1fr)_290px]">
        <div className="md:sticky md:top-2 md:self-start">
          {tree.isPending ? <Skeleton className="h-64 w-full" /> : <Arvore spaces={spaces} listId={listId} spaceId={spaceAtivo} arquivados={arquivados} onArquivados={setArquivados} onPick={(l, s) => { setListId(l); setSpaceId(s); }} />}
        </div>

        <div className="min-w-0 space-y-4">
          <header className="space-y-3">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <nav aria-label="Caminho" className="flex flex-wrap items-center gap-1 text-xs text-nevoa">
                  {space && <span>{space.name}</span>}{pasta && <><ChevronRight size={11} /><span>{pasta.name}</span></>}
                </nav>
                <h1 className="flex items-center gap-3 font-heading text-3xl font-semibold text-branco-cru">
                  {lista && <LogoDoCliente nome={nomeLimpo(nomeCliente ?? lista.name)} className="!size-9" />}
                  <span className="truncate">{lista?.name ?? space?.name ?? 'Daily Tasks'}</span>
                </h1>
                <p className="text-sm text-nevoa">
                  {tasks.data ? `${tasks.data.total} tarefa(s)` : '…'} · {c?.atrasadas ?? 0} atrasada(s) · {membros.length} membros
                  {nomeCliente && <> · cliente <strong className="text-branco-cru">{nomeCliente}</strong></>}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <StatCard icone={CalendarClock} rotulo="Tarefas hoje" valor={c?.hoje ?? '—'} tom="verde" detalhe={c ? `ontem: ${c.ontem}` : undefined} onClick={() => { setRapido(rapido === 'hoje' ? null : 'hoje'); setVisao('lista'); }} ativo={rapido === 'hoje'} />
              <StatCard icone={AlertTriangle} rotulo="Atrasadas" valor={c?.atrasadas ?? '—'} tom="vermelho" detalhe="clique para ver só elas" onClick={() => { setRapido(rapido === 'atrasadas' ? null : 'atrasadas'); setVisao('lista'); }} ativo={rapido === 'atrasadas'} />
              <StatCard icone={Ban} rotulo="Bloqueadas" valor={c?.bloqueadas ?? '—'} tom="amarelo" detalhe="aguardando resolução" onClick={() => { setRapido(rapido === 'bloqueadas' ? null : 'bloqueadas'); setVisao('lista'); }} ativo={rapido === 'bloqueadas'} />
              <StatCard icone={Building2} rotulo="Clientes ativos" valor={c?.clientesAtivos ?? '—'} tom="roxo" detalhe="com tarefa aberta" />
            </div>
          </header>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-1 border-b border-grafite-elevado">
              <div role="tablist" aria-label="Como ver as tarefas" className="flex flex-wrap">
                {VISOES.map((v) => (
                  <button key={v.id} role="tab" aria-selected={visao === v.id} type="button" onClick={() => setVisao(v.id)} className={cn('-mb-px flex items-center gap-1.5 border-b-2 px-3.5 py-2 text-sm font-medium transition-colors', visao === v.id ? 'border-sinal text-branco-cru' : 'border-transparent text-nevoa hover:text-branco-cru')}>
                    <v.icon size={15} /> {v.label}
                  </button>
                ))}
              </div>
            </div>

            <div role="group" aria-label="Quais tarefas" className="flex flex-wrap gap-1.5">
              {ESCOPOS.map((x) => (
                <button key={x.id} type="button" aria-pressed={escopo === x.id} onClick={() => setEscopo(x.id)} className={cn('rounded-full px-3 py-1 text-xs font-medium transition-colors', escopo === x.id ? 'bg-sinal text-grafite' : 'bg-grafite-elevado text-nevoa hover:text-branco-cru')}>{x.rotulo}</button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex min-w-48 flex-1 items-center gap-2 rounded-lg border border-grafite-elevado bg-carbono px-2.5 py-1.5 focus-within:border-sinal/60 xl:max-w-xs"><Search size={14} className="text-nevoa" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar tarefas…" aria-label="Buscar tarefas" className="w-full bg-transparent text-sm text-branco-cru outline-none placeholder:text-nevoa" /></label>
              <select aria-label="Filtrar por responsável" value={filtroResp ?? ''} onChange={(e) => setFiltroResp(e.target.value || null)} className={campo}><option value="">Responsável: todos</option>{membros.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
              <select aria-label="Filtrar por prioridade" value={filtroPrio ?? ''} onChange={(e) => setFiltroPrio(e.target.value === '' ? null : Number(e.target.value))} className={campo}><option value="">Prioridade: todas</option>{[1, 2, 3, 4].map((p) => <option key={p} value={p}>{PRIORIDADES[p]!.label}</option>)}</select>
              <select aria-label="Filtrar por cliente" value={filtroCli ?? ''} onChange={(e) => setFiltroCli(e.target.value || null)} className={cn(campo, 'max-w-44')}><option value="">Cliente: todos</option>{clientes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
              <select aria-label="Filtrar por status" value={filtroStatus ?? ''} onChange={(e) => setFiltroStatus(e.target.value || null)} className={campo}><option value="">Status: todos</option>{st.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              <select aria-label="Filtrar por prazo" value={prazo} onChange={(e) => setPrazo(e.target.value as Prazo)} className={campo}><option value="">Prazo: qualquer</option><option value="hoje">Vence hoje</option><option value="semana">Próximos 7 dias</option><option value="mes">Este mês</option></select>
              <label className="flex items-center gap-1.5 rounded-lg border border-grafite-elevado bg-carbono px-2.5 py-1.5 focus-within:border-sinal/60"><span className="text-xs text-nevoa">tag</span><input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="ex.: urgente" aria-label="Filtrar por tag" className="w-24 bg-transparent text-sm text-branco-cru outline-none placeholder:text-nevoa/60" /></label>
              <Popover label="Personalizar visualização" trigger={<span className="flex items-center gap-1.5 rounded-lg border border-grafite-elevado px-2.5 py-1.5 text-sm text-branco-cru"><Settings2 size={14} /> Personalizar</span>}>
                {() => (
                  <div className="w-72 space-y-3 p-2 text-sm text-branco-cru">
                    <p className="text-[11px] uppercase tracking-wide text-nevoa">Só para você — salva automaticamente</p>
                    <fieldset className="space-y-1.5"><legend className="mb-1 text-xs text-nevoa">Colunas da tabela</legend>
                      {COLUNAS_DA_LISTA.map((c) => (
                        <label key={c} className="flex items-center gap-2"><input type="checkbox" checked={prefs.colunas.includes(c)} onChange={(e) => salvarPrefs.mutate({ colunas: e.target.checked ? COLUNAS_DA_LISTA.filter((x) => x === c || prefs.colunas.includes(x)) : prefs.colunas.filter((x) => x !== c) })} /> {ROTULO_COLUNA[c]}</label>
                      ))}
                    </fieldset>
                    <label className="flex items-center justify-between gap-2 text-xs text-nevoa">Tamanho das linhas
                      <select aria-label="Tamanho das linhas" value={prefs.densidade} onChange={(e) => salvarPrefs.mutate({ densidade: e.target.value as 'compacta' | 'confortavel' })} className={campo}><option value="confortavel">Confortável</option><option value="compacta">Compacta (cabe mais)</option></select>
                    </label>
                    <label className="flex items-center justify-between gap-2 text-xs text-nevoa">Abrir sempre em
                      <select aria-label="Visão padrão" value={prefs.visaoPadrao} onChange={(e) => salvarPrefs.mutate({ visaoPadrao: e.target.value as Visao })} className={campo}>{VISOES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select>
                    </label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={concluidas} onChange={(e) => salvarPrefs.mutate({ mostrarConcluidas: e.target.checked })} /> Mostrar tarefas concluídas</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={agrupar} onChange={(e) => salvarPrefs.mutate({ agrupar: e.target.checked })} /> Agrupar por status</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={expandir} onChange={(e) => salvarPrefs.mutate({ subtarefasAbertas: e.target.checked })} /> Subtarefas sempre abertas</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={arquivados} onChange={(e) => setArquivados(e.target.checked)} /> Mostrar arquivadas (só nesta sessão)</label>
                    <button type="button" onClick={() => salvarPrefs.mutate(PREFERENCIAS_PADRAO)} className="w-full rounded-lg border border-grafite-elevado px-2 py-1.5 text-xs text-nevoa hover:text-branco-cru">Voltar ao padrão</button>
                    <button type="button" onClick={limparFiltros} className="w-full rounded-lg border border-grafite-elevado px-2 py-1.5 text-xs text-nevoa hover:text-branco-cru">Limpar todos os filtros</button>
                  </div>
                )}
              </Popover>
              <select aria-label="Visões salvas" value="" onChange={(e) => { const v = views.data?.views.find((x) => x.id === e.target.value); if (!v) return; setVisao((v.config.visao as Visao) ?? 'lista'); setFiltroResp(v.config.assigneeId ?? null); setFiltroPrio(v.config.priority ?? null); if (v.config.spaceId) setSpaceId(v.config.spaceId); setListId(v.config.listId ?? null); }} className={campo}><option value="">Visões salvas…</option>{(views.data?.views ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
              <button type="button" title="Guarda lista, filtros e visualização atuais" onClick={() => { const n = window.prompt('Nome da visão'); if (n?.trim()) salvarView.mutate({ name: n.trim(), config: { visao, assigneeId: filtroResp, priority: filtroPrio, listId, spaceId: spaceAtivo } }, { onSuccess: () => toast('Visão salva.', 'success') }); }} className="rounded-lg border border-grafite-elevado px-2.5 py-1.5 text-sm text-nevoa hover:text-branco-cru">Salvar visão</button>
              <button type="button" onClick={() => { quickRef.current?.focus(); quickRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }} className="ml-auto flex items-center gap-1.5 rounded-lg bg-sinal px-4 py-1.5 text-sm font-semibold text-grafite hover:brightness-110"><Plus size={15} /> Nova tarefa</button>
            </div>
            {rapido && <p className="flex items-center gap-2 text-xs text-nevoa"><Filter size={12} /> Mostrando só: <strong className="text-branco-cru">{rapido === 'hoje' ? 'vencem hoje' : rapido === 'atrasadas' ? 'atrasadas' : 'bloqueadas'}</strong><button type="button" onClick={() => setRapido(null)} className="text-sinal hover:underline">tirar filtro</button></p>}
          </div>

          {selecionadas.size > 0 && (
            <div role="toolbar" aria-label="Ações em lote" className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-sinal/60 bg-grafite p-2 shadow-elevated">
              <strong className="px-2 text-sm text-branco-cru">{selecionadas.size} selecionada(s)</strong>
              <button type="button" onClick={concluirSelecionadas} className="rounded-lg bg-sucesso px-3 py-1.5 text-sm font-semibold text-carbono">Concluir</button>
              <select aria-label="Mudar prioridade das selecionadas" value="" onChange={(e) => e.target.value !== '' && prioridadeSelecionadas(Number(e.target.value))} className={campo}><option value="">Mudar prioridade…</option>{[1, 2, 3, 4, 0].map((p) => <option key={p} value={p}>{PRIORIDADES[p]!.label}</option>)}</select>
              <button type="button" onClick={arquivarSelecionadas} className="rounded-lg border border-grafite-elevado px-3 py-1.5 text-sm text-branco-cru hover:bg-grafite-elevado">Arquivar</button>
              <button type="button" onClick={() => setSelecionadas(new Set())} className="ml-auto text-sm text-nevoa hover:text-branco-cru">Limpar seleção</button>
            </div>
          )}

          {lista ? (
            <form className="flex items-center gap-2 rounded-xl border border-dashed border-grafite-elevado px-3 py-2 focus-within:border-sinal/60" onSubmit={(e) => { e.preventDefault(); if (novaTarefa.trim()) { actions.criar({ title: novaTarefa.trim(), listId: lista.id }); setNovaTarefa(''); } }}>
              <Plus size={16} className="text-sinal" />
              <input ref={quickRef} value={novaTarefa} onChange={(e) => setNovaTarefa(e.target.value)} placeholder={`Nova tarefa em "${lista.name}"${nomeCliente ? ` (cliente ${nomeCliente} já vem preenchido)` : ''} — escreva e aperte Enter`} aria-label="Nome da nova tarefa" className="min-w-0 flex-1 bg-transparent text-sm text-branco-cru outline-none placeholder:text-nevoa" />
              <button type="submit" disabled={!novaTarefa.trim()} className="rounded-lg bg-sinal px-3 py-1 text-xs font-semibold text-grafite disabled:opacity-40">Criar tarefa</button>
            </form>
          ) : (
            <p className="rounded-xl border border-dashed border-grafite-elevado px-3 py-2 text-sm text-nevoa">Para criar tarefas, <strong className="text-branco-cru">escolha uma lista</strong> no menu à esquerda.</p>
          )}

          {erro && <p role="alert" className="text-xs text-red-400">{erro}</p>}
          {!pronto ? (
            <Skeleton className="h-64 w-full" />
          ) : spaces.length === 0 || !space ? (
            <EmptyState icon={ListChecks} title="Crie o primeiro espaço" description='Use "Novo espaço" ao lado, depois crie uma lista para começar.' />
          ) : st.length === 0 ? (
            <EmptyState icon={ListChecks} title="Este espaço ainda não tem status" description="Crie o primeiro status em Novo status." />
          ) : visao === 'lista' ? (
            <ListView tarefas={rows} statuses={st} membros={membros} listId={listId} actions={actions} onNovoStatus={(n) => criarStatus.mutate(n)} expandirTudo={expandir} arquivadas={arquivados} agrupar={agrupar} selecionadas={selecionadas} onSelecionadas={setSelecionadas} />
          ) : visao === 'quadro' ? (
            <BoardView tarefas={rows} statuses={st} membros={membros} listId={listId} actions={actions} />
          ) : visao === 'gantt' ? (
            <GanttView tarefas={rows} actions={actions} />
          ) : visao === 'calendario' ? (
            <CalendarView tarefas={rows} actions={actions} membros={membros} />
          ) : (
            <TableView tarefas={rows} statuses={st} membros={membros} actions={actions} />
          )}
          {pronto && tasks.data && tasks.data.total > todas.length && <p className="text-xs text-nevoa">Mostrando {todas.length} de {tasks.data.total} tarefas.</p>}
          <div className="2xl:hidden">{painel}</div>
        </div>
        <div className="hidden 2xl:block">{painel}</div>
      </div>
      {aberta && <TaskDrawer taskId={aberta} onClose={fechar} onOpen={setAberta} />}
    </div>
  );
}

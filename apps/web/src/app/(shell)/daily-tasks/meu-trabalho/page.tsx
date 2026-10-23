'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, CalendarDays, CheckCircle2, CircleSlash } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { LogoDoCliente, nomeLimpo, useClientIndex, useListIndex } from '@/components/daily-tasks/cliente';
import { CabecalhoDaTabela, Linha, ordenarTarefas, type ColunaOrdenavel, type TaskActions } from '@/components/daily-tasks/list-view';
import { Avatar } from '@/components/daily-tasks/primitivas';
import { TaskDrawer } from '@/components/daily-tasks/task-drawer';
import { StatCard } from '@/components/daily-tasks/ui';
import { useDailyTasksAccess } from '@/hooks/use-daily-tasks-access';
import { useUpdateTask, useWorkMembers, useWorkTasks, type WorkTaskWire } from '@/hooks/use-work';
import { cn } from '@/lib/utils';

type Faixa = 'atrasadas' | 'hoje' | 'semana' | 'depois' | 'sem';
type Agrupar = 'prazo' | 'cliente' | 'lista';
const FAIXAS: Array<{ id: Faixa; titulo: string; cor: string }> = [
  { id: 'atrasadas', titulo: 'Atrasadas', cor: 'text-red-400' },
  { id: 'hoje', titulo: 'Hoje', cor: 'text-aviso' },
  { id: 'semana', titulo: 'Próximos 7 dias', cor: 'text-branco-cru' },
  { id: 'depois', titulo: 'Depois', cor: 'text-nevoa' },
  { id: 'sem', titulo: 'Sem data', cor: 'text-nevoa' },
];

function faixaDa(t: WorkTaskWire, agora: Date): Faixa {
  if (!t.dueAt) return 'sem';
  const d = new Date(t.dueAt);
  const ini = new Date(agora); ini.setHours(0, 0, 0, 0);
  const fim = new Date(agora); fim.setHours(23, 59, 59, 999);
  if (d < ini) return 'atrasadas';
  if (d <= fim) return 'hoje';
  return d.getTime() <= fim.getTime() + 7 * 86_400_000 ? 'semana' : 'depois';
}

export default function MeuTrabalhoPage() {
  const eu = useDailyTasksAccess().data?.userId ?? null;
  const membros = useWorkMembers().data?.members ?? [];
  const [pessoa, setPessoa] = useState<string | null>(null);
  const [concluidas, setConcluidas] = useState(false);
  const [agruparPor, setAgruparPor] = useState<Agrupar>('prazo');
  const [foco, setFoco] = useState<Faixa | null>(null);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [aberta, setAberta] = useState<string | null>(null);
  const alvo = pessoa ?? eu;
  const quem = membros.find((m) => m.id === alvo);
  const tasks = useWorkTasks({ assigneeId: alvo, completed: concluidas ? undefined : false, includeSubtasks: true, sort: 'due', enabled: Boolean(alvo) });
  const atualizar = useUpdateTask();
  const listas = useListIndex();
  const clientes = useClientIndex();
  const rows = tasks.data?.rows ?? [];
  const agora = useMemo(() => new Date(), []);
  const contagem = useMemo(() => { const c: Record<Faixa, number> = { atrasadas: 0, hoje: 0, semana: 0, depois: 0, sem: 0 }; for (const t of rows) if (!t.completedAt) c[faixaDa(t, agora)]++; return c; }, [rows, agora]);
  const visiveis = foco ? rows.filter((t) => faixaDa(t, agora) === foco && !t.completedAt) : rows;
  const grupos = useMemo(() => {
    const m = new Map<string, { titulo: string; cor?: string; clienteNome?: string; itens: WorkTaskWire[] }>();
    for (const t of visiveis) {
      let k: string; let titulo: string; let cor: string | undefined; let clienteNome: string | undefined;
      if (agruparPor === 'prazo') { const f = faixaDa(t, agora); const fx = FAIXAS.find((x) => x.id === f)!; k = `${FAIXAS.indexOf(fx)}`; titulo = fx.titulo; cor = fx.cor; }
      else if (agruparPor === 'cliente') { const n = (t.clientId && clientes.get(t.clientId)) || 'Sem cliente'; k = n; titulo = n; if (t.clientId && clientes.get(t.clientId)) clienteNome = n; }
      else { const l = listas.get(t.listId); k = t.listId; titulo = l ? `${l.espaco} › ${l.nome}` : 'Lista'; clienteNome = l ? nomeLimpo(l.nome) : undefined; }
      const g = m.get(k) ?? { titulo, ...(cor ? { cor } : {}), ...(clienteNome ? { clienteNome } : {}), itens: [] };
      g.itens.push(t); m.set(k, g);
    }
    return [...m.entries()].sort(([a], [b]) => (agruparPor === 'prazo' ? Number(a) - Number(b) : a.localeCompare(b))).map(([, g]) => ({ ...g, itens: ordenarTarefas(g.itens, { col: 'prazo' as ColunaOrdenavel, dir: 'asc' }) }));
  }, [visiveis, agruparPor, clientes, listas, agora]);

  const actions: TaskActions = { abrir: (t) => setAberta(t.id), atualizar: (t, patch) => atualizar.mutate({ id: t.id, expectedVersion: t.version, ...patch }), criar: () => undefined };
  const ctx = { statuses: null, membros, actions, expandirTudo: false, arquivadas: false, selecionadas, alternarSelecao: (id: string) => setSelecionadas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }), semSubtarefas: true };

  if (!eu || tasks.isPending) return <Skeleton className="h-96 w-full" />;
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-4">
        {quem && <Avatar nome={quem.name} url={quem.avatarUrl} size={48} />}
        <div className="min-w-0 flex-1">
          <h1 className="font-heading text-3xl font-semibold text-branco-cru">{alvo === eu ? 'Meu Trabalho' : `Trabalho de ${quem?.name ?? ''}`}</h1>
          <p className="text-sm text-nevoa">Tudo que está atribuído {alvo === eu ? 'a você' : 'a esta pessoa'}, de todos os clientes e listas.</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-nevoa">Ver o trabalho de
          <select aria-label="Pessoa" value={alvo ?? ''} onChange={(e) => setPessoa(e.target.value === eu ? null : e.target.value)} className="rounded-lg border border-grafite-elevado bg-carbono px-2.5 py-1.5 text-sm text-branco-cru">
            {membros.map((m) => <option key={m.id} value={m.id}>{m.id === eu ? `${m.name} (eu)` : m.name}</option>)}
          </select>
        </label>
      </header>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard icone={AlertTriangle} rotulo="Atrasadas" valor={contagem.atrasadas} tom="vermelho" onClick={() => setFoco(foco === 'atrasadas' ? null : 'atrasadas')} ativo={foco === 'atrasadas'} />
        <StatCard icone={CalendarClock} rotulo="Vencem hoje" valor={contagem.hoje} tom="amarelo" onClick={() => setFoco(foco === 'hoje' ? null : 'hoje')} ativo={foco === 'hoje'} />
        <StatCard icone={CalendarDays} rotulo="Próximos 7 dias" valor={contagem.semana} tom="verde" onClick={() => setFoco(foco === 'semana' ? null : 'semana')} ativo={foco === 'semana'} />
        <StatCard icone={CircleSlash} rotulo="Sem data" valor={contagem.sem} onClick={() => setFoco(foco === 'sem' ? null : 'sem')} ativo={foco === 'sem'} />
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-xs text-nevoa">Agrupar por</span>
        <div role="tablist" aria-label="Agrupar" className="flex gap-1">
          {(['prazo', 'cliente', 'lista'] as const).map((a) => (
            <button key={a} role="tab" aria-selected={agruparPor === a} type="button" onClick={() => setAgruparPor(a)} className={cn('rounded-lg px-3 py-1 text-sm capitalize', agruparPor === a ? 'bg-sinal font-medium text-grafite' : 'bg-grafite-elevado text-nevoa hover:text-branco-cru')}>{a}</button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-nevoa"><input type="checkbox" checked={concluidas} onChange={(e) => setConcluidas(e.target.checked)} /> Incluir concluídas</label>
        {foco && <button type="button" onClick={() => setFoco(null)} className="text-xs text-sinal hover:underline">tirar filtro</button>}
        <span className="ml-auto text-xs text-nevoa">{visiveis.length} tarefa(s)</span>
      </div>
      {visiveis.length === 0 ? (
        <EmptyState icon={CheckCircle2} title={alvo === eu ? 'Nada pendente para você' : `Nada pendente para ${quem?.name ?? 'esta pessoa'}`} description="Quando uma tarefa for atribuída, ela aparece aqui. Use o seletor para ver o trabalho de outra pessoa." />
      ) : grupos.map((g) => (
        <section key={g.titulo} aria-label={g.titulo} className="space-y-1.5">
          <h2 className={cn('flex items-center gap-2 text-sm font-semibold', g.cor ?? 'text-branco-cru')}>{g.clienteNome && <LogoDoCliente nome={g.clienteNome} className="!size-5" />}{g.titulo} <span className="font-normal text-nevoa">{g.itens.length}</span></h2>
          <div className="overflow-x-auto rounded-xl border border-grafite-elevado">
            <CabecalhoDaTabela />
            {g.itens.map((t) => <Linha key={t.id} t={t} nivel={0} ctx={ctx} />)}
          </div>
        </section>
      ))}
      {aberta && <TaskDrawer taskId={aberta} onClose={() => setAberta(null)} onOpen={setAberta} />}
    </div>
  );
}

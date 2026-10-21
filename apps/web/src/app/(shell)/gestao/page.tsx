'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CalendarCheck, CheckSquare, ClipboardList, ShieldAlert, Stamp, UserX, Video } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import { CartaoDoColaborador } from '@/components/gestao/cartao-do-colaborador';
import { usePainelDaEquipe, type PessoaDaGestao } from '@/hooks/use-gestao';
import { useIsMaster } from '@/hooks/use-is-master';
import { formatClockTime } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * GESTÃO DA EQUIPE — a tela de quem gerencia a operação (21/10/2026, para a
 * Tammy). Responde, nesta ordem: quem está atrasado, quanto cada um tem, o que
 * cada um está fazendo e como está a agenda deles hoje. Só trabalho: conversa
 * privada e compromisso particular ficam de fora (o particular aparece como
 * "Ocupado").
 */

type Ordem = 'atrasos' | 'carga' | 'nome';

function ordenar(pessoas: PessoaDaGestao[], ordem: Ordem) {
  const copia = [...pessoas];
  if (ordem === 'nome') return copia.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  if (ordem === 'carga') return copia.sort((a, b) => (b.tarefas?.abertas ?? 0) - (a.tarefas?.abertas ?? 0) || a.name.localeCompare(b.name, 'pt-BR'));
  const peso = (p: PessoaDaGestao) => (p.tarefas?.atrasadas ?? 0) * 10 + p.demandas.atrasadas * 10 + (p.tarefas?.vencem_hoje ?? 0);
  return copia.sort((a, b) => peso(b) - peso(a) || a.name.localeCompare(b.name, 'pt-BR'));
}

export default function GestaoPage() {
  const { isMaster, isPending: carregandoPapel } = useIsMaster();
  const painel = usePainelDaEquipe();
  const [ordem, setOrdem] = useState<Ordem>('atrasos');
  const pessoas = useMemo(() => ordenar(painel.data?.pessoas ?? [], ordem), [painel.data, ordem]);

  if (!carregandoPapel && !isMaster) {
    return <EmptyState icon={ShieldAlert} title="Acesso restrito" description="A gestão da equipe é de quem administra a operação." />;
  }

  const total = (f: (p: PessoaDaGestao) => number) => pessoas.reduce((s, p) => s + f(p), 0);
  const tarefas = painel.data?.tarefas;
  const emReuniao = pessoas.filter((p) => p.agenda.agora).length;
  const carregando = painel.isPending;
  const erro = painel.isError;
  // ClickUp fora: os cartões de tarefa mostram o erro, não "0 · Tudo em dia!" (que seria mentira).
  const semTarefas = erro || (tarefas !== undefined && !tarefas.disponivel);

  return (
    <div className="mx-auto max-w-[1680px]">
      <PageHeader
        eyebrow="Operação"
        title="Gestão da equipe"
        description="O que cada colaborador está fazendo, quanto tem para entregar, o que atrasou e como está a agenda de hoje."
        actions={painel.data ? <span className="font-mono text-[11px] text-nevoa">Atualizado às {formatClockTime(painel.data.gerado_em)}</span> : null}
      />

      {tarefas && !tarefas.disponivel && (
        <p role="status" className="mb-4 flex items-center gap-2 rounded-lg border border-sinal/40 bg-sinal/10 px-3 py-2 text-sm text-branco-cru">
          <AlertTriangle size={15} className="text-sinal" /> {tarefas.erro} As outras informações estão atualizadas.
        </p>
      )}
      {tarefas?.disponivel && tarefas.truncado && (
        <p role="status" className="mb-4 rounded-lg border border-grafite-elevado px-3 py-2 text-xs text-nevoa">O ClickUp devolveu só parte das tarefas (limite da consulta): os números podem estar abaixo do real.</p>
      )}

      <section aria-label="Resumo da equipe" className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 min-[1800px]:grid-cols-6">
        <StatCard icon={CheckSquare} label="Tarefas abertas" value={total((p) => p.tarefas?.abertas ?? 0)} isLoading={carregando} isError={semTarefas} footer={`${total((p) => p.tarefas?.vencem_na_semana ?? 0)} vencem nesta semana`} />
        <StatCard icon={AlertTriangle} iconClassName="bg-erro/15 text-erro" label="Atrasadas" value={total((p) => p.tarefas?.atrasadas ?? 0)} isLoading={carregando} isError={semTarefas}
          {...(total((p) => p.tarefas?.atrasadas ?? 0) > 0 ? { sublabel: { text: 'olhar hoje', tone: 'urgent' as const } } : {})}
          footer={total((p) => p.tarefas?.atrasadas ?? 0) === 0 ? 'Tudo em dia!' : `${pessoas.filter((p) => (p.tarefas?.atrasadas ?? 0) > 0).length} pessoa(s) com atraso`} />
        <StatCard icon={CalendarCheck} label="Vencem hoje" value={total((p) => p.tarefas?.vencem_hoje ?? 0)} isLoading={carregando} isError={semTarefas} />
        <StatCard icon={Video} label="Em reunião agora" value={emReuniao} isLoading={carregando} isError={erro} footer={`${total((p) => p.agenda.hoje)} compromissos hoje`} />
        <StatCard icon={ClipboardList} label="Quinzenas atrasadas" value={total((p) => p.demandas.atrasadas)} isLoading={carregando} isError={erro} footer={`${total((p) => p.demandas.abertas)} em andamento`} />
        <StatCard icon={Stamp} label="Aprovações esperando" value={total((p) => p.aprovacoes_pendentes)} isLoading={carregando} isError={erro} />
      </section>

      {tarefas?.disponivel && tarefas.sem_responsavel > 0 && (
        <p className="mb-4 flex items-center gap-2 text-sm text-nevoa">
          <UserX size={15} /> {tarefas.sem_responsavel} tarefa{tarefas.sem_responsavel > 1 ? 's' : ''} aberta{tarefas.sem_responsavel > 1 ? 's' : ''} sem responsável
          {tarefas.sem_responsavel_atrasadas > 0 && <span className="text-erro">({tarefas.sem_responsavel_atrasadas} atrasada{tarefas.sem_responsavel_atrasadas > 1 ? 's' : ''})</span>}
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">Colaboradores{pessoas.length ? ` · ${pessoas.length}` : ''}</h2>
        <div role="radiogroup" aria-label="Ordenar colaboradores" className="flex overflow-hidden rounded-md border border-grafite-elevado text-xs">
          {([['atrasos', 'Mais atrasos'], ['carga', 'Mais tarefas'], ['nome', 'Nome']] as const).map(([v, rotulo]) => (
            <button key={v} type="button" role="radio" aria-checked={ordem === v} onClick={() => setOrdem(v)} className={cn('px-3 py-1.5 transition-colors', ordem === v ? 'bg-roxo-eletrico text-white' : 'text-nevoa hover:text-branco-cru')}>{rotulo}</button>
          ))}
        </div>
      </div>

      {carregando ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-80 animate-pulse rounded-xl border border-grafite-elevado bg-grafite" />)}
        </div>
      ) : erro ? (
        <EmptyState icon={AlertTriangle} title="Não foi possível carregar a equipe" description="Tente de novo em instantes." />
      ) : pessoas.length === 0 ? (
        <EmptyState icon={UserX} title="Nenhum colaborador ativo" description="Quem entrar na equipe aparece aqui." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {pessoas.map((p) => <CartaoDoColaborador key={p.id} p={p} />)}
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, CircleDot, ExternalLink, Lock, Radio, UserX, Video, type LucideIcon } from 'lucide-react';
import { Surface } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { EntityAvatar } from '@/components/ui/entity-avatar';
import { formatClockTime, formatRelativeTime } from '@/lib/format';
import { usePainelDaEquipe, type EventoDaGestao, type PessoaDaGestao, type TarefaDaEquipe } from '@/hooks/use-gestao';
import { situacao, tituloDoEvento } from './cartao-do-colaborador';
import { cn } from '@/lib/utils';

/**
 * SUA EQUIPE AGORA — a gestão da equipe dentro do Hoje de quem administra a
 * operação (22/10/2026, pedido do Pedro para a Tammy). Responde, sem sair do
 * Hoje: quem está trabalhando agora, quem está atrasado e com o quê, o que vence
 * hoje, o que já foi entregue hoje, a agenda de todo mundo e o que acabou de
 * acontecer. Ao vivo: o servidor avisa pelo WebSocket quando o trabalho muda.
 *
 * Só trabalho: conversa privada e conversa com agentes ficam de fora;
 * compromisso particular aparece como "Ocupado".
 */

function useAgora(intervaloMs = 5_000) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setAgora(Date.now()), intervaloMs);
    return () => window.clearInterval(id);
  }, [intervaloMs]);
  return agora;
}

const PONTO_DE_PRESENCA: Record<PessoaDaGestao['presenca'], string> = {
  online: 'bg-sucesso',
  away: 'bg-sinal',
  offline: 'bg-nevoa/40',
};
const ROTULO_DE_PRESENCA: Record<PessoaDaGestao['presenca'], string> = { online: 'online', away: 'ausente', offline: 'offline' };

function AvatarComPresenca({ p, tamanho = 'md' }: { p: Pick<PessoaDaGestao, 'name' | 'avatar_url' | 'presenca'>; tamanho?: 'sm' | 'md' }) {
  return (
    <span className="relative shrink-0">
      <EntityAvatar name={p.name} photoUrl={p.avatar_url} kind="person" size={tamanho} />
      <span
        className={cn('absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-grafite', tamanho === 'sm' ? 'size-2' : 'size-2.5', PONTO_DE_PRESENCA[p.presenca])}
        aria-label={ROTULO_DE_PRESENCA[p.presenca]}
        title={ROTULO_DE_PRESENCA[p.presenca]}
      />
    </span>
  );
}

function Indicador({ icone: Icone, rotulo, valor, detalhe, alerta = false, carregando }: { icone: LucideIcon; rotulo: string; valor: number | string | null; detalhe?: string | undefined; alerta?: boolean; carregando: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border border-grafite-elevado bg-carbono/30 px-3 py-2.5">
      <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-md', alerta ? 'bg-erro/15 text-erro' : 'bg-roxo-eletrico/15 text-roxo-eletrico')}><Icone size={15} /></span>
      <div className="min-w-0">
        <p className="truncate text-[11px] text-nevoa">{rotulo}</p>
        {carregando ? <Skeleton className="mt-1 h-5 w-10" /> : (
          <p className={cn('font-heading text-lg font-semibold leading-tight tabular-nums', alerta && typeof valor === 'number' && valor > 0 ? 'text-erro' : 'text-branco-cru')}>
            {valor ?? '–'}{detalhe && <span className="ml-1 text-[11px] font-normal text-nevoa">{detalhe}</span>}
          </p>
        )}
      </div>
    </div>
  );
}

function LinhaDaPessoa({ p, maiorCarga, agora }: { p: PessoaDaGestao; maiorCarga: number; agora: number }) {
  const s = situacao(p, agora);
  const t = p.tarefas;
  const fazendo = t?.agora[0];
  const proximo = p.agenda.agora ?? p.agenda.proximo;
  const carga = t && maiorCarga > 0 ? Math.round((t.abertas / maiorCarga) * 100) : 0;
  return (
    <Link href={`/gestao/${p.id}`} aria-label={`Abrir ${p.name}`} className="grid grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(3.2rem,auto))_minmax(0,1.6fr)_minmax(0,1.2fr)] items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-grafite-elevado/50">
      <div className="flex min-w-0 items-center gap-2.5">
        <AvatarComPresenca p={p} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-branco-cru">{p.name}</p>
          <p className={cn('flex items-center gap-1 truncate text-[11px]', s.tom === 'reuniao' ? 'text-roxo-eletrico' : p.presenca === 'online' ? 'text-sucesso' : 'text-nevoa')}>
            {s.tom === 'reuniao' ? <Video size={11} /> : <CircleDot size={10} />}
            {p.presenca === 'online' && s.tom !== 'reuniao' ? 'Online agora' : p.presenca === 'away' && s.tom !== 'reuniao' ? 'Ausente (aba de lado)' : s.texto}
          </p>
        </div>
      </div>
      <Numero valor={t?.abertas} />
      <Numero valor={t?.atrasadas} alerta />
      <Numero valor={t?.vencem_hoje} />
      <Numero valor={t?.concluidas_hoje} bom />
      <div className="min-w-0">
        {fazendo ? (
          <>
            <p className="truncate text-xs text-branco-cru" title={fazendo.name}>{fazendo.name}</p>
            <p className={cn('truncate text-[11px]', fazendo.atrasada ? 'text-erro' : 'text-nevoa')}>{fazendo.atrasada ? 'atrasada' : fazendo.status}{fazendo.client ? ` · ${fazendo.client.name}` : ''}</p>
          </>
        ) : <p className="text-[11px] text-nevoa">{t ? 'Nada em andamento' : '–'}</p>}
        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-grafite-elevado" title={`${t?.abertas ?? 0} tarefas abertas`}>
          <div className={cn('h-full rounded-full', carga > 85 ? 'bg-erro/80' : carga > 60 ? 'bg-sinal/80' : 'bg-roxo-eletrico/70')} style={{ width: `${carga}%` }} />
        </div>
      </div>
      <div className="min-w-0 text-[11px]">
        {!p.agenda.conectada ? <span className="text-nevoa">Sem Outlook</span> : proximo ? (
          <>
            <p className={cn('truncate', p.agenda.agora ? 'text-roxo-eletrico' : 'text-branco-cru')}>{p.agenda.agora ? 'agora' : formatClockTime(proximo.start_at)} · {!proximo.visible && <Lock size={10} className="inline" />} {tituloDoEvento(proximo)}</p>
            <p className="text-nevoa">{p.agenda.hoje} hoje</p>
          </>
        ) : <span className="text-nevoa">Agenda livre</span>}
      </div>
    </Link>
  );
}

function Numero({ valor, alerta = false, bom = false }: { valor: number | undefined; alerta?: boolean; bom?: boolean }) {
  return (
    <p className={cn('text-right font-heading text-base font-semibold tabular-nums', valor === undefined ? 'text-nevoa' : alerta && valor > 0 ? 'text-erro' : bom && valor > 0 ? 'text-sucesso' : 'text-branco-cru')}>
      {valor ?? '–'}
    </p>
  );
}

type Aba = 'atrasadas' | 'vencem_hoje' | 'entregues_hoje' | 'sem_responsavel_atrasadas';
const ABAS: Array<[Aba, string]> = [['atrasadas', 'Atrasadas'], ['vencem_hoje', 'Vencem hoje'], ['entregues_hoje', 'Entregues hoje'], ['sem_responsavel_atrasadas', 'Sem responsável']];
const VAZIO_DA_ABA: Record<Aba, string> = {
  atrasadas: 'Nenhuma tarefa atrasada na equipe. 🎉',
  vencem_hoje: 'Nada da equipe vence hoje.',
  entregues_hoje: 'Nenhuma entrega registrada hoje ainda.',
  sem_responsavel_atrasadas: 'Nenhuma tarefa atrasada sem responsável.',
};

function LinhaDeTarefa({ t, pessoas, aba }: { t: TarefaDaEquipe; pessoas: Map<string, PessoaDaGestao>; aba: Aba }) {
  const donos = t.donos.map((id) => pessoas.get(id)).filter((p): p is PessoaDaGestao => Boolean(p));
  const conteudo = (
    <>
      <div className="flex -space-x-1.5">
        {donos.length > 0 ? donos.slice(0, 3).map((p) => <EntityAvatar key={p.id} name={p.name} photoUrl={p.avatar_url} kind="person" size="sm" className="ring-2 ring-grafite" />)
          : <span className="flex size-6 items-center justify-center rounded-full bg-grafite-elevado text-nevoa" title="Sem responsável"><UserX size={12} /></span>}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-branco-cru" title={t.name}>{t.name}</p>
        <p className="truncate text-[11px] text-nevoa">{[donos.map((p) => p.name.split(' ')[0]).join(', ') || null, t.client?.name, t.status].filter(Boolean).join(' · ')}</p>
      </div>
      <span className={cn('shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px]', aba === 'entregues_hoje' ? 'bg-sucesso/15 text-sucesso' : t.atrasada ? 'bg-erro/15 text-erro' : 'bg-sinal/15 text-sinal')}>
        {aba === 'entregues_hoje' ? (t.updated_at ? formatClockTime(new Date(t.updated_at).toISOString()) : 'hoje') : t.atrasada ? `${t.dias_de_atraso}d` : t.due_date ? formatClockTime(new Date(t.due_date).toISOString()) : 'hoje'}
      </span>
      {t.url && <ExternalLink size={12} className="shrink-0 text-nevoa" aria-hidden />}
    </>
  );
  return (
    <motion.li layout initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      {t.url
        ? <a href={t.url} target="_blank" rel="noopener noreferrer" aria-label={`${t.name} no ClickUp`} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-grafite-elevado/50">{conteudo}</a>
        : <div className="flex items-center gap-2.5 px-2 py-1.5">{conteudo}</div>}
    </motion.li>
  );
}

export function EquipeNoHoje() {
  const painel = usePainelDaEquipe();
  const agora = useAgora();
  const [aba, setAba] = useState<Aba>('atrasadas');
  const dados = painel.data;
  const pessoas = useMemo(() => dados?.pessoas ?? [], [dados]);
  const porId = useMemo(() => new Map(pessoas.map((p) => [p.id, p])), [pessoas]);
  const ordenadas = useMemo(
    () => [...pessoas].sort((a, b) => Number(b.presenca === 'online') - Number(a.presenca === 'online') || (b.tarefas?.atrasadas ?? 0) - (a.tarefas?.atrasadas ?? 0) || a.name.localeCompare(b.name, 'pt-BR')),
    [pessoas],
  );
  const listas = dados?.tarefas.disponivel ? dados.tarefas.listas : null;
  const soma = (f: (p: PessoaDaGestao) => number) => pessoas.reduce((s, p) => s + f(p), 0);
  const maiorCarga = Math.max(0, ...pessoas.map((p) => p.tarefas?.abertas ?? 0));
  const agenda = useMemo(() => {
    const todos: Array<EventoDaGestao & { pessoa: PessoaDaGestao }> = [];
    for (const p of pessoas) for (const e of p.agenda.eventos) todos.push({ ...e, pessoa: p });
    return todos.sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  }, [pessoas]);
  const carregando = painel.isPending;
  const semTarefas = painel.isError || (dados !== undefined && !dados.tarefas.disponivel);
  const segundos = painel.dataUpdatedAt ? Math.max(0, Math.round((agora - painel.dataUpdatedAt) / 1000)) : null;

  return (
    <Surface className="flex flex-col gap-3 p-4" aria-label="Sua equipe agora">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h2 className="font-heading text-base font-semibold text-branco-cru">Sua equipe agora</h2>
          <span className="flex items-center gap-1.5 rounded-full bg-sucesso/15 px-2 py-0.5 text-[11px] font-medium text-sucesso" title="Atualiza sozinho quando o trabalho da equipe muda">
            <span className="relative flex size-1.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-sucesso opacity-75" /><span className="relative inline-flex size-1.5 rounded-full bg-sucesso" /></span>
            ao vivo
          </span>
          {segundos !== null && <span className="font-mono text-[11px] text-nevoa">atualizado {segundos < 5 ? 'agora' : segundos < 60 ? `há ${segundos}s` : `há ${Math.round(segundos / 60)} min`}</span>}
        </div>
        <Link href="/gestao" className="flex items-center gap-1 font-mono text-[11px] text-nevoa hover:text-branco-cru">Gestão completa <ArrowRight size={11} /></Link>
      </div>

      {dados && !dados.tarefas.disponivel && (
        <p role="status" className="flex items-center gap-2 rounded-lg border border-sinal/40 bg-sinal/10 px-3 py-2 text-xs text-branco-cru">
          <AlertTriangle size={13} className="text-sinal" /> {dados.tarefas.erro} Presença, agenda e atividade continuam atualizadas.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 @min-[900px]:grid-cols-3 @min-[1500px]:grid-cols-6">
        <Indicador icone={Radio} rotulo="Online agora" valor={carregando ? null : pessoas.filter((p) => p.presenca === 'online').length} detalhe={`de ${pessoas.length}`} carregando={carregando} />
        <Indicador icone={Video} rotulo="Em reunião" valor={pessoas.filter((p) => p.agenda.agora).length} detalhe={`${soma((p) => p.agenda.hoje)} hoje`} carregando={carregando} />
        <Indicador icone={AlertTriangle} rotulo="Tarefas atrasadas" valor={semTarefas ? null : soma((p) => p.tarefas?.atrasadas ?? 0)} detalhe={semTarefas ? undefined : `${pessoas.filter((p) => (p.tarefas?.atrasadas ?? 0) > 0).length} pessoa(s)`} alerta carregando={carregando} />
        <Indicador icone={CalendarClock} rotulo="Vencem hoje" valor={semTarefas ? null : soma((p) => p.tarefas?.vencem_hoje ?? 0)} carregando={carregando} />
        <Indicador icone={CheckCircle2} rotulo="Entregues hoje" valor={semTarefas ? null : soma((p) => p.tarefas?.concluidas_hoje ?? 0)} detalhe={semTarefas ? undefined : `${soma((p) => p.tarefas?.concluidas_7d ?? 0)} na semana`} carregando={carregando} />
        <Indicador icone={UserX} rotulo="Sem responsável" valor={dados?.tarefas.disponivel ? dados.tarefas.sem_responsavel : null} detalhe={dados?.tarefas.disponivel ? `${dados.tarefas.sem_responsavel_atrasadas} atrasadas` : undefined} alerta carregando={carregando} />
      </div>

      <div className="grid items-start gap-3 @min-[1300px]:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        {/* Tabela larga: em tela estreita ela rola DENTRO da caixa, nunca a página inteira. */}
        <div className="min-w-0 overflow-x-auto rounded-lg border border-grafite-elevado">
          <div className="min-w-[780px]">
          <div className="grid grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(3.2rem,auto))_minmax(0,1.6fr)_minmax(0,1.2fr)] gap-3 border-b border-grafite-elevado px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-nevoa">
            <span>Colaborador</span><span className="text-right">Abertas</span><span className="text-right">Atrasadas</span><span className="text-right">Hoje</span><span className="text-right">Entregues</span><span>Fazendo agora · carga</span><span>Agenda</span>
          </div>
          <div className="space-y-0.5 p-2">
            {carregando ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)
              : painel.isError ? <p className="py-6 text-center text-sm text-nevoa">Não consegui carregar a equipe agora.</p>
              : ordenadas.length === 0 ? <p className="py-6 text-center text-sm text-nevoa">Nenhum colaborador ativo.</p>
              : ordenadas.map((p) => <LinhaDaPessoa key={p.id} p={p} maiorCarga={maiorCarga} agora={agora} />)}
          </div>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="rounded-lg border border-grafite-elevado">
            <div role="tablist" aria-label="Tarefas da equipe" className="flex flex-wrap gap-1 border-b border-grafite-elevado p-1.5">
              {ABAS.map(([valor, rotulo]) => {
                const n = listas?.[valor].length ?? 0;
                return (
                  <button key={valor} type="button" role="tab" aria-selected={aba === valor} onClick={() => setAba(valor)} className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors', aba === valor ? 'bg-grafite-elevado text-branco-cru' : 'text-nevoa hover:text-branco-cru')}>
                    {rotulo}{listas && <span className={cn('rounded-full px-1.5 font-mono text-[10px]', valor === 'entregues_hoje' ? 'bg-sucesso/15 text-sucesso' : n > 0 && valor !== 'vencem_hoje' ? 'bg-erro/15 text-erro' : 'bg-grafite-elevado text-nevoa')}>{n >= 25 ? '25+' : n}</span>}
                  </button>
                );
              })}
            </div>
            <ul role="tabpanel" className="max-h-[19rem] space-y-0.5 overflow-y-auto p-1.5">
              {carregando ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="mb-1 h-10 w-full" />)
                : !listas ? <p className="py-6 text-center text-sm text-nevoa">Tarefas do ClickUp indisponíveis agora.</p>
                : listas[aba].length === 0 ? <p className="py-6 text-center text-sm text-nevoa">{VAZIO_DA_ABA[aba]}</p>
                : <AnimatePresence initial={false}>{listas[aba].map((t) => <LinhaDeTarefa key={`${aba}-${t.id}`} t={t} pessoas={porId} aba={aba} />)}</AnimatePresence>}
            </ul>
          </div>

          <div className="grid gap-3 @min-[900px]:grid-cols-2 @min-[1300px]:grid-cols-1 @min-[1800px]:grid-cols-2">
            <div className="rounded-lg border border-grafite-elevado p-3">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-nevoa">Agenda da equipe hoje</p>
              {carregando ? <Skeleton className="h-16 w-full" /> : agenda.length === 0 ? <p className="text-xs text-nevoa">Ninguém da equipe tem compromisso hoje{pessoas.some((p) => !p.agenda.conectada) ? ' (quem não conectou o Outlook não aparece)' : ''}.</p> : (
                <ul className="max-h-[13rem] space-y-1.5 overflow-y-auto">
                  {agenda.map((e) => {
                    const acontecendo = Date.parse(e.start_at) <= agora && Date.parse(e.end_at) > agora;
                    const passou = Date.parse(e.end_at) <= agora;
                    return (
                      <li key={`${e.id}-${e.pessoa.id}`} className={cn('flex items-center gap-2 rounded-md px-1.5 py-1 text-xs', acontecendo && 'bg-roxo-eletrico/10', passou && 'opacity-50')}>
                        <span className="w-10 shrink-0 font-mono text-[11px] text-nevoa">{formatClockTime(e.start_at)}</span>
                        <AvatarComPresenca p={e.pessoa} tamanho="sm" />
                        <span className={cn('min-w-0 flex-1 truncate', e.visible ? 'text-branco-cru' : 'text-nevoa')}>{!e.visible && <Lock size={10} className="mr-1 inline" />}{tituloDoEvento(e)}</span>
                        {acontecendo && <span className="shrink-0 text-[10px] text-roxo-eletrico">agora</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="rounded-lg border border-grafite-elevado p-3">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-nevoa">Acontecendo agora</p>
              {carregando ? <Skeleton className="h-16 w-full" /> : (dados?.feed.length ?? 0) === 0 ? <p className="text-xs text-nevoa">Nenhuma atividade da equipe registrada nos últimos dias.</p> : (
                <ul className="max-h-[13rem] space-y-2 overflow-y-auto">
                  <AnimatePresence initial={false}>
                    {dados!.feed.map((f) => {
                      const p = porId.get(f.user_id);
                      return (
                        <motion.li key={f.id} layout initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25 }} className="flex items-start gap-2 text-xs">
                          {p ? <AvatarComPresenca p={p} tamanho="sm" /> : <EntityAvatar name={f.user_name} kind="person" size="sm" />}
                          <div className="min-w-0">
                            <p className="text-branco-cru"><span className="font-medium">{f.user_name.split(' ')[0]}</span> <span className="text-branco-cru/85">{f.summary ?? f.type}</span></p>
                            <p className="text-[11px] text-nevoa">{[f.client_name, formatRelativeTime(f.at).toLowerCase()].filter(Boolean).join(' · ')}</p>
                          </div>
                        </motion.li>
                      );
                    })}
                  </AnimatePresence>
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </Surface>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ArrowRight, ArrowUpRight, Lock, UserX, Video } from 'lucide-react';
import { Surface } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { EntityAvatar } from '@/components/ui/entity-avatar';
import { formatClockTime, formatRelativeTime } from '@/lib/format';
import { usePainelDaEquipe, type EventoDaGestao, type PessoaDaGestao, type TarefaDaEquipe } from '@/hooks/use-gestao';
import { tituloDoEvento } from './cartao-do-colaborador';
import { cn } from '@/lib/utils';

/**
 * SUA EQUIPE AGORA — a gestão da equipe dentro do Hoje de quem administra a
 * operação (pedido do Pedro para a Tammy, 22/10/2026).
 *
 * Desenho (2ª versão, "menos poluído, mais profissional"): três faixas, cada
 * uma respondendo uma pergunta, nesta ordem.
 *   1. Como está a equipe? — 4 números grandes (atrasadas, vencem hoje,
 *      entregues hoje, online). O resto vira uma linha de contexto embaixo.
 *   2. Como está cada pessoa? — um cartão por colaborador: presença, atrasos
 *      em destaque, o que está fazendo e o próximo compromisso.
 *   3. O que pede ação? — tarefas da equipe (abas) e agenda/atividade (abas).
 * Listas mostram 8 e dizem quantas faltam ("ver todas") — nada some calado.
 *
 * Ao vivo: o servidor avisa pelo WebSocket quando o trabalho muda e a consulta
 * é refeita; 30 s de rede de segurança. Só trabalho: o particular é "Ocupado".
 */

function useAgora(intervaloMs = 5_000) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setAgora(Date.now()), intervaloMs);
    return () => window.clearInterval(id);
  }, [intervaloMs]);
  return agora;
}

const COR_DA_PRESENCA: Record<PessoaDaGestao['presenca'], string> = { online: 'bg-sucesso', away: 'bg-sinal', offline: 'bg-nevoa/40' };
const NOME_DA_PRESENCA: Record<PessoaDaGestao['presenca'], string> = { online: 'online', away: 'ausente', offline: 'offline' };

function Avatar({ p, tamanho = 'md' }: { p: Pick<PessoaDaGestao, 'name' | 'avatar_url' | 'presenca'>; tamanho?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className="relative shrink-0">
      <EntityAvatar name={p.name} photoUrl={p.avatar_url} kind="person" size={tamanho} />
      <span
        className={cn('absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-grafite', tamanho === 'sm' ? 'size-2' : 'size-3', COR_DA_PRESENCA[p.presenca])}
        title={NOME_DA_PRESENCA[p.presenca]}
        aria-label={NOME_DA_PRESENCA[p.presenca]}
      />
    </span>
  );
}

/** Faixa 1: um número grande, o nome dele e uma linha de contexto. */
function Numero({ rotulo, valor, contexto, tom = 'neutro', carregando }: { rotulo: string; valor: number | null; contexto?: string | undefined; tom?: 'neutro' | 'alerta' | 'bom'; carregando: boolean }) {
  const ativo = valor !== null && valor > 0;
  return (
    <div className="flex min-w-0 flex-col gap-1 px-5 py-4">
      <p className="text-[13px] font-medium text-nevoa">{rotulo}</p>
      {carregando ? <Skeleton className="h-9 w-14" /> : (
        <p className={cn('font-heading text-[2.25rem] font-semibold leading-none tabular-nums', !ativo ? 'text-branco-cru' : tom === 'alerta' ? 'text-erro' : tom === 'bom' ? 'text-sucesso' : 'text-branco-cru')}>
          {valor ?? '–'}
        </p>
      )}
      <p className="min-h-[1rem] truncate text-xs text-nevoa">{carregando ? '' : contexto}</p>
    </div>
  );
}

function statusDaPessoa(p: PessoaDaGestao): { texto: string; reuniao: boolean } {
  if (p.agenda.agora) return { texto: `Em ${p.agenda.agora.visible ? 'reunião' : 'compromisso'} até ${formatClockTime(p.agenda.agora.end_at)}`, reuniao: true };
  if (p.presenca === 'online') return { texto: 'Online agora', reuniao: false };
  if (p.presenca === 'away') return { texto: 'Ausente', reuniao: false };
  if (p.last_seen_at) return { texto: `Visto ${formatRelativeTime(p.last_seen_at).toLowerCase()}`, reuniao: false };
  return { texto: 'Ainda não entrou', reuniao: false };
}

/** Faixa 2: o cartão de uma pessoa. `voce`: o cartão da própria administradora (destacado, leva às tarefas dela). */
function CartaoDaPessoa({ p, maiorCarga, voce = false }: { p: PessoaDaGestao; maiorCarga: number; voce?: boolean }) {
  const t = p.tarefas;
  const s = statusDaPessoa(p);
  const fazendo = t?.agora[0];
  const proximo = p.agenda.agora ? null : p.agenda.proximo;
  const carga = t && maiorCarga > 0 ? Math.max(4, Math.round((t.abertas / maiorCarga) * 100)) : 0;
  return (
    <Link
      href={voce ? '/tasks' : `/gestao/${p.id}`}
      aria-label={voce ? 'Abrir minhas tarefas' : `Abrir ${p.name}`}
      className={cn('group flex min-w-0 flex-col rounded-xl border bg-grafite p-4 transition-colors hover:border-roxo-eletrico/40', voce ? 'border-roxo-eletrico/50 ring-1 ring-roxo-eletrico/20' : 'border-grafite-elevado')}
    >
      <div className="flex items-center gap-3">
        <Avatar p={p} tamanho="lg" />
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-2 text-[15px] font-semibold text-branco-cru">
            <span className="truncate">{p.name}</span>
            {voce && <span className="shrink-0 rounded-full bg-roxo-eletrico/15 px-2 py-0.5 text-[11px] font-medium text-roxo-eletrico">Você</span>}
          </p>
          <p className={cn('flex items-center gap-1 truncate text-xs', s.reuniao ? 'text-roxo-eletrico' : p.presenca === 'online' ? 'text-sucesso' : 'text-nevoa')}>
            {s.reuniao && <Video size={12} />}{s.texto}
          </p>
        </div>
        <ArrowUpRight size={16} className="shrink-0 text-nevoa opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <p className={cn('font-heading text-[1.75rem] font-semibold leading-none tabular-nums', (t?.atrasadas ?? 0) > 0 ? 'text-erro' : 'text-branco-cru')}>{t ? t.atrasadas : '–'}</p>
          <p className="mt-1 text-xs text-nevoa">{t?.atrasadas === 1 ? 'atrasada' : 'atrasadas'}</p>
        </div>
        <dl className="flex gap-4 text-right">
          <div><dt className="text-[11px] text-nevoa">abertas</dt><dd className="text-sm font-semibold tabular-nums text-branco-cru">{t?.abertas ?? '–'}</dd></div>
          <div><dt className="text-[11px] text-nevoa">hoje</dt><dd className="text-sm font-semibold tabular-nums text-branco-cru">{t?.vencem_hoje ?? '–'}</dd></div>
          <div><dt className="text-[11px] text-nevoa">entregues</dt><dd className={cn('text-sm font-semibold tabular-nums', (t?.concluidas_hoje ?? 0) > 0 ? 'text-sucesso' : 'text-branco-cru')}>{t?.concluidas_hoje ?? '–'}</dd></div>
        </dl>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-grafite-elevado" title={t ? `Carga: ${t.abertas} tarefas abertas` : undefined}>
        {/* Uma cor só (a carga é comparação, não alarme); vermelho só para quem está perto do maior volume da equipe. */}
        <div className={cn('h-full rounded-full transition-all', carga > 85 ? 'bg-erro/60' : 'bg-roxo-eletrico/50')} style={{ width: `${carga}%` }} />
      </div>

      <div className="mt-4 space-y-1.5 border-t border-grafite-elevado pt-3 text-xs">
        <p className="flex gap-2">
          <span className="w-14 shrink-0 text-nevoa">Agora</span>
          {fazendo
            ? <span className={cn('min-w-0 truncate', fazendo.atrasada ? 'text-erro' : 'text-branco-cru')} title={fazendo.name}>{fazendo.name}</span>
            : <span className="text-nevoa">{t ? 'Nada em andamento' : '–'}</span>}
        </p>
        <p className="flex gap-2">
          <span className="w-14 shrink-0 text-nevoa">Agenda</span>
          {!p.agenda.conectada ? <span className="text-nevoa">Outlook não conectado</span>
            : p.agenda.agora ? <span className="min-w-0 truncate text-roxo-eletrico">{tituloDoEvento(p.agenda.agora)} (agora)</span>
            : proximo ? <span className="min-w-0 truncate text-branco-cru">{formatClockTime(proximo.start_at)} · {!proximo.visible && <Lock size={10} className="mr-0.5 inline" />}{tituloDoEvento(proximo)}</span>
            : <span className="text-nevoa">Livre pelo resto do dia</span>}
        </p>
        {voce && (p.demandas.abertas > 0 || p.aprovacoes_pendentes > 0) && (
          <p className="flex gap-2">
            <span className="w-14 shrink-0 text-nevoa">Também</span>
            <span className="min-w-0 truncate text-branco-cru">
              {[p.demandas.abertas > 0 ? `${p.demandas.abertas} quinzena${p.demandas.abertas > 1 ? 's' : ''}${p.demandas.atrasadas > 0 ? ` (${p.demandas.atrasadas} atrasada${p.demandas.atrasadas > 1 ? 's' : ''})` : ''}` : null,
                p.aprovacoes_pendentes > 0 ? `${p.aprovacoes_pendentes} aprovaç${p.aprovacoes_pendentes > 1 ? 'ões' : 'ão'} esperando você` : null].filter(Boolean).join(' · ')}
            </span>
          </p>
        )}
      </div>
    </Link>
  );
}

function Abas<T extends string>({ abas, atual, aoTrocar, rotulo }: { abas: Array<{ valor: T; rotulo: string; contagem?: number | undefined; destaque?: boolean }>; atual: T; aoTrocar: (v: T) => void; rotulo: string }) {
  return (
    <div role="tablist" aria-label={rotulo} className="flex flex-wrap gap-1">
      {abas.map((a) => (
        <button
          key={a.valor}
          type="button"
          role="tab"
          aria-selected={atual === a.valor}
          onClick={() => aoTrocar(a.valor)}
          className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] transition-colors', atual === a.valor ? 'bg-grafite-elevado font-medium text-branco-cru' : 'text-nevoa hover:text-branco-cru')}
        >
          {a.rotulo}
          {a.contagem !== undefined && <span className={cn('font-mono text-[11px]', a.destaque && a.contagem > 0 ? 'text-erro' : 'text-nevoa')}>{a.contagem >= 25 ? '25+' : a.contagem}</span>}
        </button>
      ))}
    </div>
  );
}

type AbaDeTarefas = 'minhas' | 'atrasadas' | 'vencem_hoje' | 'entregues_hoje' | 'sem_responsavel_atrasadas';
const VAZIO: Record<AbaDeTarefas, string> = {
  minhas: 'Você não tem tarefa aberta no ClickUp.',
  atrasadas: 'Nenhuma tarefa atrasada na equipe.',
  vencem_hoje: 'Nada da equipe vence hoje.',
  entregues_hoje: 'Nenhuma entrega registrada hoje ainda.',
  sem_responsavel_atrasadas: 'Nenhuma tarefa atrasada sem responsável.',
};
const VISIVEIS = 8;

/** Prazo que não atrasou: hora se é hoje, data se é outro dia, "sem prazo" se não tem. */
function prazoCurto(dueMs: number | null): string {
  if (dueMs === null) return 'sem prazo';
  const d = new Date(dueMs);
  const hoje = new Date();
  if (d.toDateString() === hoje.toDateString()) return formatClockTime(d.toISOString());
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(d);
}

function LinhaDeTarefa({ t, pessoas, aba }: { t: TarefaDaEquipe; pessoas: Map<string, PessoaDaGestao>; aba: AbaDeTarefas }) {
  const donos = t.donos.map((id) => pessoas.get(id)).filter((p): p is PessoaDaGestao => Boolean(p));
  const selo = aba === 'entregues_hoje'
    ? { texto: t.updated_at ? formatClockTime(new Date(t.updated_at).toISOString()) : 'hoje', cor: 'text-sucesso' }
    : t.atrasada ? { texto: `${t.dias_de_atraso} ${t.dias_de_atraso === 1 ? 'dia' : 'dias'}`, cor: 'text-erro' }
    : { texto: prazoCurto(t.due_date), cor: 'text-nevoa' };
  const minha = aba === 'minhas';
  const conteudo = (
    <>
      {minha ? <span className={cn('size-2 shrink-0 rounded-full', t.atrasada ? 'bg-erro' : t.em_andamento ? 'bg-roxo-eletrico' : 'bg-nevoa/40')} aria-hidden />
        : donos[0] ? <EntityAvatar name={donos[0].name} photoUrl={donos[0].avatar_url} kind="person" size="sm" /> : <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-grafite-elevado text-nevoa" title="Sem responsável"><UserX size={12} /></span>}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-branco-cru" title={t.name}>{t.name}</p>
        <p className="truncate text-xs text-nevoa">{(minha ? [t.client?.name, t.status] : [donos.map((p) => p.name.split(' ')[0]).join(', ') || 'Sem responsável', t.client?.name]).filter(Boolean).join(' · ')}</p>
      </div>
      <span className={cn('shrink-0 text-xs font-medium tabular-nums', selo.cor)}>{selo.texto}</span>
    </>
  );
  return (
    <motion.li layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      {t.url
        ? <a href={t.url} target="_blank" rel="noopener noreferrer" aria-label={`${t.name} no ClickUp`} className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-grafite-elevado/60">{conteudo}</a>
        : <div className="flex items-center gap-3 px-2 py-2">{conteudo}</div>}
    </motion.li>
  );
}

export function EquipeNoHoje() {
  const painel = usePainelDaEquipe();
  const agora = useAgora();
  // Abre nas tarefas da própria pessoa (pedido da Tammy: ver as coisas dela, não só as da equipe).
  const [abaDeTarefas, setAbaDeTarefas] = useState<AbaDeTarefas>('minhas');
  const [abaDoDia, setAbaDoDia] = useState<'agenda' | 'atividade'>('agenda');
  const [tudo, setTudo] = useState(false);
  const dados = painel.data;
  const pessoas = useMemo(() => dados?.pessoas ?? [], [dados]);
  const eu = dados?.eu ?? null;
  const porId = useMemo(() => new Map([...pessoas, ...(eu ? [eu] : [])].map((p) => [p.id, p])), [pessoas, eu]);
  // Quem precisa de atenção primeiro: mais atrasos; empate, quem está online.
  const ordenadas = useMemo(
    () => [...pessoas].sort((a, b) => (b.tarefas?.atrasadas ?? 0) - (a.tarefas?.atrasadas ?? 0) || Number(b.presenca === 'online') - Number(a.presenca === 'online') || a.name.localeCompare(b.name, 'pt-BR')),
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
  const pessoasComAtraso = pessoas.filter((p) => (p.tarefas?.atrasadas ?? 0) > 0).length;
  const emReuniao = pessoas.filter((p) => p.agenda.agora).length;
  // "Minhas" vem no formato da pessoa; vira o formato das listas da equipe (dono = você, dias de atraso).
  const minhas: TarefaDaEquipe[] = useMemo(() => (eu?.minhas ?? []).map((t) => ({
    ...t, donos: [eu!.id], dias_de_atraso: t.atrasada && t.due_date ? Math.max(1, Math.floor((Date.now() - t.due_date) / 86_400_000)) : 0,
  })), [eu]);
  const listaAtual = abaDeTarefas === 'minhas' ? minhas : listas?.[abaDeTarefas] ?? [];
  const mostradas = tudo ? listaAtual : listaAtual.slice(0, VISIVEIS);

  return (
    <Surface className="overflow-hidden p-0" aria-label="Sua equipe agora">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-1 pt-4">
        <div className="flex items-baseline gap-3">
          <h2 className="font-heading text-lg font-semibold text-branco-cru">Sua equipe agora</h2>
          <span className="flex items-center gap-1.5 text-xs text-nevoa" title="Atualiza sozinho quando o trabalho da equipe muda">
            <span className="relative flex size-1.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-sucesso opacity-60" /><span className="relative inline-flex size-1.5 rounded-full bg-sucesso" /></span>
            ao vivo{segundos !== null && ` · atualizado ${segundos < 5 ? 'agora' : segundos < 60 ? `há ${segundos}s` : `há ${Math.round(segundos / 60)} min`}`}
          </span>
        </div>
        <Link href="/gestao" className="flex items-center gap-1 text-[13px] text-nevoa transition-colors hover:text-branco-cru">Gestão completa <ArrowRight size={13} /></Link>
      </div>

      {dados && !dados.tarefas.disponivel && (
        <p role="status" className="mx-5 mt-2 flex items-center gap-2 rounded-lg bg-sinal/10 px-3 py-2 text-xs text-branco-cru">
          <AlertTriangle size={13} className="shrink-0 text-sinal" /> {dados.tarefas.erro} Presença, agenda e atividade seguem atualizadas.
        </p>
      )}

      {/* Faixa 1 — números da equipe */}
      <div className="mx-5 mt-3 grid grid-cols-2 overflow-hidden rounded-xl border border-grafite-elevado @min-[900px]:grid-cols-4">
        {[
          <Numero key="a" rotulo="Tarefas atrasadas" valor={semTarefas ? null : soma((p) => p.tarefas?.atrasadas ?? 0)} tom="alerta" carregando={carregando}
            contexto={semTarefas ? undefined : pessoasComAtraso === 0 ? 'Equipe em dia' : `${pessoasComAtraso} de ${pessoas.length} pessoas com atraso`} />,
          <Numero key="h" rotulo="Vencem hoje" valor={semTarefas ? null : soma((p) => p.tarefas?.vencem_hoje ?? 0)} carregando={carregando}
            contexto={semTarefas ? undefined : `${soma((p) => p.tarefas?.vencem_na_semana ?? 0)} nesta semana`} />,
          <Numero key="e" rotulo="Entregues hoje" valor={semTarefas ? null : soma((p) => p.tarefas?.concluidas_hoje ?? 0)} tom="bom" carregando={carregando}
            contexto={semTarefas ? undefined : `${soma((p) => p.tarefas?.concluidas_7d ?? 0)} nos últimos 7 dias`} />,
          <Numero key="o" rotulo="Online agora" valor={carregando ? null : pessoas.filter((p) => p.presenca === 'online').length} carregando={carregando}
            contexto={`de ${pessoas.length}${emReuniao > 0 ? ` · ${emReuniao} em reunião` : ''}`} />,
        ].map((numero, i) => (
          // Divisórias: entre colunas e, em 2 colunas, entre as linhas.
          <div key={i} className={cn('border-grafite-elevado', i % 2 === 1 && 'border-l', i < 2 && 'border-b @min-[900px]:border-b-0', i > 0 && '@min-[900px]:border-l')}>{numero}</div>
        ))}
      </div>

      {/* Faixa 2 — cada pessoa */}
      <div className="mt-5 px-5">
        {/* auto-fit: os cartões ocupam a largura toda, seja a equipe de 3 ou de 6 (sem buraco no fim da linha). */}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,17rem),1fr))] gap-3">
          {carregando ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-56 rounded-xl" />)
            : painel.isError ? <p className="col-span-full py-6 text-center text-sm text-nevoa">Não consegui carregar a equipe agora.</p>
            : ordenadas.length === 0 ? <p className="col-span-full py-6 text-center text-sm text-nevoa">Nenhum colaborador ativo.</p>
            : [...(eu ? [<CartaoDaPessoa key="voce" p={eu} maiorCarga={Math.max(maiorCarga, eu.tarefas?.abertas ?? 0)} voce />] : []),
               ...ordenadas.map((p) => <CartaoDaPessoa key={p.id} p={p} maiorCarga={maiorCarga} />)]}
        </div>
      </div>

      {/* Faixa 3 — o que pede ação, e o dia da equipe */}
      <div className="mt-5 grid border-t border-grafite-elevado @min-[1100px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-label="Tarefas da equipe" className="min-w-0 p-5">
          <div className="mb-3 flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-branco-cru">Tarefas</h3>
            <Abas
              rotulo="Tarefas da equipe"
              atual={abaDeTarefas}
              aoTrocar={(v) => { setAbaDeTarefas(v); setTudo(false); }}
              abas={[
                { valor: 'minhas', rotulo: 'Minhas', contagem: eu ? eu.minhas_total : undefined },
                { valor: 'atrasadas', rotulo: 'Equipe atrasada', contagem: listas?.atrasadas.length, destaque: true },
                { valor: 'vencem_hoje', rotulo: 'Vencem hoje', contagem: listas?.vencem_hoje.length },
                { valor: 'entregues_hoje', rotulo: 'Entregues', contagem: listas?.entregues_hoje.length },
                { valor: 'sem_responsavel_atrasadas', rotulo: 'Sem dono', contagem: listas?.sem_responsavel_atrasadas.length, destaque: true },
              ]}
            />
          </div>
          {carregando ? <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-11 w-full" />)}</div>
            : !listas && abaDeTarefas !== 'minhas' ? <p className="py-8 text-center text-sm text-nevoa">Tarefas do ClickUp indisponíveis agora.</p>
            : abaDeTarefas === 'minhas' && !eu?.tarefas ? <p className="py-8 text-center text-sm text-nevoa">Tarefas do ClickUp indisponíveis agora.</p>
            : listaAtual.length === 0 ? <p className="py-8 text-center text-sm text-nevoa">{VAZIO[abaDeTarefas]}</p>
            : (
              <>
                <ul className="-mx-2"><AnimatePresence initial={false}>{mostradas.map((t) => <LinhaDeTarefa key={`${abaDeTarefas}-${t.id}`} t={t} pessoas={porId} aba={abaDeTarefas} />)}</AnimatePresence></ul>
                {listaAtual.length > VISIVEIS && (
                  <button type="button" onClick={() => setTudo((v) => !v)} className="mt-2 text-[13px] text-nevoa transition-colors hover:text-branco-cru">
                    {tudo ? 'Mostrar menos' : `Ver todas as ${listaAtual.length >= 25 ? '25 mais antigas' : listaAtual.length}`}
                  </button>
                )}
                {abaDeTarefas === 'minhas' && eu && eu.minhas_total > eu.minhas.length && (
                  <Link href="/tasks" className="mt-2 block text-[13px] text-nevoa hover:text-branco-cru">Você tem {eu.minhas_total} tarefas abertas — ver todas em Tarefas →</Link>
                )}
              </>
            )}
        </section>

        <section aria-label="O dia da equipe" className="min-w-0 border-t border-grafite-elevado p-5 @min-[1100px]:border-l @min-[1100px]:border-t-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-branco-cru">O dia da equipe</h3>
            <Abas
              rotulo="O dia da equipe"
              atual={abaDoDia}
              aoTrocar={setAbaDoDia}
              abas={[{ valor: 'agenda', rotulo: 'Agenda', contagem: carregando ? undefined : agenda.length }, { valor: 'atividade', rotulo: 'Atividade' }]}
            />
          </div>
          {carregando ? <Skeleton className="h-40 w-full" /> : abaDoDia === 'agenda' ? (
            agenda.length === 0 ? (
              <p className="py-8 text-center text-sm text-nevoa">Ninguém da equipe tem compromisso hoje.{pessoas.some((p) => !p.agenda.conectada) ? ' Quem não conectou o Outlook não aparece.' : ''}</p>
            ) : (
              <ol className="relative ml-2 max-h-[22rem] space-y-1 overflow-y-auto border-l border-grafite-elevado pl-4">
                {agenda.map((e) => {
                  const acontecendo = Date.parse(e.start_at) <= agora && Date.parse(e.end_at) > agora;
                  const passou = Date.parse(e.end_at) <= agora;
                  return (
                    <li key={`${e.id}-${e.pessoa.id}`} className={cn('relative flex items-center gap-3 rounded-lg px-2 py-2', acontecendo && 'bg-roxo-eletrico/10', passou && 'opacity-45')}>
                      <span className={cn('absolute -left-[21px] size-2 rounded-full', acontecendo ? 'bg-roxo-eletrico' : 'bg-grafite-elevado')} aria-hidden />
                      <span className="w-11 shrink-0 text-xs tabular-nums text-nevoa">{formatClockTime(e.start_at)}</span>
                      <div className="min-w-0 flex-1">
                        <p className={cn('truncate text-sm', e.visible ? 'text-branco-cru' : 'text-nevoa')}>{!e.visible && <Lock size={11} className="mr-1 inline" />}{tituloDoEvento(e)}</p>
                        <p className="truncate text-xs text-nevoa">{e.pessoa.name}{acontecendo ? ' · agora' : ''}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )
          ) : (dados?.feed.length ?? 0) === 0 ? (
            <p className="py-8 text-center text-sm text-nevoa">Nenhuma atividade da equipe nos últimos dias.</p>
          ) : (
            <ul className="max-h-[22rem] space-y-1 overflow-y-auto">
              <AnimatePresence initial={false}>
                {dados!.feed.map((f) => {
                  const p = porId.get(f.user_id);
                  return (
                    <motion.li key={f.id} layout initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="flex items-start gap-3 rounded-lg px-2 py-2">
                      {p ? <Avatar p={p} tamanho="sm" /> : <EntityAvatar name={f.user_name} kind="person" size="sm" />}
                      <div className="min-w-0">
                        <p className="text-sm text-branco-cru"><span className="font-medium">{f.user_name.split(' ')[0]}</span> <span className="text-branco-cru/80">{f.summary ?? f.type}</span></p>
                        <p className="text-xs text-nevoa">{[f.client_name, formatRelativeTime(f.at).toLowerCase()].filter(Boolean).join(' · ')}</p>
                      </div>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          )}
        </section>
      </div>
    </Surface>
  );
}

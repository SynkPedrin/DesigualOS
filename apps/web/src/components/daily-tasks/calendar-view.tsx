'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Plus, Video } from 'lucide-react';
import type { WorkMember, WorkTaskWire } from '@/hooks/use-work';
import { PRIORIDADES } from '@/hooks/use-work';
import { useMe } from '@/hooks/use-me';
import { useCalendarEvents } from '@/hooks/use-calendar';
import { useAgendas } from '@/components/calendar/microsoft-calendar-connect';
import { AbasDeAgendas, useAbaDeAgenda } from '@/components/calendar/abas-de-agendas';
import { COR_PADRAO, contarPorAba, eventoDaAba, type CorDaAgenda } from '@/components/calendar/cores-das-agendas';
import type { CalendarEventWire } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';
import { diaEmSaoPaulo } from '@/lib/prazo';
import { LogoDoCliente, nomeLimpo, useClientIndex, useListIndex } from './cliente';
import type { TaskActions } from './list-view';
import { Avatar } from './primitivas';

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const DRAG = 'application/x-work-calendar-task';
/** Dia do calendário (fuso de São Paulo, o mesmo da régua de prazo): a tarefa cai no dia em que vence lá. */
const chave = (d: Date | string) => diaEmSaoPaulo(d);
const POR_CELULA = 3;
/** Aba do Daily que esconde os compromissos e deixa só as tarefas, como o calendário era antes de 03/11/2026. */
const SO_TAREFAS = 'tarefas';
const EXTRAS = [{ id: SO_TAREFAS, rotulo: 'Só tarefas' }];
const FUSO = 'America/Sao_Paulo';
const DIA_INTEIRO_MS = 24 * 60 * 60_000 - 60_000;
const ehDiaInteiro = (e: CalendarEventWire) => new Date(e.end_at).getTime() - new Date(e.start_at).getTime() >= DIA_INTEIRO_MS;
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' });
const tituloDo = (e: CalendarEventWire) => (e.visible ? e.title || '(sem título)' : 'Ocupado');

/** Primeiro dia (domingo) e o dia seguinte ao último da grade de 6 semanas do mês de `mes`. */
export function gradeDoMes(mes: Date): { inicio: Date; fim: Date } {
  const inicio = new Date(mes.getFullYear(), mes.getMonth(), 1);
  inicio.setDate(1 - inicio.getDay());
  const fim = new Date(inicio);
  fim.setDate(inicio.getDate() + 42);
  return { inicio, fim };
}

/**
 * Calendário mensal pelos prazos. Cada dia mostra o que VENCE nele; arrastar um cartão para outro dia reagenda
 * (mantém a hora). Os compromissos das agendas do Outlook de quem está olhando entram junto, na cor de cada agenda,
 * com uma aba por agenda (Desigual, Manada Filmes...) e "Só tarefas" para esconder todos (03/11/2026). O painel do dia fica sempre aberto, começa em HOJE, e no dia de hoje traz também o que está
 * atrasado: é a pergunta que a pessoa faz ao abrir. Sem data fica à parte, nunca some.
 * O mês pode ser controlado de fora (`mes`/`onMes`) para quem busca só a janela visível.
 */
export function CalendarView({ tarefas, actions, membros = [], onCriar, mes, onMes, atrasadas: atrasadasDeFora }: {
  tarefas: WorkTaskWire[]; actions: TaskActions; membros?: WorkMember[]; onCriar?: ((dia: Date, titulo: string) => void) | undefined;
  mes?: Date; onMes?: (mes: Date) => void;
  /** Atrasadas de QUALQUER mês (quem busca só a janela visível passa as suas); sem isso, conta as que vieram em `tarefas`. */
  atrasadas?: WorkTaskWire[] | undefined;
}) {
  const [mesLocal, setMesLocal] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const ref = mes ?? mesLocal;
  const irPara = (d: Date) => { const m = new Date(d.getFullYear(), d.getMonth(), 1); if (onMes) onMes(m); else setMesLocal(m); };
  const [dia, setDia] = useState<Date>(() => new Date());
  const [sobre, setSobre] = useState<string | null>(null);
  const [novo, setNovo] = useState('');
  const porMembro = useMemo(() => new Map(membros.map((m) => [m.id, m])), [membros]);
  const listas = useListIndex();
  const clientes = useClientIndex();
  const hoje = chave(new Date());

  const { data: me } = useMe();
  const { agendas, paraAdicionar, adicionar, adicionando } = useAgendas();
  const [aba, setAba] = useAbaDeAgenda('desigual-os:daily:agenda', agendas, EXTRAS);
  const grade = useMemo(() => gradeDoMes(ref), [ref]);
  const compromissos = useCalendarEvents({ from: grade.inicio, to: grade.fim, memberId: me?.id }, { enabled: Boolean(me?.id) });
  const { eventosPorDia, contagem } = useMemo(() => {
    const ativos = (compromissos.data ?? []).filter((e) => e.status !== 'cancelled');
    const porDia = new Map<string, CalendarEventWire[]>();
    if (aba !== SO_TAREFAS) {
      for (const e of ativos) {
        if (!eventoDaAba(e.calendar_id, aba, agendas)) continue;
        const k = chave(e.start_at);
        porDia.set(k, [...(porDia.get(k) ?? []), e]);
      }
      for (const v of porDia.values()) v.sort((a, b) => Number(ehDiaInteiro(b)) - Number(ehDiaInteiro(a)) || a.start_at.localeCompare(b.start_at));
    }
    return { eventosPorDia: porDia, contagem: contarPorAba(ativos, agendas) };
  }, [compromissos.data, aba, agendas]);
  const agendaDe = useMemo(() => new Map(agendas.map((a) => [a.id, a])), [agendas]);
  // Evento criado aqui (sem agenda de origem) é da agência: mesmo nome e cor da aba onde ele aparece.
  const agendaDo = (e: CalendarEventWire) => (e.calendar_id ? agendaDe.get(e.calendar_id) : agendas.find((a) => a.principal));
  const corDo = (e: CalendarEventWire): CorDaAgenda => agendaDo(e)?.cor ?? COR_PADRAO;

  const { dias, semData, resumo, atrasadas: atrasadasDaJanela } = useMemo(() => {
    const { inicio } = gradeDoMes(ref);
    const grade = Array.from({ length: 42 }, (_, i) => { const d = new Date(inicio); d.setDate(inicio.getDate() + i); return d; });
    const porDia = new Map<string, WorkTaskWire[]>();
    for (const t of tarefas) if (t.dueAt) { const k = chave(t.dueAt); porDia.set(k, [...(porDia.get(k) ?? []), t]); }
    // Abertas primeiro, depois por prioridade (urgente em cima); concluídas no fim do dia.
    const ordem = (a: WorkTaskWire, b: WorkTaskWire) => Number(Boolean(a.completedAt)) - Number(Boolean(b.completedAt)) || (a.priority || 9) - (b.priority || 9);
    for (const v of porDia.values()) v.sort(ordem);
    const prefixo = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}`;
    const doMes = tarefas.filter((t) => t.dueAt && chave(t.dueAt).startsWith(prefixo));
    return {
      dias: grade.map((d) => ({ d, k: chave(d), itens: porDia.get(chave(d)) ?? [] })),
      semData: tarefas.filter((t) => !t.dueAt),
      resumo: { total: doMes.length, abertas: doMes.filter((t) => !t.completedAt).length, feitas: doMes.filter((t) => t.completedAt).length },
      atrasadas: tarefas.filter((t) => !t.completedAt && t.dueAt && chave(t.dueAt) < hoje).sort((a, b) => a.dueAt!.localeCompare(b.dueAt!)),
    };
  }, [ref, tarefas, hoje]);

  // As que acabaram de atrasar primeiro: é o que ainda dá para salvar. Data de outro ano leva o ano.
  const atrasadas = useMemo(() => [...(atrasadasDeFora ?? atrasadasDaJanela)].sort((a, b) => b.dueAt!.localeCompare(a.dueAt!)), [atrasadasDeFora, atrasadasDaJanela]);
  const diaK = chave(dia);
  const doDia = dias.find((x) => x.k === diaK)?.itens ?? tarefas.filter((t) => t.dueAt && chave(t.dueAt) === diaK);
  const compromissosDoDia = eventosPorDia.get(diaK) ?? [];
  const reagendar = (id: string, alvo: Date) => {
    const t = tarefas.find((x) => x.id === id);
    if (!t?.dueAt) return;
    const atual = new Date(t.dueAt);
    if (chave(atual) === chave(alvo)) return;
    const novoDia = new Date(alvo); novoDia.setHours(atual.getHours(), atual.getMinutes(), 0, 0);
    actions.atualizar(t, { dueAt: novoDia.toISOString() });
  };
  const clienteDa = (t: WorkTaskWire) => (t.clientId && clientes.get(t.clientId)) || (listas.get(t.listId) ? nomeLimpo(listas.get(t.listId)!.nome) : null);

  const linhaDoPainel = (t: WorkTaskWire, comData = false) => {
    const resp = t.assigneeIds[0] ? porMembro.get(t.assigneeIds[0]) : undefined;
    const cliente = clienteDa(t);
    return (
      <li key={t.id}>
        <button type="button" onClick={() => actions.abrir(t)} className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-roxo-eletrico/10">
          {t.completedAt ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-sucesso" /> : <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ background: t.status?.color ?? '#6b7280' }} />}
          <span className="min-w-0 flex-1">
            <span className={cn('block text-sm leading-snug', t.completedAt ? 'text-nevoa line-through' : 'text-branco-cru')}>{t.title}</span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-nevoa">
              {cliente && <><LogoDoCliente nome={cliente} className="!size-3.5" /><span className="truncate">{cliente}</span></>}
              {t.status && <span className="shrink-0">· {t.status.name}</span>}
              {comData && t.dueAt && <span className="shrink-0 text-red-400">· {new Date(t.dueAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', ...(chave(t.dueAt).slice(0, 4) !== hoje.slice(0, 4) ? { year: '2-digit' } : {}) })}</span>}
            </span>
          </span>
          {resp && <Avatar nome={resp.name} url={resp.avatarUrl} size={22} />}
        </button>
      </li>
    );
  };

  const ehHojeSelecionado = diaK === hoje;
  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" aria-label="Mês anterior" onClick={() => irPara(new Date(ref.getFullYear(), ref.getMonth() - 1, 1))} className="rounded-md p-1 text-nevoa hover:bg-grafite-elevado hover:text-branco-cru"><ChevronLeft size={16} /></button>
          <h3 className="w-40 text-center font-heading text-base font-semibold text-branco-cru first-letter:uppercase">{ref.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</h3>
          <button type="button" aria-label="Próximo mês" onClick={() => irPara(new Date(ref.getFullYear(), ref.getMonth() + 1, 1))} className="rounded-md p-1 text-nevoa hover:bg-grafite-elevado hover:text-branco-cru"><ChevronRight size={16} /></button>
          <button type="button" onClick={() => { irPara(new Date()); setDia(new Date()); }} className="rounded-md border border-roxo-eletrico/50 px-2.5 py-0.5 text-xs font-medium text-lilas hover:bg-roxo-eletrico/15">Hoje</button>
          <span className="ml-auto flex items-center gap-3 text-xs text-nevoa">
            <span><strong className="text-branco-cru">{resumo.abertas}</strong> abertas</span>
            <span><strong className="text-sucesso">{resumo.feitas}</strong> concluídas</span>
            {atrasadas.length > 0 && <span className="text-red-400"><strong>{atrasadas.length}</strong> atrasadas</span>}
          </span>
        </div>
        <AbasDeAgendas
          agendas={agendas}
          ativa={aba}
          onEscolher={setAba}
          contagem={compromissos.data ? contagem : undefined}
          extras={EXTRAS}
          paraAdicionar={paraAdicionar}
          onAdicionar={adicionar}
          adicionando={adicionando}
        />
        <div role="grid" aria-label="Calendário de prazos" className="grid grid-cols-7 overflow-hidden rounded-xl border border-grafite-elevado text-xs">
          {DIAS.map((d) => <div key={d} role="columnheader" className="border-b border-grafite-elevado bg-grafite px-2 py-1.5 text-[11px] font-medium text-nevoa">{d}</div>)}
          {dias.map(({ d, k, itens }) => {
            const ehHoje = k === hoje;
            const selecionado = k === diaK;
            const foraDoMes = d.getMonth() !== ref.getMonth();
            const abertas = itens.filter((t) => !t.completedAt).length;
            const eventos = eventosPorDia.get(k) ?? [];
            // No Daily a tarefa é o principal: com tarefa no dia, os compromissos deixam pelo menos uma linha para ela.
            const eventosNaCelula = eventos.slice(0, itens.length > 0 ? POR_CELULA - 1 : POR_CELULA);
            const tarefasNaCelula = itens.slice(0, POR_CELULA - eventosNaCelula.length);
            const escondidos = eventos.length + itens.length - eventosNaCelula.length - tarefasNaCelula.length;
            return (
              <div
                key={k}
                role="gridcell"
                aria-selected={selecionado}
                aria-label={`${d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })}: ${itens.length} tarefa(s)${eventos.length ? `, ${eventos.length} compromisso(s)` : ''}`}
                onClick={() => setDia(d)}
                onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG)) { e.preventDefault(); setSobre(k); } }}
                onDragLeave={() => setSobre((v) => (v === k ? null : v))}
                onDrop={(e) => { e.preventDefault(); setSobre(null); const id = e.dataTransfer.getData(DRAG); if (id) reagendar(id, d); }}
                className={cn(
                  'min-h-24 cursor-pointer border-b border-r border-grafite-elevado/60 p-1 transition-colors hover:bg-roxo-eletrico/[0.06]',
                  foraDoMes && 'bg-grafite/40',
                  selecionado && 'bg-roxo-eletrico/10',
                  sobre === k && 'ring-2 ring-inset ring-roxo-eletrico',
                )}
              >
                <p className="mb-1 flex items-center justify-between px-0.5">
                  {abertas > 0 ? <span className="rounded-full bg-grafite-elevado px-1.5 text-[10px] tabular-nums text-branco-cru">{abertas}</span> : <span />}
                  <span className={cn('flex size-6 items-center justify-center rounded-full text-[11px] tabular-nums', ehHoje ? 'bg-roxo-eletrico font-bold text-white' : foraDoMes ? 'text-nevoa/40' : 'text-nevoa', selecionado && !ehHoje && 'ring-1 ring-roxo-eletrico text-branco-cru')}>{d.getDate()}</span>
                </p>
                {eventosNaCelula.map((e) => (
                  <p
                    key={e.id}
                    title={`${ehDiaInteiro(e) ? 'Dia todo' : `${hora(e.start_at)} às ${hora(e.end_at)}`} · ${tituloDo(e)}`}
                    className={cn('mb-0.5 flex items-center gap-1 truncate rounded border px-1.5 py-0.5 text-[11px]', corDo(e).evento)}
                  >
                    {!ehDiaInteiro(e) && <span className="shrink-0 tabular-nums opacity-75">{hora(e.start_at)}</span>}
                    <span className="truncate">{tituloDo(e)}</span>
                  </p>
                ))}
                {tarefasNaCelula.map((t) => {
                  const atrasada = !t.completedAt && k < hoje;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData(DRAG, t.id); e.dataTransfer.effectAllowed = 'move'; }}
                      onClick={(e) => { e.stopPropagation(); actions.abrir(t); }}
                      title={`${t.key} · ${t.title}${t.status ? ` · ${t.status.name}` : ''}`}
                      className={cn(
                        'mb-0.5 flex w-full items-center gap-1 truncate rounded border-l-2 bg-grafite-elevado/70 px-1.5 py-0.5 text-left text-[11px] hover:bg-grafite-elevado',
                        t.completedAt ? 'text-nevoa line-through' : atrasada ? 'text-red-300' : 'text-branco-cru',
                      )}
                      style={{ borderLeftColor: t.completedAt ? 'var(--color-sucesso)' : (t.status?.color ?? '#6b7280') }}
                    >
                      {t.priority > 0 && t.priority < 3 && !t.completedAt && <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: PRIORIDADES[t.priority]!.color }} />}
                      <span className="truncate">{t.title}</span>
                    </button>
                  );
                })}
                {escondidos > 0 && <p className="px-1 text-[10px] font-medium text-lilas">+{escondidos} no dia</p>}
              </div>
            );
          })}
        </div>
        {semData.length > 0 && <p className="text-xs text-nevoa">{semData.length} tarefa(s) sem data de vencimento não aparecem no calendário.</p>}
      </div>

      <aside aria-label="Tarefas do dia" className="flex shrink-0 flex-col gap-3 rounded-xl border border-grafite-elevado bg-grafite p-3 lg:w-80">
        <div>
          <p className={cn('text-[11px] font-semibold uppercase tracking-wide', ehHojeSelecionado ? 'text-sucesso' : 'text-lilas')}>{ehHojeSelecionado ? 'Hoje' : 'Dia selecionado'}</p>
          <h4 className="font-heading text-base font-semibold text-branco-cru first-letter:uppercase">{dia.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</h4>
          <p className="text-xs text-nevoa">{doDia.length === 0 ? 'Nada vence neste dia.' : `${doDia.filter((t) => !t.completedAt).length} aberta(s) · ${doDia.filter((t) => t.completedAt).length} concluída(s)`}</p>
        </div>
        {compromissosDoDia.length > 0 && (
          <section aria-label="Compromissos do dia">
            <p className="mb-1 text-xs font-semibold text-branco-cru">Compromissos · {compromissosDoDia.length}</p>
            <ul className="-mx-1 space-y-0.5">
              {compromissosDoDia.map((e) => (
                <li key={e.id} className="flex items-start gap-2 rounded-md px-2 py-1.5">
                  <span aria-hidden className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', corDo(e).ponto)} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm leading-snug text-branco-cru">{tituloDo(e)}</span>
                    <span className="mt-0.5 block text-[11px] text-nevoa">
                      {ehDiaInteiro(e) ? 'Dia todo' : `${hora(e.start_at)} às ${hora(e.end_at)}`}
                      {agendaDo(e) && ` · ${agendaDo(e)!.nome}`}
                      {e.visible && e.location && ` · ${e.location}`}
                    </span>
                  </span>
                  {e.visible && e.meeting_url && (
                    <a href={e.meeting_url} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 rounded-md border border-grafite-elevado px-2 py-1 text-[11px] text-branco-cru hover:border-roxo-eletrico/60">
                      <Video size={12} /> Entrar
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {doDia.length > 0 && (
          <section aria-label="Tarefas que vencem no dia">
            {compromissosDoDia.length > 0 && <p className="mb-1 text-xs font-semibold text-branco-cru">Tarefas · {doDia.length}</p>}
            <ul className="-mx-1 space-y-0.5">{doDia.map((t) => linhaDoPainel(t))}</ul>
          </section>
        )}
        {onCriar && (
          <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); if (novo.trim()) { onCriar(dia, novo.trim()); setNovo(''); } }}>
            <input value={novo} onChange={(e) => setNovo(e.target.value)} placeholder="Nova tarefa para este dia" aria-label="Nova tarefa para este dia" className="min-w-0 flex-1 rounded-md border border-grafite-elevado bg-carbono px-2 py-1.5 text-xs text-branco-cru outline-none focus:border-roxo-eletrico/60" />
            <button type="submit" aria-label="Criar tarefa no dia" disabled={!novo.trim()} className="rounded-md bg-roxo-eletrico px-2 text-white disabled:opacity-40"><Plus size={14} /></button>
          </form>
        )}
        {ehHojeSelecionado && atrasadas.length > 0 && (
          <section aria-label="Atrasadas" className="border-t border-grafite-elevado pt-2">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-red-400"><AlertTriangle size={13} /> Atrasadas · {atrasadas.length}</p>
            <ul className="-mx-1 max-h-72 space-y-0.5 overflow-y-auto">{atrasadas.map((t) => linhaDoPainel(t, true))}</ul>
          </section>
        )}
      </aside>
    </div>
  );
}

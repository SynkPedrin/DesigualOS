import { tarefaConcluida, tarefaEmAndamento } from '@desigual-os/types';
import type { OperationTask } from '@desigual-os/tool-gateway';

/**
 * TAREFAS DA EQUIPE POR PESSOA — a conta que o painel da gestão mostra.
 * Função pura (testada sozinha): recebe as tarefas cruas do ClickUp e as
 * pessoas, devolve o que é de cada uma.
 *
 * Quem é dono de uma tarefa: o e-mail do responsável no ClickUp bate com o
 * e-mail da pessoa no sistema ou com o e-mail de ClickUp que ela vinculou
 * (`users.clickup_email`). Tarefa com dois responsáveis conta para os dois.
 *
 * "Atrasada": tem prazo, o prazo já passou e não está concluída — a MESMA regra
 * da tela de Tarefas (`tarefaConcluida`, em @desigual-os/types). "Hoje" e
 * "semana" são no horário de Brasília, que é onde a equipe trabalha.
 */

export interface PessoaDaEquipe {
  id: string;
  emails: string[];
}

export interface TarefaResumida {
  id: string;
  name: string;
  status: string | null;
  url: string | null;
  due_date: number | null;
  updated_at: number | null;
  list_name: string | null;
  client: { id: string; name: string } | null;
  atrasada: boolean;
  em_andamento: boolean;
}

export interface TarefasDaPessoa {
  abertas: number;
  atrasadas: number;
  vencem_hoje: number;
  vencem_na_semana: number;
  em_andamento: number;
  sem_prazo: number;
  concluidas_7d: number;
  /** Até 3: em andamento primeiro, depois as atrasadas mais antigas. É o "o que está fazendo". */
  agora: TarefaResumida[];
  /** Todas as abertas (a tela do colaborador lista; o resumo da equipe não manda). */
  lista: TarefaResumida[];
}

const FUSO = 'America/Sao_Paulo';

/** Início do dia (00:00 em Brasília) que contém `agora`, em ms. */
export function inicioDoDia(agora: number): number {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(agora));
  // Brasília não tem horário de verão desde 2019: −03:00 fixo.
  return new Date(`${partes}T00:00:00-03:00`).getTime();
}

const DIA = 24 * 60 * 60_000;

export function vazio(): TarefasDaPessoa {
  return { abertas: 0, atrasadas: 0, vencem_hoje: 0, vencem_na_semana: 0, em_andamento: 0, sem_prazo: 0, concluidas_7d: 0, agora: [], lista: [] };
}

export function tarefasPorPessoa(
  tarefas: OperationTask[],
  pessoas: PessoaDaEquipe[],
  clienteDaLista: (listId: string | null) => { id: string; name: string } | null,
  agora = Date.now(),
): { porPessoa: Map<string, TarefasDaPessoa>; semResponsavel: number; semResponsavelAtrasadas: number } {
  const hoje = inicioDoDia(agora);
  const amanha = hoje + DIA;
  const fimDaSemana = hoje + 7 * DIA;
  const donoPorEmail = new Map<string, string>();
  for (const p of pessoas) for (const e of p.emails) if (e) donoPorEmail.set(e.trim().toLowerCase(), p.id);

  const porPessoa = new Map<string, TarefasDaPessoa>(pessoas.map((p) => [p.id, vazio()]));
  let semResponsavel = 0;
  let semResponsavelAtrasadas = 0;

  for (const t of tarefas) {
    const forma = { status: t.status, status_type: t.statusType };
    const concluida = tarefaConcluida(forma);
    const atrasada = !concluida && t.dueDate !== null && t.dueDate < agora;
    const emails = t.assigneeEmails ?? [];
    const donos = [...new Set(emails.map((e) => donoPorEmail.get(e)).filter((id): id is string => Boolean(id)))];
    if (emails.length === 0 && !concluida) {
      semResponsavel++;
      if (atrasada) semResponsavelAtrasadas++;
    }
    for (const dono of donos) {
      const r = porPessoa.get(dono)!;
      if (concluida) {
        if (t.updatedAt !== null && t.updatedAt >= agora - 7 * DIA) r.concluidas_7d++;
        continue;
      }
      const andamento = tarefaEmAndamento(forma);
      r.abertas++;
      if (atrasada) r.atrasadas++;
      if (andamento) r.em_andamento++;
      if (t.dueDate === null) r.sem_prazo++;
      else if (t.dueDate >= hoje && t.dueDate < amanha) r.vencem_hoje++;
      if (t.dueDate !== null && t.dueDate >= hoje && t.dueDate < fimDaSemana) r.vencem_na_semana++;
      r.lista.push({
        id: t.id, name: t.name, status: t.status, url: t.url, due_date: t.dueDate, updated_at: t.updatedAt,
        list_name: t.listName, client: clienteDaLista(t.listId), atrasada, em_andamento: andamento,
      });
    }
  }

  for (const r of porPessoa.values()) {
    // Ordem da lista: atrasadas (mais antigas primeiro), depois por prazo, sem prazo por último.
    r.lista.sort((a, b) => Number(b.atrasada) - Number(a.atrasada) || (a.due_date ?? Infinity) - (b.due_date ?? Infinity));
    const emAndamento = r.lista.filter((x) => x.em_andamento).sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0));
    const atrasadas = r.lista.filter((x) => x.atrasada && !x.em_andamento);
    r.agora = [...emAndamento, ...atrasadas].slice(0, 3);
  }
  return { porPessoa, semResponsavel, semResponsavelAtrasadas };
}

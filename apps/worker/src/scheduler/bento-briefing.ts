/**
 * bento-briefing.ts — o briefing da manhã passa a falar das TAREFAS.
 * Bento 3.1, P0, 14/10/2026.
 *
 * O `morning-briefing` (daily-digest.ts) só olhava a tabela `executions`:
 * "pendências de ontem" eram rodadas de agente que falharam, não trabalho de
 * ninguém. Isto acrescenta o que a pessoa precisa às 8h, lido do ClickUp:
 *
 *   colaborador: minhas atrasadas, o que vence hoje, o que vem nos 3 dias.
 *   gestão (admin/owner da empresa): atrasadas por pessoa, sem dono, clientes
 *     com mais atraso, carga da semana por pessoa — a direção recebe a mesma
 *     visão; não existe papel de "diretor" separado no cadastro hoje.
 *
 * Números saem da contagem das tarefas lidas, nunca de estimativa. Mesmas
 * flags da varredura (bento-varredura.ts): em `shadow` monta e só registra no
 * log; o aviso sai com `on` + notificações + empresa liberada. Um briefing por
 * pessoa por dia, garantido pelo índice único de notifications.
 */
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { escopoOperacional } from '@desigual-os/context-engine';
import { queryOperationTasks, resolveClickUpCredentials } from '@desigual-os/tool-gateway';
import type { Logger } from '@desigual-os/logging';
import { avisoLiberado, janelaDeRisco, lerConfigDaProatividade, type ConfigDaProatividade } from './bento-varredura.js';

export interface TarefaDoBriefing {
  id: string;
  name: string;
  statusType: string | null;
  priority: string | null;
  dueDate: number | null;
  assignees: string[];
  assigneeEmails?: string[];
  listId: string | null;
}

export interface MembroDoBriefing {
  userId: string;
  nome: string;
  email: string | null;
  gestor: boolean;
}

const MAX_LINHAS = 5;
const DIA_MS = 86_400_000;

function fmtData(ms: number): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(ms);
}

/** Puro: o texto do briefing de UMA pessoa. `null` = nada a dizer, nenhum aviso. */
export function montarBriefing(
  membro: MembroDoBriefing,
  tarefas: TarefaDoBriefing[],
  clientePorLista: Map<string, string>,
  agora: Date,
): { title: string; body: string } | null {
  const janela = janelaDeRisco(agora);
  const abertas = tarefas.filter((t) => t.statusType !== 'done' && t.statusType !== 'closed');
  const cliente = (t: TarefaDoBriefing) => (t.listId ? clientePorLista.get(t.listId) : undefined);
  const rotulo = (t: TarefaDoBriefing) => `${t.name}${cliente(t) ? ` (${cliente(t)})` : ''}${t.priority === 'urgent' || t.priority === 'high' ? ' ⚠️' : ''}`;
  const blocos: string[] = [];

  const minhas = membro.email ? abertas.filter((t) => (t.assigneeEmails ?? []).includes(membro.email!)) : [];
  const atrasadas = minhas.filter((t) => t.dueDate !== null && t.dueDate < janela.startOfToday);
  const hoje = minhas.filter((t) => t.dueDate !== null && t.dueDate >= janela.startOfToday && t.dueDate < janela.startOfTomorrow);
  const proximas = minhas.filter((t) => t.dueDate !== null && t.dueDate >= janela.startOfTomorrow && t.dueDate <= janela.endOfDay3);
  const lista = (ts: TarefaDoBriefing[], comData: boolean) =>
    ts
      .sort((a, b) => (a.dueDate ?? 0) - (b.dueDate ?? 0))
      .slice(0, MAX_LINHAS)
      .map((t) => `  • ${rotulo(t)}${comData && t.dueDate ? ` — ${fmtData(t.dueDate)}` : ''}`)
      .join('\n') + (ts.length > MAX_LINHAS ? `\n  e mais ${ts.length - MAX_LINHAS}.` : '');
  if (atrasadas.length) blocos.push(`Suas atrasadas (${atrasadas.length}):\n${lista(atrasadas, true)}`);
  if (hoje.length) blocos.push(`Vencem hoje (${hoje.length}):\n${lista(hoje, false)}`);
  if (proximas.length) blocos.push(`Próximos dias (${proximas.length}):\n${lista(proximas, true)}`);

  if (membro.gestor) {
    const atrasadasEquipe = abertas.filter((t) => t.dueDate !== null && t.dueDate < janela.startOfToday);
    const semDono = abertas.filter((t) => t.assignees.length === 0);
    const porPessoa = new Map<string, number>();
    for (const t of atrasadasEquipe) for (const a of t.assignees) porPessoa.set(a, (porPessoa.get(a) ?? 0) + 1);
    const porCliente = new Map<string, number>();
    for (const t of atrasadasEquipe) {
      const c = cliente(t);
      if (c) porCliente.set(c, (porCliente.get(c) ?? 0) + 1);
    }
    const fimDaSemana = janela.startOfToday + 7 * DIA_MS;
    const carga = new Map<string, number>();
    for (const t of abertas.filter((x) => x.dueDate !== null && x.dueDate >= janela.startOfToday && x.dueDate < fimDaSemana)) {
      for (const a of t.assignees) carga.set(a, (carga.get(a) ?? 0) + 1);
    }
    const top = (m: Map<string, number>) =>
      [...m.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_LINHAS)
        .map(([k, v]) => `${k} ${v}`)
        .join(' · ');
    const linhas = [`Atrasadas na equipe: ${atrasadasEquipe.length}${porPessoa.size ? ` (${top(porPessoa)})` : ''}`];
    if (porCliente.size) linhas.push(`Clientes com mais atraso: ${top(porCliente)}`);
    linhas.push(`Sem responsável: ${semDono.length}`);
    if (carga.size) linhas.push(`Vencendo nos próximos 7 dias, por pessoa: ${top(carga)}`);
    if (atrasadasEquipe.length || semDono.length || carga.size) blocos.push(`Equipe:\n  ${linhas.join('\n  ')}`);
  }

  if (blocos.length === 0) return null;
  const title = atrasadas.length
    ? `Bom dia: ${atrasadas.length} atrasada(s) sua(s) e ${hoje.length} para hoje`
    : hoje.length
      ? `Bom dia: ${hoje.length} entrega(s) sua(s) hoje`
      : proximas.length
        ? `Bom dia: ${proximas.length} entrega(s) sua(s) nos próximos dias`
        : 'Bom dia: o resumo da equipe';
  return { title, body: blocos.join('\n\n') };
}

interface DepsDoBriefing {
  agora?: Date;
  config?: ConfigDaProatividade;
  lerTarefas?: (organizationId: string, listIds: string[]) => Promise<TarefaDoBriefing[]>;
}

async function lerTarefas(organizationId: string, listIds: string[]): Promise<TarefaDoBriefing[]> {
  const daEmpresa = await resolveClickUpCredentials(organizationId).catch(() => null);
  const cfg = daEmpresa ?? (process.env.CLICKUP_API_KEY && process.env.CLICKUP_TEAM_ID ? { apiKey: process.env.CLICKUP_API_KEY, teamId: process.env.CLICKUP_TEAM_ID } : null);
  if (!cfg) return [];
  return (await queryOperationTasks(cfg, { listIds, includeClosed: false })).tasks;
}

export interface RelatorioDoBriefing {
  organizationId: string;
  pessoas: number;
  montados: number;
  enviados: number;
  pulado?: string;
}

export async function briefingOperacional(logger: Logger, deps: DepsDoBriefing = {}): Promise<RelatorioDoBriefing[]> {
  const config = deps.config ?? lerConfigDaProatividade();
  if (config.monitoramento === 'off') return [];
  const agora = deps.agora ?? new Date();
  const dia = new Date(janelaDeRisco(agora).startOfToday).toISOString().slice(0, 10);
  const empresas = await db
    .selectDistinct({ id: schema.clients.organizationId })
    .from(schema.clients)
    .where(and(isNotNull(schema.clients.organizationId), isNull(schema.clients.deletedAt), isNotNull(schema.clients.clickupListId)));

  const relatorios: RelatorioDoBriefing[] = [];
  for (const { id: organizationId } of empresas) {
    if (!organizationId) continue;
    const rel: RelatorioDoBriefing = { organizationId, pessoas: 0, montados: 0, enviados: 0 };
    try {
      const clientes = escopoOperacional(
        await db
          .select({ name: schema.clients.name, listId: schema.clients.clickupListId })
          .from(schema.clients)
          .where(and(eq(schema.clients.organizationId, organizationId), isNull(schema.clients.deletedAt), isNotNull(schema.clients.clickupListId))),
      );
      const clientePorLista = new Map(clientes.map((c) => [c.listId!, c.name]));
      const tarefas = await (deps.lerTarefas ?? lerTarefas)(organizationId, [...clientePorLista.keys()]);
      const membros = await db
        .select({ userId: schema.users.id, nome: schema.users.name, email: schema.users.clickupEmail, role: schema.organizationMembers.role })
        .from(schema.organizationMembers)
        .innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
        .where(and(eq(schema.organizationMembers.organizationId, organizationId), eq(schema.users.active, true), isNull(schema.users.deletedAt)));
      rel.pessoas = membros.length;
      const enviar = avisoLiberado(config, organizationId);
      for (const m of membros) {
        const b = montarBriefing(
          { userId: m.userId, nome: m.nome, email: m.email?.trim().toLowerCase() ?? null, gestor: m.role === 'owner' || m.role === 'admin' },
          tarefas,
          clientePorLista,
          agora,
        );
        if (!b) continue;
        rel.montados += 1;
        if (!enviar) continue;
        const r = await db
          .insert(schema.notifications)
          .values({ userId: m.userId, organizationId, type: 'bento_briefing', title: b.title, body: b.body, link: '/today', dedupeKey: `bento-briefing:${dia}` })
          .onConflictDoNothing()
          .returning({ id: schema.notifications.id });
        rel.enviados += r.length;
      }
    } catch (error) {
      rel.pulado = String((error as Error)?.message ?? error).slice(0, 200);
    }
    relatorios.push(rel);
  }
  logger.info({ relatorios, modo: config.monitoramento }, '[bento-briefing] briefing operacional da manhã');
  return relatorios;
}

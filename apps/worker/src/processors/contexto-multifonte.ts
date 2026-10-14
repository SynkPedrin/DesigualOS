/**
 * contexto-multifonte.ts — o resto do Desigual OS sobre o cliente do turno.
 * Bento 3.1, P2, 14/10/2026.
 *
 * O Bento enxergava o ClickUp (bloco operacional da API) e o dossiê/brain/
 * vault (memories). O OS guarda mais coisa por cliente: aprovações, demandas,
 * agenda, conversas do Inbox e contas de mídia vinculadas. Isto lê essas
 * tabelas — que já existem; nada é copiado nem sincronizado — e entrega um
 * bloco curto em que cada linha diz a FONTE, quando foi ATUALIZADA e, quando
 * não há nada, que não há registro (o que é diferente de não haver trabalho).
 *
 * STATE x EVENT x KNOWLEDGE: aqui só entra ESTADO atual do próprio OS. Evento
 * (operational_events) e conhecimento (memories) têm os seus blocos.
 *
 * Medido em produção em 14/10/2026 (contagem, somente leitura): aprovações,
 * demandas e Inbox estavam vazias, a agenda sincronizava uma conta sem nenhum
 * evento, e só um cliente tinha conta de mídia vinculada. O bloco existe para
 * dizer isso com honestidade agora e para crescer sozinho quando houver dado.
 *
 * Atrás de BENTO_MULTISOURCE_CONTEXT (padrão desligado). Escopo: o cliente da
 * execução, que a API só aceita se a pessoa tiver acesso a ele.
 */
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';

export function multifonteLigada(env: NodeJS.ProcessEnv = process.env): boolean {
  return ['true', '1', 'on'].includes((env.BENTO_MULTISOURCE_CONTEXT ?? '').trim().toLowerCase());
}

export interface FotoMultifonte {
  aprovacoesPendentes: Array<{ tipo: string; desde: Date }>;
  demandasAbertas: Array<{ titulo: string; status: string; prazo: Date | null; atualizadaEm: Date }>;
  proximasReunioes: Array<{ titulo: string; inicio: Date }>;
  agendaConectada: boolean;
  agendaSincronizadaEm: Date | null;
  conversasAbertas: number;
  aguardandoResposta: number;
  ultimaMensagemEm: Date | null;
  contasDeMidia: { meta: number; google: number };
}

const fmt = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d);
const fmtDia = (d: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(d);
const HORA = 3_600_000;
const STATUS_DA_DEMANDA: Record<string, string> = { new: 'nova', briefing: 'em briefing', in_production: 'em produção' };

/** Puro: o bloco do prompt. Toda fonte aparece — com dado, ou dizendo que não há. */
export function multifonteEmTexto(nomeDoCliente: string, f: FotoMultifonte, agora: Date): string {
  return [
    `OUTRAS FONTES DO DESIGUAL OS SOBRE ${nomeDoCliente.toUpperCase()} (estado atual, cada linha com a fonte):`,
    ...linhasDasFontes(f, agora),
    '"Nenhum registrado" quer dizer que o OS não tem o registro, NÃO que não existe trabalho — diga assim.',
    'Se uma tarefa atrasada e uma aprovação ou demanda pendente forem do mesmo assunto, você pode apontar a POSSÍVEL relação, dizendo que é hipótese e mostrando os dois dados. Causa só se estiver escrita.',
  ].join('\n');
}

/**
 * Puro: as mesmas fontes, para PESSOA ler (o panorama determinístico do
 * "como está o cliente X?" responde sem modelo, então o texto vai direto).
 * Com atrasada no ClickUp e aprovação/demanda parada do mesmo cliente, diz a
 * possível relação — como hipótese, com os dois dados, nunca como causa.
 */
export function multifonteEmResposta(nomeDoCliente: string, f: FotoMultifonte, agora: Date, atrasadasNoClickUp: number): string {
  const linhas = linhasDasFontes(f, agora);
  const paradas = f.aprovacoesPendentes.length + f.demandasAbertas.filter((d) => d.prazo && d.prazo.getTime() < agora.getTime()).length;
  if (atrasadasNoClickUp > 0 && paradas > 0) {
    linhas.push(
      `- Possível relação (hipótese, não há registro ligando uma coisa à outra): ${atrasadasNoClickUp} tarefa(s) atrasada(s) no ClickUp e ${paradas} item(ns) parado(s) no OS para ${nomeDoCliente}. Vale conferir se a tarefa está esperando essa aprovação ou demanda.`,
    );
  }
  return [`Outras fontes do OS sobre ${nomeDoCliente}:`, ...linhas].join('\n');
}

function linhasDasFontes(f: FotoMultifonte, agora: Date): string[] {
  const linhas: string[] = [];

  if (f.aprovacoesPendentes.length) {
    const velhas = f.aprovacoesPendentes.filter((a) => agora.getTime() - a.desde.getTime() > 48 * HORA).length;
    const tipos = [...new Set(f.aprovacoesPendentes.map((a) => a.tipo))].join(', ');
    const maisAntiga = f.aprovacoesPendentes.reduce((m, a) => (a.desde < m ? a.desde : m), f.aprovacoesPendentes[0]!.desde);
    linhas.push(
      `- Aprovações (Desigual OS): ${f.aprovacoesPendentes.length} pendente(s) (${tipos}), a mais antiga desde ${fmt(maisAntiga)}${velhas ? `; ${velhas} há mais de 48h` : ''}.`,
    );
  } else linhas.push('- Aprovações (Desigual OS): nenhuma pendente registrada.');

  if (f.demandasAbertas.length) {
    const atrasadas = f.demandasAbertas.filter((d) => d.prazo && d.prazo.getTime() < agora.getTime());
    const itens = f.demandasAbertas
      .slice(0, 4)
      .map((d) => `${d.titulo} (${STATUS_DA_DEMANDA[d.status] ?? d.status}${d.prazo ? `, prazo ${fmtDia(d.prazo)}` : ''})`)
      .join('; ');
    const ultima = f.demandasAbertas.reduce((m, d) => (d.atualizadaEm > m ? d.atualizadaEm : m), f.demandasAbertas[0]!.atualizadaEm);
    linhas.push(
      `- Demandas (Desigual OS, atualizado ${fmt(ultima)}): ${f.demandasAbertas.length} aberta(s)${atrasadas.length ? `, ${atrasadas.length} com prazo vencido` : ''}: ${itens}.`,
    );
  } else linhas.push('- Demandas (Desigual OS): nenhuma aberta registrada.');

  if (!f.agendaConectada) linhas.push('- Agenda: nenhuma agenda da empresa conectada — não dá para afirmar reunião nenhuma.');
  else if (f.proximasReunioes.length) {
    linhas.push(
      `- Agenda (sincronizada ${f.agendaSincronizadaEm ? fmt(f.agendaSincronizadaEm) : 'sem data'}): ${f.proximasReunioes
        .slice(0, 3)
        .map((r) => `${r.titulo} em ${fmt(r.inicio)}`)
        .join('; ')}.`,
    );
  } else linhas.push(`- Agenda (sincronizada ${f.agendaSincronizadaEm ? fmt(f.agendaSincronizadaEm) : 'sem data'}): nenhuma reunião com este cliente nos próximos 14 dias.`);

  if (f.conversasAbertas) {
    linhas.push(
      `- Inbox (Desigual OS${f.ultimaMensagemEm ? `, última mensagem ${fmt(f.ultimaMensagemEm)}` : ''}): ${f.conversasAbertas} conversa(s) aberta(s)${f.aguardandoResposta ? `, ${f.aguardandoResposta} com a última mensagem do cliente sem resposta há mais de 24h` : ''}.`,
    );
  } else linhas.push('- Inbox (Desigual OS): nenhuma conversa aberta registrada.');

  const midia = [f.contasDeMidia.meta ? `Meta (${f.contasDeMidia.meta})` : null, f.contasDeMidia.google ? `Google Ads (${f.contasDeMidia.google})` : null].filter(Boolean);
  linhas.push(
    midia.length
      ? `- Mídia: conta vinculada em ${midia.join(' e ')}. Números de campanha são do Jarbas; aqui você só sabe que a conta existe.`
      : '- Mídia: nenhuma conta de anúncio vinculada a este cliente no OS.',
  );

  return linhas;
}

export async function lerFotoMultifonte(clientId: string, organizationId: string, agora: Date = new Date()): Promise<FotoMultifonte> {
  const em14dias = new Date(agora.getTime() + 14 * 24 * HORA);
  const [aprovacoes, demandas, reunioes, agendas, conversas, meta, google] = await Promise.all([
    db
      .select({ tipo: schema.approvalRequests.resourceType, desde: schema.approvalRequests.createdAt })
      .from(schema.approvalRequests)
      .where(and(eq(schema.approvalRequests.clientId, clientId), eq(schema.approvalRequests.organizationId, organizationId), eq(schema.approvalRequests.status, 'pending')))
      .orderBy(asc(schema.approvalRequests.createdAt))
      .limit(20),
    db
      .select({ titulo: schema.demands.title, status: schema.demands.status, prazo: schema.demands.dueDate, atualizadaEm: schema.demands.updatedAt })
      .from(schema.demands)
      .where(and(eq(schema.demands.clientId, clientId), eq(schema.demands.organizationId, organizationId), inArray(schema.demands.status, ['new', 'briefing', 'in_production'])))
      .orderBy(asc(schema.demands.dueDate))
      .limit(20),
    db
      .select({ titulo: schema.calendarEvents.title, inicio: schema.calendarEvents.startAt })
      .from(schema.calendarEvents)
      .where(
        and(
          eq(schema.calendarEvents.clientId, clientId),
          eq(schema.calendarEvents.organizationId, organizationId),
          gte(schema.calendarEvents.startAt, agora),
          lte(schema.calendarEvents.startAt, em14dias),
          sql`${schema.calendarEvents.status} <> 'cancelled'`,
        ),
      )
      .orderBy(asc(schema.calendarEvents.startAt))
      .limit(5),
    db
      .select({ sincronizada: sql<Date | null>`max(${schema.memberCalendarAccounts.lastSyncedAt})`, n: sql<number>`count(*)::int` })
      .from(schema.memberCalendarAccounts)
      .where(eq(schema.memberCalendarAccounts.organizationId, organizationId)),
    db.execute(sql`
      select count(*)::int as abertas,
             count(*) filter (where ultima.direction = 'inbound' and ultima.created_at < now() - interval '24 hours')::int as aguardando,
             max(t.last_message_at) as ultima_em
      from conversation_threads t
      left join lateral (
        select direction, created_at from thread_messages m where m.thread_id = t.id order by m.created_at desc limit 1
      ) ultima on true
      where t.client_id = ${clientId}::uuid and t.organization_id = ${organizationId}::uuid and t.status = 'open'`),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.clientMetaAccounts).where(eq(schema.clientMetaAccounts.clientId, clientId)),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.clientGoogleAdsAccounts).where(eq(schema.clientGoogleAdsAccounts.clientId, clientId)),
  ]);
  const conversa = ((conversas as unknown as Array<{ abertas: number; aguardando: number; ultima_em: string | Date | null }>)[0]) ?? { abertas: 0, aguardando: 0, ultima_em: null };
  const agenda = agendas[0];
  const sincronizada = agenda?.sincronizada ? new Date(agenda.sincronizada) : null;
  return {
    aprovacoesPendentes: aprovacoes.map((a) => ({ tipo: a.tipo, desde: a.desde })),
    demandasAbertas: demandas.map((d) => ({ titulo: d.titulo, status: d.status, prazo: d.prazo ?? null, atualizadaEm: d.atualizadaEm })),
    proximasReunioes: reunioes.map((r) => ({ titulo: r.titulo, inicio: r.inicio })),
    agendaConectada: (agenda?.n ?? 0) > 0,
    agendaSincronizadaEm: sincronizada,
    conversasAbertas: conversa.abertas ?? 0,
    aguardandoResposta: conversa.aguardando ?? 0,
    ultimaMensagemEm: conversa.ultima_em ? new Date(conversa.ultima_em) : null,
    contasDeMidia: { meta: meta[0]?.n ?? 0, google: google[0]?.n ?? 0 },
  };
}

/**
 * O bloco do turno, ou null (flag desligada, sem cliente, ou falha — fonte
 * extra nunca derruba a resposta). Uma consulta por tabela, em paralelo.
 */
export async function blocoMultifonte(clientId: string | null, organizationId: string | null, agora: Date = new Date()): Promise<string | null> {
  if (!multifonteLigada() || !clientId || !organizationId) return null;
  try {
    const [cliente] = await db
      .select({ nome: schema.clients.name, org: schema.clients.organizationId })
      .from(schema.clients)
      .where(eq(schema.clients.id, clientId))
      .orderBy(desc(schema.clients.updatedAt))
      .limit(1);
    if (!cliente || cliente.org !== organizationId) return null;
    return multifonteEmTexto(cliente.nome, await lerFotoMultifonte(clientId, organizationId, agora), agora);
  } catch {
    return null;
  }
}

/** Para o panorama: as fontes do cliente citado, em texto para pessoa, ou null. */
export async function multifonteParaPanorama(
  clientId: string | null,
  organizationId: string | null,
  atrasadasNoClickUp: number,
  agora: Date = new Date(),
): Promise<string | null> {
  if (!multifonteLigada() || !clientId || !organizationId) return null;
  try {
    const [cliente] = await db.select({ nome: schema.clients.name, org: schema.clients.organizationId }).from(schema.clients).where(eq(schema.clients.id, clientId)).limit(1);
    if (!cliente || cliente.org !== organizationId) return null;
    return multifonteEmResposta(cliente.nome, await lerFotoMultifonte(clientId, organizationId, agora), agora, atrasadasNoClickUp);
  } catch {
    return null;
  }
}

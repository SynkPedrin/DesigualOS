/**
 * visao-geral-operacao.ts — o Bento enxerga a OPERAÇÃO INTEIRA, não só o
 * cliente do turno (09/11/2026, pedido do Pedro: "quero que ele enxergue todo
 * o sistema — clientes, inbox, mensagens, ClickUp, daily tasks e o brain").
 *
 * O que já entrava no prompt dele: ClickUp (estadoDaOperacao, global), o
 * dossiê do cliente do turno e, atrás de flag, o multifonte por cliente. O
 * que NÃO entrava: a carteira de clientes, o Inbox da agência, as daily
 * tasks, as aprovações/demandas da organização e a memória (brain do Obsidian
 * + dossiês + o que a equipe ensina com "anota") no caminho direto — o loop
 * agêntico já tinha recall semântico, o caminho direto não tinha nada.
 *
 * Este módulo lê as tabelas que já existem (nada é copiado nem sincronizado)
 * e entrega dois blocos curtos:
 *
 *   - visão geral: uma linha por fonte, cada uma dizendo quando foi
 *     atualizada; contagem zero é declarada como "sem registro", nunca como
 *     "não existe trabalho" — mesma regra de honestidade do multifonte;
 *   - memória relevante: recall SEMÂNTICO da pergunta sobre as memórias da
 *     organização (é onde o vault do Obsidian vive depois do
 *     sync-obsidian-vault.mts), cada item com a origem.
 *
 * STATE x KNOWLEDGE: a visão geral é ESTADO atual do OS; a memória é
 * CONHECIMENTO. Os dois blocos dizem isso no cabeçalho pra não se misturarem.
 *
 * Falha em qualquer fonte devolve null/no bloco parcial — fonte extra nunca
 * derruba a resposta.
 */
import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { recallMemoriesSemantic } from '@desigual-os/orchestrator';

const fmt = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d);

export interface FotoOperacao {
  clientes: { total: number; nomes: string[] };
  inbox: {
    abertas: number;
    aguardandoResposta: number;
    ultimas: Array<{ cliente: string | null; remetente: string | null; trecho: string; quando: Date }>;
  };
  /** null = a tela de Daily Tasks não respondeu (ou não existe neste ambiente). */
  dailyTasks: { hoje: number; atrasadas: number; bloqueadas: number; semResponsavel: number; clientesAtivos: number } | null;
  aprovacoesPendentes: number;
  demandasAbertas: number;
}

/** Puro: o bloco do prompt. Toda fonte aparece — com dado, ou dizendo que não há registro. */
export function visaoGeralEmTexto(f: FotoOperacao): string {
  const linhas: string[] = ['VISÃO GERAL DA OPERAÇÃO (estado atual do Desigual OS, da organização inteira — cada linha com a fonte):'];

  linhas.push(
    f.clientes.total > 0
      ? `- Clientes (cadastro do OS): ${f.clientes.total} ativo(s) — ${f.clientes.nomes.join(', ')}${f.clientes.total > f.clientes.nomes.length ? `, e mais ${f.clientes.total - f.clientes.nomes.length}` : ''}.`
      : '- Clientes (cadastro do OS): nenhum cliente ativo registrado.',
  );

  if (f.inbox.abertas > 0 || f.inbox.ultimas.length > 0) {
    linhas.push(
      `- Inbox (WhatsApp/mensagens, Desigual OS): ${f.inbox.abertas} conversa(s) aberta(s)${f.inbox.aguardandoResposta ? `, ${f.inbox.aguardandoResposta} com a última mensagem do cliente sem resposta há mais de 24h` : ''}.`,
    );
    for (const m of f.inbox.ultimas) {
      linhas.push(`  · ${fmt(m.quando)} — ${m.cliente ?? m.remetente ?? 'contato sem cliente vinculado'}: "${m.trecho}"`);
    }
  } else {
    linhas.push('- Inbox (WhatsApp/mensagens, Desigual OS): nenhuma conversa aberta registrada.');
  }

  if (f.dailyTasks) {
    const d = f.dailyTasks;
    linhas.push(
      `- Daily Tasks (Desigual OS): ${d.hoje} com prazo hoje, ${d.atrasadas} atrasada(s), ${d.bloqueadas} bloqueada(s), ${d.semResponsavel} sem responsável, em ${d.clientesAtivos} cliente(s).`,
    );
  } else {
    linhas.push('- Daily Tasks (Desigual OS): leitura indisponível agora — não conclua que não há tarefas.');
  }

  linhas.push(
    f.aprovacoesPendentes > 0
      ? `- Aprovações (Desigual OS): ${f.aprovacoesPendentes} pendente(s) na organização.`
      : '- Aprovações (Desigual OS): nenhuma pendente registrada.',
    f.demandasAbertas > 0
      ? `- Demandas (Desigual OS): ${f.demandasAbertas} aberta(s) na organização.`
      : '- Demandas (Desigual OS): nenhuma aberta registrada.',
  );

  linhas.push('"Nenhum registrado" quer dizer que o OS não tem o registro, NÃO que não existe trabalho — diga assim.');
  return linhas.join('\n');
}

export async function lerFotoOperacao(organizationId: string): Promise<FotoOperacao> {
  const [totalClientes, clientes, inboxResumo, ultimas, aprovacoes, demandas] = await Promise.all([
    db
      .select({ n: count() })
      .from(schema.clients)
      .where(and(eq(schema.clients.organizationId, organizationId), isNull(schema.clients.deletedAt))),
    db
      .select({ nome: schema.clients.name })
      .from(schema.clients)
      .where(and(eq(schema.clients.organizationId, organizationId), isNull(schema.clients.deletedAt)))
      .orderBy(asc(schema.clients.name))
      .limit(15),
    db.execute(sql`
      select count(*)::int as abertas,
             count(*) filter (where ultima.direction = 'inbound' and ultima.created_at < now() - interval '24 hours')::int as aguardando
      from conversation_threads t
      left join lateral (
        select direction, created_at from thread_messages m where m.thread_id = t.id order by m.created_at desc limit 1
      ) ultima on true
      where t.organization_id = ${organizationId}::uuid and t.status = 'open'`),
    db.execute(sql`
      select m.content, m.created_at, m.sender_name, c.name as cliente
      from thread_messages m
      join conversation_threads t on t.id = m.thread_id
      left join clients c on c.id = t.client_id
      where m.organization_id = ${organizationId}::uuid and m.direction = 'inbound' and m.content is not null
      order by m.created_at desc limit 5`),
    db
      .select({ n: count() })
      .from(schema.approvalRequests)
      .where(and(eq(schema.approvalRequests.organizationId, organizationId), eq(schema.approvalRequests.status, 'pending'))),
    db
      .select({ n: count() })
      .from(schema.demands)
      .where(and(eq(schema.demands.organizationId, organizationId), sql`${schema.demands.status} in ('new', 'briefing', 'in_production')`)),
  ]);

  // Daily Tasks: mesma contagem do painel (work-engine overview.ts), em SQL
  // direto porque o worker não depende do work-engine. Falha própria: se a
  // tela não existir neste ambiente, só esta linha fica indisponível.
  const dailyTasks = await db
    .execute(sql`
      select
        count(*) filter (where t.completed_at is null and (t.due_at at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date)::int as hoje,
        count(*) filter (where t.completed_at is null and t.due_at < now() and (t.due_at at time zone 'America/Sao_Paulo')::date < (now() at time zone 'America/Sao_Paulo')::date)::int as atrasadas,
        count(*) filter (where t.completed_at is null and s.category = 'blocked')::int as bloqueadas,
        count(*) filter (where t.completed_at is null and not exists (select 1 from work_task_assignees a where a.task_id = t.id))::int as sem_responsavel,
        count(distinct t.client_id) filter (where t.completed_at is null)::int as clientes_ativos
      from work_tasks t
      join work_lists l on l.id = t.list_id
      join work_task_statuses s on s.id = t.status_id
      where t.organization_id = ${organizationId}::uuid and t.archived_at is null and t.parent_task_id is null`)
    .then((r) => {
      const c = (r as unknown as Array<Record<string, number>>)[0] ?? {};
      return { hoje: c.hoje ?? 0, atrasadas: c.atrasadas ?? 0, bloqueadas: c.bloqueadas ?? 0, semResponsavel: c.sem_responsavel ?? 0, clientesAtivos: c.clientes_ativos ?? 0 };
    })
    .catch(() => null);

  const resumo = ((inboxResumo as unknown as Array<{ abertas: number; aguardando: number }>)[0]) ?? { abertas: 0, aguardando: 0 };
  return {
    clientes: { total: totalClientes[0]?.n ?? clientes.length, nomes: clientes.map((c) => c.nome) },
    inbox: {
      abertas: resumo.abertas ?? 0,
      aguardandoResposta: resumo.aguardando ?? 0,
      ultimas: (ultimas as unknown as Array<{ content: string; created_at: string | Date; sender_name: string | null; cliente: string | null }>).map((m) => ({
        cliente: m.cliente,
        remetente: m.sender_name,
        trecho: m.content.replace(/\s+/g, ' ').trim().slice(0, 140),
        quando: new Date(m.created_at),
      })),
    },
    dailyTasks,
    aprovacoesPendentes: aprovacoes[0]?.n ?? 0,
    demandasAbertas: demandas[0]?.n ?? 0,
  };
}

/** O bloco do turno, ou null (sem organização ou falha — fonte extra nunca derruba a resposta). */
export async function blocoVisaoGeral(organizationId: string | null): Promise<string | null> {
  if (!organizationId) return null;
  try {
    return visaoGeralEmTexto(await lerFotoOperacao(organizationId));
  } catch {
    return null;
  }
}

/**
 * MEMÓRIA (knowledge): recall semântico da pergunta sobre as memórias da
 * organização — dossiês, brain do Obsidian (sync-obsidian-vault.mts grava
 * aqui), regras ensinadas com "anota". O loop agêntico já fazia isto; o
 * caminho direto respondia sem nunca consultar a memória. Cada item diz a
 * origem; falha ou ausência de vetor degradam pra null, nunca pra erro.
 */
export async function blocoMemoriaSemantica(params: {
  pergunta: string;
  environment: string;
  organizationId: string | null;
  clientId: string | null;
}): Promise<string | null> {
  if (!params.organizationId) return null;
  try {
    const mems = await recallMemoriesSemantic({
      text: params.pergunta,
      environment: params.environment,
      organizationId: params.organizationId,
      limit: 6,
    });
    if (mems.length === 0) return null;
    const linhas = mems.map((m) => {
      const origem = [m.kind, m.subject].filter(Boolean).join(' · ');
      const trecho = m.content.replace(/\s+/g, ' ').trim().slice(0, 300);
      return `- [${origem}] ${trecho}`;
    });
    return [
      'MEMÓRIAS RELEVANTES PRA ESTA PERGUNTA (conhecimento guardado: dossiês, brain, anotações da equipe — cada item com a origem; confiança varia, dado estruturado do turno vence memória em conflito):',
      ...linhas,
    ].join('\n');
  } catch {
    return null;
  }
}

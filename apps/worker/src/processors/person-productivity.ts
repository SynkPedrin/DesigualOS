import { db, schema } from '@desigual-os/database';
import { and, eq, gte, sql } from 'drizzle-orm';
import { casarEntidades, dobrar } from '@desigual-os/context-engine';
import type { PersonTurnContext } from './person-context';

/**
 * person-productivity.ts — "quantas tarefas o Gui tá finalizando por dia?"
 *
 * Caso real (10/11/2026): o Pedro perguntou a produtividade do Gui e o Bento
 * respondeu "não tenho dados de produtividade diária" — tendo o banco INTEIRO
 * à disposição. Os fatos existem desde sempre: `work_tasks.completed_at` diz
 * o que foi concluído e `work_activity_events` diz QUEM moveu cada status. O
 * que não existia era o caminho desses dados até o prompt: o planner conhecia
 * cliente e evento, não pessoa trabalhando.
 *
 * Este módulo é a ponte. NÚMEROS apurados aqui, determinísticos, conferíveis;
 * a leitura é do modelo — mesma separação do bento-panorama.ts. Pessoa que não
 * casa com usuário do sistema não gera bloco (o person-context já declara a
 * ausência; inventar número seria pior que nenhum).
 */

/** O que conta como produtividade: concluir, ou mover para frente no funil (aprovação/revisão/feito). */
const SINAL_DE_PRODUTIVIDADE =
  /produtividade|produzindo|finaliz|conclu|entreg|aprov|revis[aã]o|rendimento|desempenho|por dia|di[áa]ri[ao]|semana (passada|retrasada)|ritmo/i;

/** Pergunta de produtividade de alguém. Sem sinal, nenhuma query acontece. */
export function perguntaEhDeProdutividade(mensagem: string): boolean {
  const texto = (mensagem.split('\n\n---\n')[0] ?? mensagem).trim();
  return texto.length > 0 && SINAL_DE_PRODUTIVIDADE.test(texto);
}

export interface ProdutividadeDePessoa {
  userId: string;
  nome: string;
  /** Concluídas por dia nos últimos 14 dias: [{ dia: '2026-11-10', n: 3 }]. */
  concluidasPorDia: Array<{ dia: string; n: number }>;
  totalConcluidas14d: number;
  /** Mudanças de status feitas PELA pessoa para etapas de aprovação/revisão/conclusão, por dia (14d). */
  avancosPorDia: Array<{ dia: string; n: number }>;
  totalAvancos14d: number;
  abertasAgora: number;
  atrasadasAgora: number;
}

const JANELA_DIAS = 14;
/** Janela da produtividade, exportada para a evidência registrar o recorte. */
export const JANELA_PRODUTIVIDADE_DIAS = JANELA_DIAS;

async function produtividadeDeUsuario(
  organizationId: string,
  usuario: { id: string; name: string },
): Promise<ProdutividadeDePessoa> {
  const desde = new Date(Date.now() - JANELA_DIAS * 86_400_000);

  const porDia = (linhas: Array<{ dia: string; n: number }>) =>
    linhas.map((l) => ({ dia: String(l.dia).slice(0, 10), n: Number(l.n) }));

  const [concluidas, avancos, carga] = await Promise.all([
    // O que as tarefas DA PESSOA concluíram por dia. Atribuição pela responsabilidade atual —
    // é a leitura que a operação faz ("o que saiu da mão dele"), não auditoria de clique.
    db.execute(sql`
      select date_trunc('day', t.completed_at)::text as dia, count(*)::int as n
      from work_tasks t
      join work_task_assignees a on a.task_id = t.id
      where t.organization_id = ${organizationId}
        and a.user_id = ${usuario.id}
        and t.completed_at >= ${desde}
      group by 1 order by 1`),
    // O que a PESSOA moveu com as próprias mãos para etapa de aprovação/revisão/conclusão.
    db.execute(sql`
      select date_trunc('day', e.created_at)::text as dia, count(*)::int as n
      from work_activity_events e
      where e.organization_id = ${organizationId}
        and e.actor_id = ${usuario.id}
        and e.action = 'status_changed'
        and e.created_at >= ${desde}
        and (e.data->>'to' ~* 'aprov|revis|conclu|done|feito|finaliz')
      group by 1 order by 1`),
    db.execute(sql`
      select count(*) filter (where t.completed_at is null)::int as abertas,
             count(*) filter (where t.completed_at is null and t.due_at < now())::int as atrasadas
      from work_tasks t
      join work_task_assignees a on a.task_id = t.id
      where t.organization_id = ${organizationId}
        and a.user_id = ${usuario.id}
        and t.archived_at is null and t.parent_task_id is null`),
  ]);

  const concluidasPorDia = porDia(concluidas as unknown as Array<{ dia: string; n: number }>);
  const avancosPorDia = porDia(avancos as unknown as Array<{ dia: string; n: number }>);
  const carga0 = (carga as unknown as Array<{ abertas: number; atrasadas: number }>)[0];

  return {
    userId: usuario.id,
    nome: usuario.name,
    concluidasPorDia,
    totalConcluidas14d: concluidasPorDia.reduce((s, d) => s + d.n, 0),
    avancosPorDia,
    totalAvancos14d: avancosPorDia.reduce((s, d) => s + d.n, 0),
    abertasAgora: Number(carga0?.abertas ?? 0),
    atrasadasAgora: Number(carga0?.atrasadas ?? 0),
  };
}

/**
 * Resolve as pessoas do turno contra os usuários do sistema (o registro de
 * pessoas é do ClickUp; a produtividade mora nas tabelas work_*, que conhecem
 * `users`). Sem usuário correspondente, sem bloco — declarado, nunca inventado.
 */
export async function buscarProdutividadeDoTurno(
  mensagem: string,
  pessoas: PersonTurnContext | null,
  organizationId: string | null,
): Promise<ProdutividadeDePessoa[]> {
  if (!organizationId || !pessoas || pessoas.encontradas.length === 0) return [];
  if (!perguntaEhDeProdutividade(mensagem)) return [];

  const usuarios = await db
    .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
    .from(schema.users)
    .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.userId, schema.users.id))
    .where(eq(schema.organizationMembers.organizationId, organizationId))
    .catch(() => []);
  if (usuarios.length === 0) return [];

  const achadas: ProdutividadeDePessoa[] = [];
  for (const pessoa of pessoas.encontradas) {
    const alvo = dobrar(pessoa.canonicalName);
    const m = casarEntidades(
      pessoa.canonicalName,
      usuarios.map((u) => ({ id: u.id, canonicalName: u.name, aliases: [u.email.split('@')[0] ?? ''] })),
    );
    // Também aceita casamento por substring dobrada ("Gui" ~ "Guilherme Souza").
    const usuario =
      (m.length === 1 || (m.length > 1 && m[0]!.tokens > m[1]!.tokens)
        ? usuarios.find((u) => u.id === m[0]!.entidade.id)
        : undefined) ??
      usuarios.find((u) => {
        const nome = dobrar(u.name);
        return nome.includes(alvo) || alvo.includes(nome.split(' ')[0]!);
      });
    if (!usuario || achadas.some((a) => a.userId === usuario.id)) continue;
    achadas.push(await produtividadeDeUsuario(organizationId, usuario));
  }
  return achadas;
}

function linhasPorDia(titulo: string, porDia: Array<{ dia: string; n: number }>): string[] {
  if (porDia.length === 0) return [`${titulo}: nenhuma nos últimos ${JANELA_DIAS} dias.`];
  return [`${titulo}:`, ...porDia.map((d) => `  · ${d.dia}: ${d.n}`)];
}

/** O bloco do pacote. Vazio quando não há nada apurado — nunca afirma zero a partir de falha. */
export function formatarBlocoDeProdutividade(lista: readonly ProdutividadeDePessoa[]): string {
  if (lista.length === 0) return '';
  const partes: string[] = [
    `PRODUTIVIDADE POR PESSOA (Daily/OS, últimos ${JANELA_DIAS} dias — apurado do banco neste turno, conferível):`,
  ];
  for (const p of lista) {
    partes.push(
      '',
      `${p.nome}: ${p.totalConcluidas14d} concluída(s) e ${p.totalAvancos14d} movimentação(ões) para aprovação/revisão/conclusão no período. Agora: ${p.abertasAgora} em aberto, ${p.atrasadasAgora} atrasada(s).`,
      ...linhasPorDia('Concluídas por dia', p.concluidasPorDia),
      ...linhasPorDia('Movidas para aprovação/revisão/conclusão por dia', p.avancosPorDia),
    );
  }
  partes.push(
    '',
    'Estes números são fato apurado: cite-os como estão. Dia ausente da lista = zero naquele dia.',
  );
  return partes.join('\n');
}

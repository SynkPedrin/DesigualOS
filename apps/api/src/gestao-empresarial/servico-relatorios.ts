import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { hojeEmSaoPaulo, somarDias } from './dominio/datas';
import { agruparPorAtraso, centavosParaCsv, linhaCsv } from './dominio/relatorios';
import { AVISO_HISTORICO_PARCIAL } from './dominio/indicadores';
import { situacaoDe } from './dominio/situacao';
import { saldosDasContas } from './servico-financeiro';

const { geEntries: e } = schema;

type Linha = Record<string, string | number | boolean | null>;
const linhas = async (q: ReturnType<typeof sql>): Promise<Linha[]> => [...(await db.execute<Linha>(q))];
const n = (v: unknown) => Number(v ?? 0);

/**
 * A fotografia do dia. Cancelado fica de fora de toda soma de receita e despesa: ele aparece em
 * `cancelado`, separado. O aviso de histórico parcial vem junto sempre que houver receita sem
 * nenhuma despesa registrada, porque aí qualquer "resultado" seria só falta de dado.
 */
export async function visaoGeral(org: string, hoje = hojeEmSaoPaulo()) {
  const [porSituacao, vencidos, proximos, sinais, pendentes, saldos] = await Promise.all([
    linhas(sql`select kind, status, count(*)::int as qtd, coalesce(sum(coalesce(paid_amount_cents, amount_cents)),0)::text as total from ge_entries where organization_id = ${org} group by kind, status`),
    linhas(sql`select kind, count(*)::int as qtd, coalesce(sum(amount_cents),0)::text as total from ge_entries where organization_id = ${org} and status = 'aberto' and due_date < ${hoje} group by kind`),
    linhas(sql`select kind, count(*)::int as qtd, coalesce(sum(amount_cents),0)::text as total from ge_entries where organization_id = ${org} and status = 'aberto' and due_date between ${hoje} and ${somarDias(hoje, 7)} group by kind`),
    linhas(sql`select
        exists(select 1 from ge_entries where organization_id = ${org} and kind = 'receita' and status <> 'cancelado') as tem_receita,
        exists(select 1 from ge_entries where organization_id = ${org} and kind = 'despesa') as tem_despesa,
        (select count(*)::int from ge_entries where organization_id = ${org} and status = 'quitado' and paid_at_unknown) as pagamento_sem_data`),
    linhas(sql`select count(*)::int as linhas, count(distinct r.batch_id)::int as lotes from ge_import_rows r join ge_import_batches b on b.id = r.batch_id where b.organization_id = ${org} and b.status = 'em_staging' and r.status in ('novo','duplicado_provavel','precisa_vinculo')`),
    saldosDasContas(org),
  ]);
  const soma = (kind: string, status: string) => n(porSituacao.find((l) => l.kind === kind && l.status === status)?.total);
  const qtd = (l: Linha[], kind: string) => ({ quantidade: n(l.find((x) => x.kind === kind)?.qtd), totalCents: n(l.find((x) => x.kind === kind)?.total) });
  const s = sinais[0]!;
  const parcial = s['tem_receita'] === true && s['tem_despesa'] !== true;
  const conhecidos = saldos.filter((c) => c.balanceCents !== null);
  return {
    receita: { recebida: soma('receita', 'quitado'), aberta: soma('receita', 'aberto') },
    despesa: { paga: soma('despesa', 'quitado'), aberta: soma('despesa', 'aberto') },
    cancelado: { receita: soma('receita', 'cancelado'), despesa: soma('despesa', 'cancelado') },
    vencidos: { receita: qtd(vencidos, 'receita'), despesa: qtd(vencidos, 'despesa') },
    proximos7Dias: { receita: qtd(proximos, 'receita'), despesa: qtd(proximos, 'despesa') },
    saldo: { totalCents: conhecidos.reduce((a, c) => a + (c.balanceCents ?? 0), 0), contasComSaldo: conhecidos.length, contasSemSaldoInicial: saldos.length - conhecidos.length },
    pagamentosSemData: n(s['pagamento_sem_data']),
    importacaoPendente: { linhas: n(pendentes[0]?.['linhas']), lotes: n(pendentes[0]?.['lotes']) },
    historicoParcial: parcial,
    aviso: parcial ? AVISO_HISTORICO_PARCIAL : null,
  };
}

/** Contas a receber ou a pagar em aberto, por faixa de atraso e pelas pessoas que mais devem ou a quem mais se deve. */
export async function atrasoPorFaixa(org: string, kind: 'receita' | 'despesa', hoje = hojeEmSaoPaulo()) {
  const abertos = await db.select({ dueDate: e.dueDate, amountCents: e.amountCents }).from(e).where(and(eq(e.organizationId, org), eq(e.kind, kind), eq(e.status, 'aberto')));
  const maiores = await linhas(sql`
    select coalesce(p.name, e.party_label, 'Sem cadastro') as nome, count(*)::int as qtd, sum(e.amount_cents)::text as total,
           sum(case when e.due_date < ${hoje} then e.amount_cents else 0 end)::text as vencido
    from ge_entries e left join ge_parties p on p.id = e.party_id
    where e.organization_id = ${org} and e.kind = ${kind} and e.status = 'aberto'
    group by 1 order by sum(e.amount_cents) desc, 1 limit 20`);
  return {
    faixas: agruparPorAtraso(abertos, hoje),
    totalCents: abertos.reduce((a, l) => a + l.amountCents, 0),
    maiores: maiores.map((m) => ({ nome: m['nome'], quantidade: n(m['qtd']), totalCents: n(m['total']), vencidoCents: n(m['vencido']) })),
  };
}

/**
 * Resultado por categoria, por COMPETÊNCIA (cai no vencimento quando a competência não existe, e diz
 * quantos lançamentos usaram essa aproximação). Cancelado nunca entra.
 */
export async function resultadoPorCategoria(org: string, de: string, ate: string) {
  const dados = await linhas(sql`
    select e.kind, coalesce(c.name, 'Sem categoria') as categoria, count(*)::int as qtd, sum(e.amount_cents)::text as total,
           count(*) filter (where e.competence_date is null)::int as aproximados
    from ge_entries e left join ge_categories c on c.id = e.category_id
    where e.organization_id = ${org} and e.status <> 'cancelado' and coalesce(e.competence_date, e.due_date) between ${de} and ${ate}
    group by e.kind, 2 order by e.kind, sum(e.amount_cents) desc, 2`);
  const por = (kind: string) => dados.filter((d) => d['kind'] === kind).map((d) => ({ categoria: String(d['categoria']), quantidade: n(d['qtd']), totalCents: n(d['total']) }));
  const receitas = por('receita');
  const despesas = por('despesa');
  const totalR = receitas.reduce((a, x) => a + x.totalCents, 0);
  const totalD = despesas.reduce((a, x) => a + x.totalCents, 0);
  const semDespesa = despesas.length === 0 && receitas.length > 0;
  return {
    periodo: { de, ate },
    receitas,
    despesas,
    receitaTotalCents: totalR,
    despesaTotalCents: totalD,
    resultadoCents: totalR - totalD,
    lancamentosPorVencimento: dados.reduce((a, d) => a + n(d['aproximados']), 0),
    historicoParcial: semDespesa,
    aviso: semDespesa ? AVISO_HISTORICO_PARCIAL : null,
  };
}

export async function rentabilidadeDaProducao(org: string) {
  const dados = await linhas(sql`
    select o.number, o.title, o.status, o.sale_cents, coalesce((select sum(c.amount_cents) from ge_production_costs c where c.order_id = o.id), 0)::text as custo, p.name as cliente
    from ge_production_orders o left join ge_parties p on p.id = o.party_id
    where o.organization_id = ${org} and o.status <> 'cancelada' order by o.created_at desc limit 200`);
  return dados.map((d) => {
    const custo = n(d['custo']);
    const venda = d['sale_cents'] === null ? null : n(d['sale_cents']);
    const margemCents = venda === null ? -custo : venda - custo;
    return { numero: d['number'], titulo: d['title'], status: d['status'], cliente: d['cliente'], vendaCents: venda, custoCents: custo, margemCents, percentual: venda && venda > 0 ? Math.round((margemCents * 1000) / venda) / 10 : null };
  });
}

export async function funilComercial(org: string) {
  const dados = await linhas(sql`
    select p.status, count(*)::int as qtd,
           coalesce(sum((select sum(i.quantity * i.unit_price_cents - i.discount_cents) from ge_proposal_items i where i.proposal_id = p.id)), 0)::text as total
    from ge_proposals p where p.organization_id = ${org} group by p.status`);
  return Object.fromEntries(dados.map((d) => [String(d['status']), { quantidade: n(d['qtd']), totalCents: n(d['total']) }]));
}

export interface FiltroDeExportacao {
  kind?: 'receita' | 'despesa' | undefined;
  situacao?: 'aberto' | 'vencido' | 'quitado' | 'cancelado' | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

const MAX_LINHAS_CSV = 50_000;

/** CSV de lançamentos para planilha (`;`, vírgula decimal). Texto livre é neutralizado contra injeção de fórmula. */
export async function exportarLancamentosCsv(org: string, f: FiltroDeExportacao, hoje = hojeEmSaoPaulo()) {
  const filtros = [eq(e.organizationId, org)];
  if (f.kind) filtros.push(eq(e.kind, f.kind));
  if (f.situacao === 'vencido') filtros.push(eq(e.status, 'aberto'), sql`${e.dueDate} < ${hoje}`);
  else if (f.situacao === 'aberto') filtros.push(eq(e.status, 'aberto'), sql`${e.dueDate} >= ${hoje}`);
  else if (f.situacao) filtros.push(eq(e.status, f.situacao));
  if (f.from) filtros.push(gte(e.dueDate, f.from));
  if (f.to) filtros.push(lte(e.dueDate, f.to));
  const rows = await db
    .select({ e, pessoa: schema.geParties.name })
    .from(e)
    .leftJoin(schema.geParties, eq(schema.geParties.id, e.partyId))
    .where(and(...filtros))
    .orderBy(e.dueDate, e.id)
    .limit(MAX_LINHAS_CSV + 1);
  const truncado = rows.length > MAX_LINHAS_CSV;
  const corpo = rows.slice(0, MAX_LINHAS_CSV).map(({ e: l, pessoa }) =>
    linhaCsv([
      l.dueDate,
      l.competenceDate,
      l.kind === 'receita' ? 'Receita' : 'Despesa',
      situacaoDe(l, hoje),
      pessoa ?? l.partyLabel,
      l.description,
      centavosParaCsv(l.amountCents),
      l.installmentNo ? `${l.installmentNo}/${l.installmentTotal}` : null,
      l.docNumber,
      l.source,
    ]),
  );
  const cabecalho = linhaCsv(['Vencimento', 'Competência', 'Tipo', 'Situação', 'Cadastro ou cedente', 'Descrição', 'Valor', 'Parcela', 'Documento', 'Origem']);
  return { csv: `﻿${[cabecalho, ...corpo].join('\r\n')}\r\n`, linhas: corpo.length, truncado };
}


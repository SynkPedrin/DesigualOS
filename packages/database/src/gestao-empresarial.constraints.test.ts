import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * O BANCO RECUSA DADO INVÁLIDO, sem depender da aplicação.
 *
 * Existe porque o drizzle-orm 0.33 ignora `check()` em silêncio: a primeira migration do
 * módulo saiu com zero CHECK e nada acusou. Estas constraints vivem em SQL no fim de
 * `0085_gestao_empresarial.sql`; este teste é o que impede alguém de perdê-las.
 *
 * Roda só com `GESTAO_TEST_DATABASE_URL` (Postgres LOCAL, já migrado). Cada prova roda numa
 * transação que sempre volta atrás: nada fica gravado. Nunca aponte para produção.
 */
const url = process.env.GESTAO_TEST_DATABASE_URL;
const sql = url ? postgres(url, { max: 1, prepare: false, onnotice: () => undefined }) : null;

class Desfazer extends Error {}

/** Roda `fn` numa transação com uma organização e uma conta, e sempre desfaz. */
async function emTransacao(fn: (tx: postgres.TransactionSql, ids: { org: string; conta: string }) => Promise<void>): Promise<void> {
  try {
    await sql!.begin(async (tx) => {
      const [org] = await tx`insert into organizations (name, slug) values ('probe', ${'probe-' + Math.random().toString(36).slice(2)}) returning id`;
      const [conta] = await tx`insert into ge_financial_accounts (organization_id, name) values (${org!.id}, 'Caixa') returning id`;
      await fn(tx, { org: org!.id as string, conta: conta!.id as string });
      throw new Desfazer();
    });
  } catch (e) {
    if (!(e instanceof Desfazer)) throw e;
  }
}

/** O Postgres devolve o código do erro: 23514 = CHECK, 23505 = único. */
async function recusa(fn: Parameters<typeof emTransacao>[0], codigo: string): Promise<void> {
  let recebido: unknown;
  try {
    await emTransacao(fn);
  } catch (e) {
    recebido = e;
  }
  expect(recebido, 'o banco deveria ter recusado').toBeDefined();
  expect((recebido as { code?: string }).code).toBe(codigo);
}

afterAll(async () => {
  await sql?.end();
});

describe.skipIf(!sql)('constraints do módulo Gestão Empresarial', () => {
  it('as 37 CHECKs existem no banco', async () => {
    const [linha] = await sql!`select count(*)::int as n from pg_constraint where contype = 'c' and conrelid::regclass::text like 'ge\_%'`;
    expect(linha?.n).toBe(37);
  });

  it('valor de lançamento zero ou negativo é recusado', async () => {
    await recusa(async (tx, { org }) => void (await tx`insert into ge_entries (organization_id, kind, description, amount_cents, due_date) values (${org}, 'receita', 'x', -5, '2026-10-22')`), '23514');
    await recusa(async (tx, { org }) => void (await tx`insert into ge_entries (organization_id, kind, description, amount_cents, due_date) values (${org}, 'receita', 'x', 0, '2026-10-22')`), '23514');
  });

  it('quitado exige data de pagamento, e data de pagamento exige quitado', async () => {
    await recusa(async (tx, { org }) => void (await tx`insert into ge_entries (organization_id, kind, description, amount_cents, due_date, status) values (${org}, 'receita', 'x', 100, '2026-10-22', 'quitado')`), '23514');
    await recusa(async (tx, { org }) => void (await tx`insert into ge_entries (organization_id, kind, description, amount_cents, due_date, status, paid_at) values (${org}, 'receita', 'x', 100, '2026-10-22', 'aberto', '2026-10-22')`), '23514');
  });

  it('status e tipo fora da lista são recusados ("vencido" não é status guardado)', async () => {
    await recusa(async (tx, { org }) => void (await tx`insert into ge_entries (organization_id, kind, description, amount_cents, due_date, status) values (${org}, 'receita', 'x', 100, '2026-10-22', 'vencido')`), '23514');
    await recusa(async (tx, { org }) => void (await tx`insert into ge_entries (organization_id, kind, description, amount_cents, due_date) values (${org}, 'outro', 'x', 100, '2026-10-22')`), '23514');
  });

  it('a mesma origem não entra duas vezes (idempotência da importação)', async () => {
    await recusa(async (tx, { org }) => {
      await tx`insert into ge_entries (organization_id, kind, description, amount_cents, due_date, source, source_key) values (${org}, 'receita', 'x', 100, '2026-10-22', 'operand', '1')`;
      await tx`insert into ge_entries (organization_id, kind, description, amount_cents, due_date, source, source_key) values (${org}, 'receita', 'y', 200, '2026-10-23', 'operand', '1')`;
    }, '23505');
  });

  it('sem chave de origem, lançamentos iguais convivem (a unicidade só vale com origem)', async () => {
    await emTransacao(async (tx, { org }) => {
      await tx`insert into ge_entries (organization_id, kind, description, amount_cents, due_date) values (${org}, 'receita', 'x', 100, '2026-10-22')`;
      await tx`insert into ge_entries (organization_id, kind, description, amount_cents, due_date) values (${org}, 'receita', 'x', 100, '2026-10-22')`;
    });
  });

  it('parcela maior que o total é recusada', async () => {
    await recusa(async (tx, { org }) => void (await tx`insert into ge_entries (organization_id, kind, description, amount_cents, due_date, installment_no, installment_total) values (${org}, 'receita', 'x', 100, '2026-10-22', 3, 2)`), '23514');
  });

  it('razão: movimento zero é recusado e um estorno só pode existir uma vez', async () => {
    await recusa(async (tx, { org, conta }) => void (await tx`insert into ge_ledger (organization_id, account_id, kind, amount_cents, occurred_on) values (${org}, ${conta}, 'ajuste', 0, '2026-10-22')`), '23514');
    await recusa(async (tx, { org, conta }) => {
      const [orig] = await tx`insert into ge_ledger (organization_id, account_id, kind, amount_cents, occurred_on) values (${org}, ${conta}, 'recebimento', 100, '2026-10-22') returning id`;
      await tx`insert into ge_ledger (organization_id, account_id, kind, amount_cents, occurred_on, reverses_id) values (${org}, ${conta}, 'estorno', -100, '2026-10-22', ${orig!.id})`;
      await tx`insert into ge_ledger (organization_id, account_id, kind, amount_cents, occurred_on, reverses_id) values (${org}, ${conta}, 'estorno', -100, '2026-10-22', ${orig!.id})`;
    }, '23505');
  });

  it('item de proposta: desconto não passa do valor da linha', async () => {
    await recusa(async (tx, { org }) => {
      const [p] = await tx`insert into ge_proposals (organization_id, number, title) values (${org}, '1', 't') returning id`;
      await tx`insert into ge_proposal_items (organization_id, proposal_id, description, quantity, unit_price_cents, discount_cents) values (${org}, ${p!.id}, 'x', 2, 1000, 2001)`;
    }, '23514');
  });

  it('contrato: fim antes do início é recusado', async () => {
    await recusa(async (tx, { org }) => void (await tx`insert into ge_contracts (organization_id, number, title, total_cents, starts_on, ends_on) values (${org}, '1', 't', 0, '2026-10-22', '2026-10-01')`), '23514');
  });

  it('documento fora de cpf/cnpj/outro e papel desconhecido são recusados', async () => {
    await recusa(async (tx, { org }) => void (await tx`insert into ge_parties (organization_id, name, document_kind) values (${org}, 'x', 'rg')`), '23514');
    await recusa(async (tx, { org }) => {
      const [p] = await tx`insert into ge_parties (organization_id, name) values (${org}, 'x') returning id`;
      await tx`insert into ge_party_roles (organization_id, party_id, role) values (${org}, ${p!.id}, 'dono')`;
    }, '23514');
  });

  it('a mesma entidade pode ser cliente E fornecedor, mas não o mesmo papel duas vezes', async () => {
    await emTransacao(async (tx, { org }) => {
      const [p] = await tx`insert into ge_parties (organization_id, name) values (${org}, 'x') returning id`;
      await tx`insert into ge_party_roles (organization_id, party_id, role) values (${org}, ${p!.id}, 'cliente')`;
      await tx`insert into ge_party_roles (organization_id, party_id, role) values (${org}, ${p!.id}, 'fornecedor')`;
    });
    await recusa(async (tx, { org }) => {
      const [p] = await tx`insert into ge_parties (organization_id, name) values (${org}, 'x') returning id`;
      await tx`insert into ge_party_roles (organization_id, party_id, role) values (${org}, ${p!.id}, 'cliente')`;
      await tx`insert into ge_party_roles (organization_id, party_id, role) values (${org}, ${p!.id}, 'cliente')`;
    }, '23505');
  });
});

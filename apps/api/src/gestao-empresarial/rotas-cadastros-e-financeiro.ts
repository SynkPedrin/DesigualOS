import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { auditarAcao } from '../lib/auditoria';
import { exigirGestao } from './acesso';
import { centavos, dia, ErroDeNegocio, paginacaoSchema, paginar, responderErro, uuid } from './http';
import * as cad from './servico-cadastros';
import * as cat from './servico-catalogos';
import * as fin from './servico-financeiro';
import { projetarFluxo } from './dominio/fluxo-de-caixa';
import { hojeEmSaoPaulo } from './dominio/datas';
import { db, schema } from '@desigual-os/database';
import { and, eq, inArray } from 'drizzle-orm';

const guard = { preHandler: exigirGestao };
const P = '/gestao-empresarial';

export const ator = (r: FastifyRequest): fin.Ator => ({ organizationId: r.tenantContext!.organizationId, userId: r.authUser!.id });
const texto = (max = 200) => z.string().trim().min(1).max(max);
const opt = <T extends z.ZodTypeAny>(s: T) => s.nullish();

const papel = z.enum(cad.PAPEIS);
const pessoaCampos = {
  name: texto(200),
  legalName: opt(z.string().trim().max(200)),
  document: opt(z.string().trim().max(32)),
  email: opt(z.string().trim().max(200)),
  phone: opt(z.string().trim().max(40)),
  city: opt(z.string().trim().max(100)),
  state: opt(z.string().trim().max(2)),
  notes: opt(z.string().trim().max(2000)),
  mediaType: opt(z.string().trim().max(60)),
};

const lancamentoCampos = {
  description: texto(300),
  dueDate: dia,
  competenceDate: opt(dia),
  partyId: opt(uuid),
  partyLabel: opt(z.string().trim().max(200)),
  categoryId: opt(uuid),
  costCenterId: opt(uuid),
  accountId: opt(uuid),
  docNumber: opt(z.string().trim().max(60)),
};

/** Executa a rota traduzindo erro de negócio/validação/constraint em resposta HTTP. */
async function tentar<T>(reply: Parameters<typeof responderErro>[0], fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    return responderErro(reply, e);
  }
}

export async function registrarCadastrosEFinanceiro(app: FastifyInstance): Promise<void> {
  // ── Cadastros ────────────────────────────────────────────────────────────
  app.get(`${P}/cadastros/pessoas`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const q = paginacaoSchema
        .extend({ role: papel.optional(), status: z.enum(['ativo', 'inativo']).optional(), q: z.string().trim().max(100).optional(), semDocumento: z.enum(['true']).optional(), documentoInvalido: z.enum(['true']).optional() })
        .parse(req.query);
      const r = await cad.listarPessoas(ator(req).organizationId, { ...q, semDocumento: q.semDocumento === 'true', documentoInvalido: q.documentoInvalido === 'true' });
      return paginar(r.items, r.total, q.page, q.pageSize);
    }),
  );
  app.get<{ Params: { id: string } }>(`${P}/cadastros/pessoas/:id`, guard, async (req, reply) => tentar(reply, () => cad.obterPessoa(ator(req).organizationId, uuid.parse(req.params.id))));
  app.post(`${P}/cadastros/pessoas`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const b = z.object({ ...pessoaCampos, roles: z.array(papel).min(1, 'Escolha pelo menos um papel.').max(5) }).parse(req.body);
      const p = await cad.criarPessoa(ator(req), b as cad.NovaPessoa);
      await auditarAcao(req, { action: 'gestao.pessoa.criada', organizationId: p.organizationId, resourceType: 'ge_party', resourceId: p.id, metadata: { roles: b.roles } });
      return reply.code(201).send(p);
    }),
  );
  app.patch<{ Params: { id: string } }>(`${P}/cadastros/pessoas/:id`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const b = z.object({ ...pessoaCampos, name: texto(200).optional() }).partial().parse(req.body);
      const p = await cad.editarPessoa(ator(req), uuid.parse(req.params.id), b);
      await auditarAcao(req, { action: 'gestao.pessoa.editada', organizationId: p.organizationId, resourceType: 'ge_party', resourceId: p.id, metadata: { campos: Object.keys(b) } });
      return p;
    }),
  );
  app.post<{ Params: { id: string } }>(`${P}/cadastros/pessoas/:id/arquivar`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const b = z.object({ arquivar: z.boolean().default(true) }).parse(req.body ?? {});
      const p = await cad.arquivarPessoa(ator(req), uuid.parse(req.params.id), b.arquivar);
      await auditarAcao(req, { action: b.arquivar ? 'gestao.pessoa.arquivada' : 'gestao.pessoa.reativada', organizationId: p.organizationId, resourceType: 'ge_party', resourceId: p.id });
      return p;
    }),
  );
  app.post<{ Params: { id: string } }>(`${P}/cadastros/pessoas/:id/papeis`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const b = z.object({ role: papel }).parse(req.body);
      await cad.adicionarPapel(ator(req), uuid.parse(req.params.id), b.role);
      await auditarAcao(req, { action: 'gestao.pessoa.papel_adicionado', organizationId: ator(req).organizationId, resourceType: 'ge_party', resourceId: req.params.id, metadata: { role: b.role } });
      return reply.code(204).send();
    }),
  );
  app.delete<{ Params: { id: string; papel: string } }>(`${P}/cadastros/pessoas/:id/papeis/:papel`, guard, async (req, reply) =>
    tentar(reply, async () => {
      await cad.removerPapel(ator(req), uuid.parse(req.params.id), papel.parse(req.params.papel));
      await auditarAcao(req, { action: 'gestao.pessoa.papel_removido', organizationId: ator(req).organizationId, resourceType: 'ge_party', resourceId: req.params.id, metadata: { role: req.params.papel } });
      return reply.code(204).send();
    }),
  );
  app.put<{ Params: { id: string } }>(`${P}/cadastros/pessoas/:id/cliente`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const b = z.object({ clientId: uuid.nullable() }).parse(req.body);
      const p = await cad.vincularCliente(ator(req), uuid.parse(req.params.id), b.clientId);
      await auditarAcao(req, { action: 'gestao.pessoa.cliente_vinculado', organizationId: p.organizationId, resourceType: 'ge_party', resourceId: p.id, metadata: { clientId: b.clientId } });
      return p;
    }),
  );

  // ── Catálogos ────────────────────────────────────────────────────────────
  app.get(`${P}/cadastros/servicos`, guard, async (req) => ({ items: await cat.listarServicos(ator(req).organizationId) }));
  app.post(`${P}/cadastros/servicos`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const b = z.object({ name: texto(200), kind: z.enum(['venda', 'compra']), unit: opt(z.string().trim().max(30)), defaultPriceCents: opt(z.number().int().min(0)) }).parse(req.body);
      const s = await cat.criarServico(ator(req), b);
      await auditarAcao(req, { action: 'gestao.servico.criado', organizationId: s.organizationId, resourceType: 'ge_service', resourceId: s.id });
      return reply.code(201).send(s);
    }),
  );
  app.patch<{ Params: { id: string } }>(`${P}/cadastros/servicos/:id`, guard, async (req, reply) =>
    tentar(reply, async () => cat.editarServico(ator(req), uuid.parse(req.params.id), z.object({ name: texto(200), unit: opt(z.string().trim().max(30)), defaultPriceCents: opt(z.number().int().min(0)), active: z.boolean() }).partial().parse(req.body) as never)),
  );

  app.get(`${P}/financeiro/contas`, guard, async (req) => ({ items: await fin.saldosDasContas(ator(req).organizationId) }));
  app.post(`${P}/financeiro/contas`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const b = z.object({ name: texto(120), kind: z.enum(['banco', 'caixa', 'carteira', 'cartao']).default('banco'), openingBalanceCents: opt(z.number().int()), openingDate: opt(dia) }).parse(req.body);
      const c = await cat.criarConta(ator(req), b);
      await auditarAcao(req, { action: 'gestao.conta.criada', organizationId: c.organizationId, resourceType: 'ge_financial_account', resourceId: c.id });
      return reply.code(201).send(c);
    }),
  );
  app.patch<{ Params: { id: string } }>(`${P}/financeiro/contas/:id`, guard, async (req, reply) =>
    tentar(reply, async () => cat.editarConta(ator(req), uuid.parse(req.params.id), z.object({ name: texto(120), active: z.boolean(), openingBalanceCents: opt(z.number().int()), openingDate: opt(dia) }).partial().parse(req.body) as never)),
  );
  app.get(`${P}/financeiro/categorias`, guard, async (req) => ({ items: await cat.listarCategorias(ator(req).organizationId) }));
  app.post(`${P}/financeiro/categorias`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const c = await cat.criarCategoria(ator(req), z.object({ name: texto(120), kind: z.enum(['receita', 'despesa']), parentId: opt(uuid) }).parse(req.body));
      await auditarAcao(req, { action: 'gestao.categoria.criada', organizationId: c.organizationId, resourceType: 'ge_category', resourceId: c.id });
      return reply.code(201).send(c);
    }),
  );
  app.patch<{ Params: { id: string } }>(`${P}/financeiro/categorias/:id`, guard, async (req, reply) =>
    tentar(reply, async () => cat.editarCategoria(ator(req), uuid.parse(req.params.id), z.object({ name: texto(120), active: z.boolean() }).partial().parse(req.body) as never)),
  );
  app.get(`${P}/financeiro/centros-de-custo`, guard, async (req) => ({ items: await cat.listarCentros(ator(req).organizationId) }));
  app.post(`${P}/financeiro/centros-de-custo`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const c = await cat.criarCentro(ator(req), z.object({ name: texto(120) }).parse(req.body));
      await auditarAcao(req, { action: 'gestao.centro_de_custo.criado', organizationId: c.organizationId, resourceType: 'ge_cost_center', resourceId: c.id });
      return reply.code(201).send(c);
    }),
  );
  app.patch<{ Params: { id: string } }>(`${P}/financeiro/centros-de-custo/:id`, guard, async (req, reply) =>
    tentar(reply, async () => cat.editarCentro(ator(req), uuid.parse(req.params.id), z.object({ name: texto(120), active: z.boolean() }).partial().parse(req.body) as never)),
  );

  // ── Lançamentos ──────────────────────────────────────────────────────────
  app.get(`${P}/financeiro/lancamentos`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const q = paginacaoSchema
        .extend({ kind: z.enum(['receita', 'despesa']).optional(), situacao: z.enum(['aberto', 'vencido', 'quitado', 'cancelado']).optional(), from: dia.optional(), to: dia.optional(), partyId: uuid.optional(), q: z.string().trim().max(100).optional() })
        .parse(req.query);
      const r = await fin.listarLancamentos(ator(req).organizationId, q);
      return { ...paginar(r.items, r.total, q.page, q.pageSize), somaCentavos: r.somaCentavos };
    }),
  );
  app.post(`${P}/financeiro/lancamentos`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const b = z.object({ kind: z.enum(['receita', 'despesa']), amountCents: centavos, parcelas: z.number().int().min(1).max(120).optional(), ...lancamentoCampos }).parse(req.body);
      const criados = await fin.criarLancamento(ator(req), b as fin.NovoLancamento);
      await auditarAcao(req, { action: 'gestao.lancamento.criado', organizationId: ator(req).organizationId, resourceType: 'ge_entry', resourceId: criados[0]!.id, metadata: { kind: b.kind, parcelas: criados.length, totalCents: b.amountCents } });
      return reply.code(201).send({ items: criados });
    }),
  );
  app.patch<{ Params: { id: string } }>(`${P}/financeiro/lancamentos/:id`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const b = z.object({ ...lancamentoCampos, description: texto(300), amountCents: centavos }).partial().parse(req.body);
      const l = await fin.editarLancamento(ator(req), uuid.parse(req.params.id), b as never);
      await auditarAcao(req, { action: 'gestao.lancamento.editado', organizationId: l.organizationId, resourceType: 'ge_entry', resourceId: l.id, metadata: { campos: Object.keys(b) } });
      return l;
    }),
  );
  app.post<{ Params: { id: string } }>(`${P}/financeiro/lancamentos/:id/baixar`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const b = z.object({ accountId: uuid, paidOn: dia, paidAmountCents: centavos.optional() }).parse(req.body);
      const l = await fin.baixarLancamento(ator(req), uuid.parse(req.params.id), b);
      await auditarAcao(req, { action: 'gestao.lancamento.baixado', organizationId: l.organizationId, resourceType: 'ge_entry', resourceId: l.id, metadata: { paidAmountCents: l.paidAmountCents, accountId: b.accountId } });
      return l;
    }),
  );
  app.post<{ Params: { id: string } }>(`${P}/financeiro/lancamentos/:id/estornar`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const b = z.object({ motivo: texto(300) }).parse(req.body);
      const l = await fin.estornarBaixa(ator(req), uuid.parse(req.params.id), b.motivo);
      await auditarAcao(req, { action: 'gestao.lancamento.estornado', organizationId: l.organizationId, resourceType: 'ge_entry', resourceId: l.id, metadata: { motivo: b.motivo } });
      return l;
    }),
  );
  app.post<{ Params: { id: string } }>(`${P}/financeiro/lancamentos/:id/cancelar`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const b = z.object({ motivo: texto(300) }).parse(req.body);
      const l = await fin.cancelarLancamento(ator(req), uuid.parse(req.params.id), b.motivo);
      await auditarAcao(req, { action: 'gestao.lancamento.cancelado', organizationId: l.organizationId, resourceType: 'ge_entry', resourceId: l.id, metadata: { motivo: b.motivo } });
      return l;
    }),
  );
  app.post(`${P}/financeiro/transferencias`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const b = z.object({ fromAccountId: uuid, toAccountId: uuid, amountCents: centavos, occurredOn: dia, memo: z.string().trim().max(300).optional() }).parse(req.body);
      const r = await fin.transferir(ator(req), b);
      await auditarAcao(req, { action: 'gestao.transferencia.criada', organizationId: ator(req).organizationId, resourceType: 'ge_ledger', resourceId: r.transferId, metadata: { amountCents: b.amountCents } });
      return reply.code(201).send(r);
    }),
  );

  // ── Recorrências ─────────────────────────────────────────────────────────
  app.get(`${P}/financeiro/recorrencias`, guard, async (req) => ({
    items: await db.select().from(schema.geRecurrences).where(eq(schema.geRecurrences.organizationId, ator(req).organizationId)),
  }));
  app.post(`${P}/financeiro/recorrencias`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const b = z
        .object({
          kind: z.enum(['receita', 'despesa']),
          description: texto(300),
          amountCents: centavos,
          frequency: z.enum(['semanal', 'mensal', 'bimestral', 'trimestral', 'semestral', 'anual']),
          startDate: dia,
          endDate: opt(dia),
          dayOfMonth: opt(z.number().int().min(1).max(31)),
          partyId: opt(uuid),
          categoryId: opt(uuid),
          costCenterId: opt(uuid),
          accountId: opt(uuid),
        })
        .parse(req.body);
      const r = await fin.criarRecorrencia(ator(req), b as fin.NovaRecorrencia);
      await auditarAcao(req, { action: 'gestao.recorrencia.criada', organizationId: r.organizationId, resourceType: 'ge_recurrence', resourceId: r.id });
      return reply.code(201).send(r);
    }),
  );
  app.post(`${P}/financeiro/recorrencias/gerar`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const b = z.object({ ate: dia, recorrenciaId: uuid.optional() }).parse(req.body);
      const r = await fin.gerarRecorrencias(ator(req), b.ate, b.recorrenciaId);
      await auditarAcao(req, { action: 'gestao.recorrencia.gerada', organizationId: ator(req).organizationId, metadata: { ate: b.ate, criados: r.criados } });
      return r;
    }),
  );

  // ── Fluxo de caixa e conciliação ─────────────────────────────────────────
  app.get(`${P}/financeiro/fluxo-de-caixa`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const org = ator(req).organizationId;
      const abertos = await db
        .select({ kind: schema.geEntries.kind, status: schema.geEntries.status, dueDate: schema.geEntries.dueDate, amountCents: schema.geEntries.amountCents })
        .from(schema.geEntries)
        .where(and(eq(schema.geEntries.organizationId, org), inArray(schema.geEntries.status, ['aberto'])));
      const saldos = await fin.saldosDasContas(org);
      const conhecidos = saldos.filter((s) => s.balanceCents !== null);
      const f = projetarFluxo(abertos as never, { hoje: hojeEmSaoPaulo(), saldoInicialCentavos: conhecidos.reduce((a, s) => a + (s.balanceCents ?? 0), 0) });
      return { ...f, contasSemSaldoInicial: saldos.length - conhecidos.length };
    }),
  );
  app.post<{ Params: { contaId: string } }>(`${P}/financeiro/extrato/:contaId/importar`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const b = z.object({ linhas: z.array(z.object({ postedOn: dia, description: z.string().trim().max(300).optional(), amountCents: z.number().int().refine((n) => n !== 0, 'Valor zero.'), externalKey: texto(120) })).min(1).max(2000) }).parse(req.body);
      const r = await fin.importarExtrato(ator(req), uuid.parse(req.params.contaId), b.linhas);
      await auditarAcao(req, { action: 'gestao.extrato.importado', organizationId: ator(req).organizationId, resourceType: 'ge_financial_account', resourceId: req.params.contaId, metadata: r });
      return r;
    }),
  );
  app.get<{ Params: { contaId: string } }>(`${P}/financeiro/extrato/:contaId/sugestoes`, guard, async (req, reply) =>
    tentar(reply, () => fin.sugestoesDeConciliacao(ator(req).organizationId, uuid.parse(req.params.contaId))),
  );
  app.post(`${P}/financeiro/conciliacao`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const b = z.object({ linhaId: uuid, ledgerId: uuid }).parse(req.body);
      const r = await fin.conciliar(ator(req), b.linhaId, b.ledgerId);
      await auditarAcao(req, { action: 'gestao.conciliacao.confirmada', organizationId: r.organizationId, resourceType: 'ge_statement_line', resourceId: r.id, metadata: { ledgerId: b.ledgerId } });
      return r;
    }),
  );
  app.delete<{ Params: { linhaId: string } }>(`${P}/financeiro/conciliacao/:linhaId`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const r = await fin.desconciliar(ator(req), uuid.parse(req.params.linhaId));
      await auditarAcao(req, { action: 'gestao.conciliacao.desfeita', organizationId: r.organizationId, resourceType: 'ge_statement_line', resourceId: r.id });
      return r;
    }),
  );
}

export { ErroDeNegocio };

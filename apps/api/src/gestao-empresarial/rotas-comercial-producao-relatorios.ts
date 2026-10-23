import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditarAcao } from '../lib/auditoria';
import { exigirGestao } from './acesso';
import { centavos, dia, paginacaoSchema, paginar, responderErro, uuid } from './http';
import { ator } from './rotas-cadastros-e-financeiro';
import * as com from './servico-comercial';
import * as pro from './servico-producao';
import * as rel from './servico-relatorios';
import { hojeEmSaoPaulo } from './dominio/datas';

const guard = { preHandler: exigirGestao };
const P = '/gestao-empresarial';
const texto = (max = 200) => z.string().trim().min(1).max(max);
const opt = <T extends z.ZodTypeAny>(s: T) => s.nullish();

async function tentar<T>(reply: Parameters<typeof responderErro>[0], fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    return responderErro(reply, e);
  }
}

const item = z.object({ description: texto(300), quantity: z.number().int().min(1).max(1_000_000), unitPriceCents: z.number().int().min(0), discountCents: z.number().int().min(0).default(0), serviceId: opt(uuid) });

export async function registrarComercialProducaoRelatorios(app: FastifyInstance): Promise<void> {
  // ── Comercial ────────────────────────────────────────────────────────────
  app.get(`${P}/comercial/propostas`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const q = paginacaoSchema.extend({ status: z.enum(['rascunho', 'enviada', 'aprovada', 'recusada', 'expirada', 'cancelada']).optional(), partyId: uuid.optional(), q: z.string().trim().max(100).optional() }).parse(req.query);
      const r = await com.listarPropostas(ator(req).organizationId, q);
      return paginar(r.items, r.total, q.page, q.pageSize);
    }),
  );
  app.get<{ Params: { id: string } }>(`${P}/comercial/propostas/:id`, guard, async (req, reply) => tentar(reply, () => com.obterProposta(ator(req).organizationId, uuid.parse(req.params.id))));
  app.post(`${P}/comercial/propostas`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const b = z.object({ partyId: opt(uuid), title: texto(300), validUntil: opt(dia), notes: opt(z.string().trim().max(4000)), items: z.array(item).max(200).default([]) }).parse(req.body);
      const p = await com.criarProposta(ator(req), b);
      await auditarAcao(req, { action: 'gestao.proposta.criada', organizationId: p.organizationId, resourceType: 'ge_proposal', resourceId: p.id, metadata: { number: p.number, totalCents: p.totalCents } });
      return reply.code(201).send(p);
    }),
  );
  app.patch<{ Params: { id: string } }>(`${P}/comercial/propostas/:id`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const b = z.object({ partyId: opt(uuid), title: texto(300), validUntil: opt(dia), notes: opt(z.string().trim().max(4000)), items: z.array(item).max(200) }).partial().parse(req.body);
      const p = await com.editarProposta(ator(req), uuid.parse(req.params.id), b);
      await auditarAcao(req, { action: 'gestao.proposta.editada', organizationId: p.organizationId, resourceType: 'ge_proposal', resourceId: p.id, metadata: { campos: Object.keys(b), totalCents: p.totalCents } });
      return p;
    }),
  );
  app.post<{ Params: { id: string } }>(`${P}/comercial/propostas/:id/status`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const b = z.object({ status: z.enum(['rascunho', 'enviada', 'aprovada', 'recusada', 'expirada', 'cancelada']) }).parse(req.body);
      const p = await com.mudarStatusProposta(ator(req), uuid.parse(req.params.id), b.status);
      await auditarAcao(req, { action: 'gestao.proposta.status_alterado', organizationId: p.organizationId, resourceType: 'ge_proposal', resourceId: p.id, metadata: { status: b.status } });
      return p;
    }),
  );
  app.get(`${P}/comercial/contratos`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const q = paginacaoSchema.extend({ status: z.enum(['rascunho', 'vigente', 'encerrado', 'cancelado']).optional() }).parse(req.query);
      const r = await com.listarContratos(ator(req).organizationId, q);
      return paginar(r.items, r.total, q.page, q.pageSize);
    }),
  );
  app.post(`${P}/comercial/contratos`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const b = z.object({ proposalId: opt(uuid), partyId: opt(uuid), title: texto(300).optional(), totalCents: z.number().int().min(0).optional(), startsOn: opt(dia), endsOn: opt(dia), notes: opt(z.string().trim().max(4000)) }).parse(req.body);
      const c = await com.criarContrato(ator(req), b);
      await auditarAcao(req, { action: 'gestao.contrato.criado', organizationId: c.organizationId, resourceType: 'ge_contract', resourceId: c.id, metadata: { number: c.number } });
      return reply.code(201).send(c);
    }),
  );
  app.post<{ Params: { id: string } }>(`${P}/comercial/contratos/:id/status`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const b = z.object({ status: z.enum(['vigente', 'encerrado', 'cancelado']) }).parse(req.body);
      const c = await com.mudarStatusContrato(ator(req), uuid.parse(req.params.id), b.status);
      await auditarAcao(req, { action: 'gestao.contrato.status_alterado', organizationId: c.organizationId, resourceType: 'ge_contract', resourceId: c.id, metadata: { status: b.status } });
      return c;
    }),
  );
  app.get(`${P}/comercial/pedidos`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const q = paginacaoSchema.extend({ status: z.enum(['aberto', 'faturado', 'cancelado']).optional() }).parse(req.query);
      const r = await com.listarPedidosDeVenda(ator(req).organizationId, q);
      return paginar(r.items, r.total, q.page, q.pageSize);
    }),
  );
  app.post(`${P}/comercial/pedidos`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const b = z.object({ proposalId: opt(uuid), contractId: opt(uuid), partyId: opt(uuid), title: texto(300).optional(), totalCents: z.number().int().min(0).optional() }).parse(req.body);
      const o = await com.criarPedidoDeVenda(ator(req), b);
      await auditarAcao(req, { action: 'gestao.pedido_de_venda.criado', organizationId: o.organizationId, resourceType: 'ge_sales_order', resourceId: o.id, metadata: { number: o.number, totalCents: o.totalCents } });
      return reply.code(201).send(o);
    }),
  );
  app.post<{ Params: { id: string } }>(`${P}/comercial/pedidos/:id/faturar`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const b = z.object({ parcelas: z.number().int().min(1).max(120).default(1), primeiroVencimento: dia, categoryId: opt(uuid), accountId: opt(uuid), costCenterId: opt(uuid) }).parse(req.body);
      const r = await com.faturarPedido(ator(req), uuid.parse(req.params.id), b);
      await auditarAcao(req, { action: 'gestao.pedido_de_venda.faturado', organizationId: ator(req).organizationId, resourceType: 'ge_sales_order', resourceId: r.pedido.id, metadata: { parcelas: r.lancamentos.length, totalCents: r.pedido.totalCents } });
      return r;
    }),
  );
  app.post<{ Params: { id: string } }>(`${P}/comercial/pedidos/:id/cancelar`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const o = await com.cancelarPedidoDeVenda(ator(req), uuid.parse(req.params.id));
      await auditarAcao(req, { action: 'gestao.pedido_de_venda.cancelado', organizationId: o.organizationId, resourceType: 'ge_sales_order', resourceId: o.id });
      return o;
    }),
  );

  // ── Produção ─────────────────────────────────────────────────────────────
  app.get(`${P}/producao/solicitacoes`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const q = paginacaoSchema.extend({ status: z.enum(['aberta', 'cotando', 'aprovada', 'cancelada']).optional() }).parse(req.query);
      const r = await pro.listarSolicitacoes(ator(req).organizationId, q);
      return paginar(r.items, r.total, q.page, q.pageSize);
    }),
  );
  app.post(`${P}/producao/solicitacoes`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const b = z.object({ partyId: opt(uuid), title: texto(300), description: opt(z.string().trim().max(4000)), dueOn: opt(dia) }).parse(req.body);
      const s = await pro.criarSolicitacao(ator(req), b);
      await auditarAcao(req, { action: 'gestao.solicitacao.criada', organizationId: s.organizationId, resourceType: 'ge_production_request', resourceId: s.id, metadata: { number: s.number } });
      return reply.code(201).send(s);
    }),
  );
  app.post<{ Params: { id: string } }>(`${P}/producao/solicitacoes/:id/cancelar`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const s = await pro.cancelarSolicitacao(ator(req), uuid.parse(req.params.id));
      await auditarAcao(req, { action: 'gestao.solicitacao.cancelada', organizationId: s.organizationId, resourceType: 'ge_production_request', resourceId: s.id });
      return s;
    }),
  );
  app.get<{ Params: { id: string } }>(`${P}/producao/solicitacoes/:id/cotacoes`, guard, async (req, reply) => tentar(reply, () => pro.compararCotacoes(ator(req).organizationId, uuid.parse(req.params.id))));
  app.post<{ Params: { id: string } }>(`${P}/producao/solicitacoes/:id/cotacoes`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const b = z.object({ supplierId: uuid, totalCents: centavos, leadTimeDays: opt(z.number().int().min(0).max(3650)), notes: opt(z.string().trim().max(2000)) }).parse(req.body);
      const c = await pro.registrarCotacao(ator(req), uuid.parse(req.params.id), b);
      await auditarAcao(req, { action: 'gestao.cotacao.registrada', organizationId: c.organizationId, resourceType: 'ge_production_quote', resourceId: c.id, metadata: { totalCents: c.totalCents } });
      return reply.code(201).send(c);
    }),
  );
  app.post<{ Params: { id: string; quoteId: string } }>(`${P}/producao/solicitacoes/:id/cotacoes/:quoteId/escolher`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const c = await pro.escolherCotacao(ator(req), uuid.parse(req.params.id), uuid.parse(req.params.quoteId));
      await auditarAcao(req, { action: 'gestao.cotacao.escolhida', organizationId: c.organizationId, resourceType: 'ge_production_quote', resourceId: c.id, metadata: { totalCents: c.totalCents } });
      return c;
    }),
  );
  app.get(`${P}/producao/pedidos`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const q = paginacaoSchema.extend({ status: z.enum(['aberta', 'em_producao', 'entregue', 'cancelada']).optional() }).parse(req.query);
      const r = await pro.listarPedidosDeProducao(ator(req).organizationId, q);
      return paginar(r.items, r.total, q.page, q.pageSize);
    }),
  );
  app.post(`${P}/producao/pedidos`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const b = z.object({ requestId: uuid, title: texto(300).optional(), saleCents: opt(z.number().int().min(0)) }).parse(req.body);
      const o = await pro.criarPedidoDeProducao(ator(req), b);
      await auditarAcao(req, { action: 'gestao.pedido_de_producao.criado', organizationId: o.organizationId, resourceType: 'ge_production_order', resourceId: o.id, metadata: { number: o.number } });
      return reply.code(201).send(o);
    }),
  );
  app.get<{ Params: { id: string } }>(`${P}/producao/pedidos/:id`, guard, async (req, reply) => tentar(reply, () => pro.resumoDoPedidoDeProducao(ator(req).organizationId, uuid.parse(req.params.id))));
  app.post<{ Params: { id: string } }>(`${P}/producao/pedidos/:id/status`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const b = z.object({ status: z.enum(['em_producao', 'entregue', 'cancelada']) }).parse(req.body);
      const o = await pro.mudarStatusPedidoDeProducao(ator(req), uuid.parse(req.params.id), b.status);
      await auditarAcao(req, { action: 'gestao.pedido_de_producao.status_alterado', organizationId: o.organizationId, resourceType: 'ge_production_order', resourceId: o.id, metadata: { status: b.status } });
      return o;
    }),
  );
  app.post<{ Params: { id: string } }>(`${P}/producao/pedidos/:id/custos`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const b = z.object({ description: texto(300), amountCents: centavos, incurredOn: opt(dia) }).parse(req.body);
      const c = await pro.adicionarCusto(ator(req), uuid.parse(req.params.id), b);
      await auditarAcao(req, { action: 'gestao.custo_de_producao.criado', organizationId: c.organizationId, resourceType: 'ge_production_cost', resourceId: c.id, metadata: { amountCents: c.amountCents } });
      return reply.code(201).send(c);
    }),
  );
  app.post<{ Params: { id: string } }>(`${P}/producao/custos/:id/gerar-despesa`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const b = z.object({ dueDate: dia, categoryId: opt(uuid), costCenterId: opt(uuid) }).parse(req.body);
      const e = await pro.gerarDespesaDoCusto(ator(req), uuid.parse(req.params.id), b);
      await auditarAcao(req, { action: 'gestao.custo_de_producao.despesa_gerada', organizationId: e.organizationId, resourceType: 'ge_entry', resourceId: e.id, metadata: { amountCents: e.amountCents } });
      return reply.code(201).send(e);
    }),
  );

  // ── Relatórios ───────────────────────────────────────────────────────────
  app.get(`${P}/visao-geral`, guard, async (req, reply) => tentar(reply, () => rel.visaoGeral(ator(req).organizationId)));
  app.get(`${P}/relatorios/atraso`, guard, async (req, reply) =>
    tentar(reply, async () => rel.atrasoPorFaixa(ator(req).organizationId, z.object({ kind: z.enum(['receita', 'despesa']).default('receita') }).parse(req.query).kind)),
  );
  app.get(`${P}/relatorios/resultado`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const hoje = hojeEmSaoPaulo();
      const q = z.object({ de: dia.default(`${hoje.slice(0, 4)}-01-01`), ate: dia.default(hoje) }).parse(req.query);
      return rel.resultadoPorCategoria(ator(req).organizationId, q.de, q.ate);
    }),
  );
  app.get(`${P}/relatorios/rentabilidade-da-producao`, guard, async (req, reply) => tentar(reply, async () => ({ items: await rel.rentabilidadeDaProducao(ator(req).organizationId) })));
  app.get(`${P}/relatorios/funil-comercial`, guard, async (req, reply) => tentar(reply, () => rel.funilComercial(ator(req).organizationId)));
  app.get(`${P}/relatorios/lancamentos.csv`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const q = z.object({ kind: z.enum(['receita', 'despesa']).optional(), situacao: z.enum(['aberto', 'vencido', 'quitado', 'cancelado']).optional(), from: dia.optional(), to: dia.optional() }).parse(req.query);
      const r = await rel.exportarLancamentosCsv(ator(req).organizationId, q);
      await auditarAcao(req, { action: 'gestao.relatorio.exportado', organizationId: ator(req).organizationId, metadata: { tipo: 'lancamentos', linhas: r.linhas, truncado: r.truncado } });
      return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="lancamentos.csv"').header('x-linhas-truncadas', String(r.truncado)).send(r.csv);
    }),
  );
}

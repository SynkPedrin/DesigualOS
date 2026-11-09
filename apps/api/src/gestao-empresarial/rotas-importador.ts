import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditarAcao } from '../lib/auditoria';
import { exigirGestao } from './acesso';
import { ErroDeNegocio, paginacaoSchema, paginar, responderErro, uuid } from './http';
import { ator } from './rotas-cadastros-e-financeiro';
import * as imp from './servico-importador';

const guard = { preHandler: exigirGestao };
const P = '/gestao-empresarial/importador';
const MAX_ARQUIVO = 10 * 1024 * 1024;

async function tentar<T>(reply: Parameters<typeof responderErro>[0], fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    return responderErro(reply, e);
  }
}

export async function registrarImportador(app: FastifyInstance): Promise<void> {
  app.get(`${P}/lotes`, guard, async (req) => ({ items: await imp.listarLotes(ator(req).organizationId) }));

  // base64 infla 4/3: o limite do corpo acompanha o limite do arquivo.
  app.post(`${P}/lotes`, { ...guard, bodyLimit: Math.ceil(MAX_ARQUIVO * 1.4) }, async (req, reply) =>
    tentar(reply, async () => {
      const b = z.object({ kind: z.enum(['clientes', 'fornecedores', 'veiculos_midia', 'lancamentos']), fileName: z.string().trim().min(1).max(200), contentBase64: z.string().min(4).regex(/^[A-Za-z0-9+/\s]+={0,2}\s*$/, 'Conteúdo não é base64 válido.') }).parse(req.body);
      const conteudo = Buffer.from(b.contentBase64, 'base64');
      if (conteudo.length === 0) throw new ErroDeNegocio(400, 'Arquivo vazio.');
      if (conteudo.length > MAX_ARQUIVO) throw new ErroDeNegocio(400, 'Arquivo maior que 10 MB.');
      const r = await imp.criarLote(ator(req), { kind: b.kind, fileName: b.fileName, conteudo });
      await auditarAcao(req, { action: 'gestao.importacao.lote_criado', organizationId: ator(req).organizationId, resourceType: 'ge_import_batch', resourceId: r.lote.id, metadata: { kind: b.kind, fileName: b.fileName, totals: r.totals } });
      return reply.code(201).send(r);
    }),
  );
  app.get<{ Params: { id: string } }>(`${P}/lotes/:id`, guard, async (req, reply) => tentar(reply, () => imp.resumoDoLote(ator(req).organizationId, uuid.parse(req.params.id))));
  app.get<{ Params: { id: string } }>(`${P}/lotes/:id/linhas`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const q = paginacaoSchema.extend({ status: z.enum(['novo', 'duplicado_provavel', 'invalido', 'precisa_vinculo', 'aplicado', 'ignorado']).optional(), aviso: z.string().max(80).optional() }).parse(req.query);
      const r = await imp.listarLinhas(ator(req).organizationId, uuid.parse(req.params.id), q);
      return paginar(r.items, r.total, q.page, q.pageSize);
    }),
  );
  app.post<{ Params: { id: string } }>(`${P}/lotes/:id/vincular-por-documento`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const r = await imp.vincularPorDocumento(ator(req), uuid.parse(req.params.id));
      await auditarAcao(req, { action: 'gestao.importacao.vinculo_por_documento', organizationId: ator(req).organizationId, resourceType: 'ge_import_batch', resourceId: req.params.id, metadata: r });
      return r;
    }),
  );
  app.put<{ Params: { id: string; rowId: string } }>(`${P}/lotes/:id/linhas/:rowId/decisao`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const b = z.discriminatedUnion('acao', [z.object({ acao: z.literal('vincular'), partyId: uuid }), z.object({ acao: z.literal('ignorar') })]).parse(req.body);
      const r = await imp.decidirLinha(ator(req), uuid.parse(req.params.id), uuid.parse(req.params.rowId), b);
      await auditarAcao(req, { action: 'gestao.importacao.linha_decidida', organizationId: ator(req).organizationId, resourceType: 'ge_import_row', resourceId: r.id, metadata: { acao: b.acao } });
      return r;
    }),
  );
  app.get<{ Params: { id: string } }>(`${P}/lotes/:id/cedentes`, guard, async (req, reply) => tentar(reply, () => imp.cedentesDoLote(ator(req).organizationId, uuid.parse(req.params.id))));
  app.put<{ Params: { id: string } }>(`${P}/lotes/:id/cedentes`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const b = z.object({ label: z.string().trim().min(1).max(300), partyId: uuid.nullable() }).parse(req.body);
      const r = await imp.vincularCedente(ator(req), uuid.parse(req.params.id), b);
      await auditarAcao(req, { action: 'gestao.importacao.cedente_vinculado', organizationId: ator(req).organizationId, resourceType: 'ge_import_batch', resourceId: req.params.id, metadata: { partyId: b.partyId, linhas: r.atualizadas } });
      return r;
    }),
  );
  app.post<{ Params: { id: string } }>(`${P}/lotes/:id/aplicar`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const r = await imp.aplicarLote(ator(req), uuid.parse(req.params.id));
      await auditarAcao(req, { action: 'gestao.importacao.lote_aplicado', organizationId: ator(req).organizationId, resourceType: 'ge_import_batch', resourceId: req.params.id, metadata: r });
      return r;
    }),
  );
  app.post<{ Params: { id: string } }>(`${P}/lotes/:id/descartar`, guard, async (req, reply) =>
    tentar(reply, async () => {
      const r = await imp.descartarLote(ator(req), uuid.parse(req.params.id));
      await auditarAcao(req, { action: 'gestao.importacao.lote_descartado', organizationId: ator(req).organizationId, resourceType: 'ge_import_batch', resourceId: r.id });
      return r;
    }),
  );
}

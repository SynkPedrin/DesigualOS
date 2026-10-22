import { and, asc, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { ErroDeNegocio, semUndefined } from './http';
import type { Ator } from './servico-financeiro';

const { geFinancialAccounts, geCategories, geCostCenters, geServices } = schema;

const nomeUnico = (erro: unknown, o: string) => {
  if ((erro as { code?: string | undefined}).code === '23505') throw new ErroDeNegocio(409, `Já existe ${o} com este nome.`);
  throw erro;
};

export const listarContas = (org: string) => db.select().from(geFinancialAccounts).where(eq(geFinancialAccounts.organizationId, org)).orderBy(asc(geFinancialAccounts.name));
export const criarConta = (a: Ator, d: { name: string; kind: string; openingBalanceCents?: number | null | undefined; openingDate?: string | null | undefined}) =>
  db.insert(geFinancialAccounts).values({ organizationId: a.organizationId, name: d.name.trim(), kind: d.kind, openingBalanceCents: d.openingBalanceCents ?? null, openingDate: d.openingDate ?? null }).returning().then((r) => r[0]!).catch((e) => nomeUnico(e, 'uma conta'));
export async function editarConta(a: Ator, id: string, d: { name?: string | undefined; active?: boolean | undefined; openingBalanceCents?: number | null | undefined; openingDate?: string | null | undefined}) {
  const [l] = await db.update(geFinancialAccounts).set(semUndefined(d)).where(and(eq(geFinancialAccounts.id, id), eq(geFinancialAccounts.organizationId, a.organizationId))).returning().catch((e) => nomeUnico(e, 'uma conta'));
  if (!l) throw new ErroDeNegocio(404, 'Conta não encontrada.');
  return l;
}

export const listarCategorias = (org: string) => db.select().from(geCategories).where(eq(geCategories.organizationId, org)).orderBy(asc(geCategories.kind), asc(geCategories.name));
export async function criarCategoria(a: Ator, d: { name: string; kind: 'receita' | 'despesa'; parentId?: string | null | undefined}) {
  if (d.parentId) {
    const [pai] = await db.select().from(geCategories).where(and(eq(geCategories.id, d.parentId), eq(geCategories.organizationId, a.organizationId))).limit(1);
    if (!pai) throw new ErroDeNegocio(404, 'Categoria pai não encontrada.');
    if (pai.kind !== d.kind) throw new ErroDeNegocio(409, 'A subcategoria precisa ser do mesmo tipo (receita ou despesa) da categoria pai.');
  }
  const [l] = await db.insert(geCategories).values({ organizationId: a.organizationId, name: d.name.trim(), kind: d.kind, parentId: d.parentId ?? null }).returning().catch((e) => nomeUnico(e, 'uma categoria'));
  return l!;
}
export async function editarCategoria(a: Ator, id: string, d: { name?: string | undefined; active?: boolean | undefined}) {
  const [l] = await db.update(geCategories).set(semUndefined(d)).where(and(eq(geCategories.id, id), eq(geCategories.organizationId, a.organizationId))).returning().catch((e) => nomeUnico(e, 'uma categoria'));
  if (!l) throw new ErroDeNegocio(404, 'Categoria não encontrada.');
  return l;
}

export const listarCentros = (org: string) => db.select().from(geCostCenters).where(eq(geCostCenters.organizationId, org)).orderBy(asc(geCostCenters.name));
export const criarCentro = (a: Ator, d: { name: string }) => db.insert(geCostCenters).values({ organizationId: a.organizationId, name: d.name.trim() }).returning().then((r) => r[0]!).catch((e) => nomeUnico(e, 'um centro de custo'));
export async function editarCentro(a: Ator, id: string, d: { name?: string | undefined; active?: boolean | undefined}) {
  const [l] = await db.update(geCostCenters).set(semUndefined(d)).where(and(eq(geCostCenters.id, id), eq(geCostCenters.organizationId, a.organizationId))).returning().catch((e) => nomeUnico(e, 'um centro de custo'));
  if (!l) throw new ErroDeNegocio(404, 'Centro de custo não encontrado.');
  return l;
}

export const listarServicos = (org: string) => db.select().from(geServices).where(eq(geServices.organizationId, org)).orderBy(asc(geServices.name));
export const criarServico = (a: Ator, d: { name: string; kind: 'venda' | 'compra'; unit?: string | null | undefined; defaultPriceCents?: number | null | undefined}) =>
  db.insert(geServices).values({ organizationId: a.organizationId, name: d.name.trim(), kind: d.kind, unit: d.unit ?? null, defaultPriceCents: d.defaultPriceCents ?? null }).returning().then((r) => r[0]!);
export async function editarServico(a: Ator, id: string, d: { name?: string | undefined; unit?: string | null | undefined; defaultPriceCents?: number | null | undefined; active?: boolean | undefined}) {
  const [l] = await db.update(geServices).set(semUndefined(d)).where(and(eq(geServices.id, id), eq(geServices.organizationId, a.organizationId))).returning();
  if (!l) throw new ErroDeNegocio(404, 'Serviço não encontrado.');
  return l;
}

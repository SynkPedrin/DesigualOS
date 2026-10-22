import { and, asc, count, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { ErroDeNegocio, semUndefined, type Parcial } from './http';
import { emailValido, lerDocumento, textoOuNulo } from './dominio/documentos';
import type { Ator } from './servico-financeiro';

const { geParties, gePartyRoles, geMediaVehicles, clients } = schema;

export const PAPEIS = ['cliente', 'fornecedor', 'veiculo_midia', 'prestador', 'colaborador'] as const;
export type Papel = (typeof PAPEIS)[number];

export interface NovaPessoa {
  name: string;
  legalName?: string | null | undefined;
  document?: string | null | undefined;
  email?: string | null | undefined;
  phone?: string | null | undefined;
  city?: string | null | undefined;
  state?: string | null | undefined;
  notes?: string | null | undefined;
  roles: Papel[];
  mediaType?: string | null | undefined;
}

/** Já existe cadastro com este documento? Devolve o id para a tela ABRIR o existente em vez de duplicar. */
async function existenteComDocumento(organizationId: string, documento: string, ignorarId?: string) {
  const [linha] = await db
    .select({ id: geParties.id, name: geParties.name })
    .from(geParties)
    .where(and(eq(geParties.organizationId, organizationId), eq(geParties.document, documento), ignorarId ? sql`${geParties.id} <> ${ignorarId}` : undefined))
    .limit(1);
  return linha ?? null;
}

function camposNormalizados(e: Parcial<NovaPessoa>) {
  const email = e.email === undefined ? undefined : textoOuNulo(e.email);
  if (email && !emailValido(email)) throw new ErroDeNegocio(400, 'E-mail com formato inválido.');
  const doc = e.document === undefined ? undefined : lerDocumento(e.document);
  return {
    ...(e.name !== undefined && { name: e.name.trim() }),
    ...(e.legalName !== undefined && { legalName: textoOuNulo(e.legalName) }),
    ...(doc !== undefined && { document: doc.document, rawDocument: textoOuNulo(e.document), documentKind: doc.kind, documentValid: doc.valid }),
    ...(email !== undefined && { email }),
    ...(e.phone !== undefined && { phone: textoOuNulo(e.phone) }),
    ...(e.city !== undefined && { city: textoOuNulo(e.city) }),
    ...(e.state !== undefined && { state: textoOuNulo(e.state)?.toUpperCase() ?? null }),
    ...(e.notes !== undefined && { notes: textoOuNulo(e.notes) }),
  };
}

export async function criarPessoa(ator: Ator, e: NovaPessoa) {
  const campos = camposNormalizados(e);
  if (campos.document) {
    const outro = await existenteComDocumento(ator.organizationId, campos.document);
    if (outro) throw new ErroDeNegocio(409, `Já existe um cadastro com este documento ("${outro.name}"). Abra o existente e acrescente o papel, em vez de duplicar.`);
  }
  return db.transaction(async (tx) => {
    const [pessoa] = await tx
      .insert(geParties)
      .values({ organizationId: ator.organizationId, createdBy: ator.userId, ...campos, name: campos.name ?? e.name.trim() })
      .returning();
    const papeis = [...new Set(e.roles)];
    if (papeis.length > 0) await tx.insert(gePartyRoles).values(papeis.map((role) => ({ organizationId: ator.organizationId, partyId: pessoa!.id, role })));
    if (papeis.includes('veiculo_midia')) await tx.insert(geMediaVehicles).values({ organizationId: ator.organizationId, partyId: pessoa!.id, mediaType: textoOuNulo(e.mediaType) });
    return { ...pessoa!, roles: papeis };
  });
}

export async function editarPessoa(ator: Ator, id: string, e: Parcial<Omit<NovaPessoa, 'roles'>>) {
  const campos = camposNormalizados(e);
  if (campos.document) {
    const outro = await existenteComDocumento(ator.organizationId, campos.document, id);
    if (outro) throw new ErroDeNegocio(409, `Já existe um cadastro com este documento ("${outro.name}").`);
  }
  if (Object.keys(campos).length === 0 && e.mediaType === undefined) throw new ErroDeNegocio(400, 'Nada para alterar.');
  const [linha] = Object.keys(campos).length
    ? await db.update(geParties).set(campos).where(and(eq(geParties.id, id), eq(geParties.organizationId, ator.organizationId))).returning()
    : await db.select().from(geParties).where(and(eq(geParties.id, id), eq(geParties.organizationId, ator.organizationId)));
  if (!linha) throw new ErroDeNegocio(404, 'Cadastro não encontrado.');
  if (e.mediaType !== undefined) {
    await db
      .insert(geMediaVehicles)
      .values({ organizationId: ator.organizationId, partyId: id, mediaType: textoOuNulo(e.mediaType) })
      .onConflictDoUpdate({ target: geMediaVehicles.partyId, set: { mediaType: textoOuNulo(e.mediaType) } });
  }
  return linha;
}

/** Cadastro não se apaga: arquiva. Lançamentos e propostas continuam apontando para ele. */
export async function arquivarPessoa(ator: Ator, id: string, arquivar: boolean) {
  const [linha] = await db
    .update(geParties)
    .set({ status: arquivar ? 'inativo' : 'ativo', archivedAt: arquivar ? new Date() : null })
    .where(and(eq(geParties.id, id), eq(geParties.organizationId, ator.organizationId)))
    .returning();
  if (!linha) throw new ErroDeNegocio(404, 'Cadastro não encontrado.');
  return linha;
}

export async function adicionarPapel(ator: Ator, id: string, papel: Papel) {
  const [pessoa] = await db.select({ id: geParties.id }).from(geParties).where(and(eq(geParties.id, id), eq(geParties.organizationId, ator.organizationId))).limit(1);
  if (!pessoa) throw new ErroDeNegocio(404, 'Cadastro não encontrado.');
  await db.insert(gePartyRoles).values({ organizationId: ator.organizationId, partyId: id, role: papel }).onConflictDoNothing();
  if (papel === 'veiculo_midia') await db.insert(geMediaVehicles).values({ organizationId: ator.organizationId, partyId: id }).onConflictDoNothing();
}

export async function removerPapel(ator: Ator, id: string, papel: Papel) {
  const [pessoa] = await db.select({ id: geParties.id }).from(geParties).where(and(eq(geParties.id, id), eq(geParties.organizationId, ator.organizationId))).limit(1);
  if (!pessoa) throw new ErroDeNegocio(404, 'Cadastro não encontrado.');
  await db.delete(gePartyRoles).where(and(eq(gePartyRoles.partyId, id), eq(gePartyRoles.role, papel)));
}

/** Vínculo EXPLÍCITO com o cliente do Desigual OS. O cliente tem de ser da mesma organização. */
export async function vincularCliente(ator: Ator, id: string, clientId: string | null) {
  if (clientId) {
    const [c] = await db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, clientId), eq(clients.organizationId, ator.organizationId), isNull(clients.deletedAt))).limit(1);
    if (!c) throw new ErroDeNegocio(404, 'Cliente não encontrado.');
  }
  const [linha] = await db.update(geParties).set({ clientId }).where(and(eq(geParties.id, id), eq(geParties.organizationId, ator.organizationId))).returning();
  if (!linha) throw new ErroDeNegocio(404, 'Cadastro não encontrado.');
  return linha;
}

export interface FiltroDePessoas {
  role?: Papel | undefined;
  status?: 'ativo' | 'inativo' | undefined;
  q?: string | undefined;
  semDocumento?: boolean | undefined;
  documentoInvalido?: boolean | undefined;
  page: number;
  pageSize: number;
}

export async function listarPessoas(organizationId: string, f: FiltroDePessoas) {
  const filtros = [eq(geParties.organizationId, organizationId)];
  if (f.status) filtros.push(eq(geParties.status, f.status));
  if (f.role) filtros.push(sql`exists (select 1 from ge_party_roles r where r.party_id = ge_parties.id and r.role = ${f.role})`);
  if (f.semDocumento) filtros.push(isNull(geParties.document));
  if (f.documentoInvalido) filtros.push(eq(geParties.documentValid, false));
  if (f.q) {
    const termo = `%${f.q.replace(/[%_\\]/g, '\\$&')}%`;
    const digitos = f.q.replace(/\D/g, '');
    filtros.push(or(ilike(geParties.name, termo), ilike(geParties.legalName, termo), ilike(geParties.email, termo), digitos.length >= 3 ? ilike(geParties.document, `%${digitos}%`) : undefined)!);
  }
  const onde = and(...filtros);
  const [[tot], linhas] = await Promise.all([
    db.select({ n: count() }).from(geParties).where(onde),
    db.select().from(geParties).where(onde).orderBy(asc(geParties.name), asc(geParties.id)).limit(f.pageSize).offset((f.page - 1) * f.pageSize),
  ]);
  const papeis = linhas.length
    ? await db.select({ partyId: gePartyRoles.partyId, role: gePartyRoles.role }).from(gePartyRoles).where(inArray(gePartyRoles.partyId, linhas.map((l) => l.id)))
    : [];
  const porPessoa = new Map<string, string[]>();
  for (const p of papeis) porPessoa.set(p.partyId, [...(porPessoa.get(p.partyId) ?? []), p.role]);
  return { total: tot?.n ?? 0, items: linhas.map((l) => ({ ...l, roles: (porPessoa.get(l.id) ?? []).sort() })) };
}

export async function obterPessoa(organizationId: string, id: string) {
  const [pessoa] = await db.select().from(geParties).where(and(eq(geParties.id, id), eq(geParties.organizationId, organizationId))).limit(1);
  if (!pessoa) throw new ErroDeNegocio(404, 'Cadastro não encontrado.');
  const [papeis, [veiculo]] = await Promise.all([
    db.select({ role: gePartyRoles.role }).from(gePartyRoles).where(eq(gePartyRoles.partyId, id)),
    db.select().from(geMediaVehicles).where(eq(geMediaVehicles.partyId, id)).limit(1),
  ]);
  return { ...pessoa, roles: papeis.map((p) => p.role).sort(), mediaType: veiculo?.mediaType ?? null };
}

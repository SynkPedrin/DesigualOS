import { createHash } from 'node:crypto';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { ErroDeNegocio } from './http';
import { normalizarNome } from './dominio/documentos';
import { lerArquivoDoLote, PAPEL_DO_TIPO, prepararCadastros, prepararLancamentos, type LinhaPreparada, type TipoDeLote } from './importador/normalizar';
import type { Ator } from './servico-financeiro';

const { geImportBatches, geImportRows, geParties, gePartyRoles, geMediaVehicles, geEntries } = schema;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const PENDENTES = ['novo', 'duplicado_provavel', 'precisa_vinculo'] as const;
const em = (n: number) => Array.from({ length: Math.ceil(n / 500) }, (_, i) => i * 500);
const pedacos = <T>(xs: T[], n = 500): T[][] => em(xs.length).map((i) => xs.slice(i, i + n));

type Normalizado = Record<string, unknown>;
const txt = (n: Normalizado, k: string) => (typeof n[k] === 'string' ? (n[k] as string) : null);

/** Contagem por situação, para o resumo do lote. */
async function contagens(batchId: string) {
  const linhas = await db.select({ status: geImportRows.status, n: count() }).from(geImportRows).where(eq(geImportRows.batchId, batchId)).groupBy(geImportRows.status);
  return Object.fromEntries(linhas.map((l) => [l.status, l.n])) as Record<string, number>;
}

export async function criarLote(ator: Ator, entrada: { kind: TipoDeLote; fileName: string; conteudo: Buffer }) {
  const sha256 = createHash('sha256').update(entrada.conteudo).digest('hex');
  const [mesmo] = await db
    .select({ id: geImportBatches.id, createdAt: geImportBatches.createdAt })
    .from(geImportBatches)
    .where(and(eq(geImportBatches.organizationId, ator.organizationId), eq(geImportBatches.kind, entrada.kind), eq(geImportBatches.sha256, sha256)))
    .limit(1);
  if (mesmo) throw new ErroDeNegocio(409, `Este arquivo já foi importado (lote ${mesmo.id}, em ${mesmo.createdAt.toISOString().slice(0, 10)}). Reimportar o mesmo arquivo não faz nada de novo.`);

  const bruto = await lerArquivoDoLote(entrada.kind, entrada.fileName, entrada.conteudo);
  const preparadas: LinhaPreparada[] = entrada.kind === 'lancamentos' ? prepararLancamentos(bruto) : prepararCadastros(entrada.kind, bruto);
  if (preparadas.length === 0) throw new ErroDeNegocio(422, 'O arquivo não tem nenhuma linha de dados.');

  // O que JÁ existe no sistema: cadastro pelo documento, lançamento pela chave de origem.
  const jaExiste = new Set<string>();
  const donoDoDocumento = new Map<string, string>();
  if (entrada.kind === 'lancamentos') {
    for (const parte of pedacos(preparadas.map((l) => l.sourceKey))) {
      const achados = await db.select({ k: geEntries.sourceKey }).from(geEntries).where(and(eq(geEntries.organizationId, ator.organizationId), eq(geEntries.source, 'operand'), inArray(geEntries.sourceKey, parte)));
      achados.forEach((a) => a.k && jaExiste.add(a.k));
    }
  } else {
    const docs = [...new Set(preparadas.map((l) => txt(l.normalized, 'document')).filter((d): d is string => !!d))];
    for (const parte of pedacos(docs)) {
      const achados = await db.select({ id: geParties.id, d: geParties.document }).from(geParties).where(and(eq(geParties.organizationId, ator.organizationId), inArray(geParties.document, parte)));
      achados.forEach((a) => a.d && donoDoDocumento.set(a.d, a.id));
    }
  }

  const linhas = preparadas.map((l) => {
    const doc = txt(l.normalized, 'document');
    if (entrada.kind === 'lancamentos' && jaExiste.has(l.sourceKey)) return { ...l, status: 'ignorado' as const, issues: [...l.issues, 'ja_importado'] };
    if (doc && donoDoDocumento.has(doc) && l.status !== 'invalido') {
      return { ...l, status: 'duplicado_provavel' as const, issues: [...l.issues, 'documento_ja_cadastrado'], normalized: { ...l.normalized, matchPartyId: donoDoDocumento.get(doc) } };
    }
    return l;
  });

  return db.transaction(async (tx) => {
    const totals: Record<string, number> = {};
    for (const l of linhas) totals[l.status] = (totals[l.status] ?? 0) + 1;
    totals['total'] = linhas.length;
    const [lote] = await tx.insert(geImportBatches).values({ organizationId: ator.organizationId, kind: entrada.kind, fileName: entrada.fileName, sha256, totals, createdBy: ator.userId }).returning();
    for (const parte of pedacos(linhas)) {
      await tx.insert(geImportRows).values(parte.map((l) => ({ organizationId: ator.organizationId, batchId: lote!.id, rowNo: l.rowNo, sourceKey: l.sourceKey, raw: l.raw, normalized: l.normalized, status: l.status, issues: l.issues })));
    }
    return { lote: lote!, totals };
  });
}

export async function listarLotes(organizationId: string) {
  return db.select().from(geImportBatches).where(eq(geImportBatches.organizationId, organizationId)).orderBy(desc(geImportBatches.createdAt)).limit(100);
}

async function carregarLote(organizationId: string, id: string, ex: typeof db | Tx = db) {
  const [lote] = await ex.select().from(geImportBatches).where(and(eq(geImportBatches.id, id), eq(geImportBatches.organizationId, organizationId))).limit(1);
  if (!lote) throw new ErroDeNegocio(404, 'Lote não encontrado.');
  return lote;
}

export async function resumoDoLote(organizationId: string, id: string) {
  const lote = await carregarLote(organizationId, id);
  const avisos = await db.execute<{ aviso: string; n: number }>(sql`
    select aviso, count(*)::int as n
    from ge_import_rows r, jsonb_array_elements_text(r.issues) as aviso
    where r.batch_id = ${id} group by aviso order by n desc`);
  return { lote, porSituacao: await contagens(id), avisos: [...avisos] };
}

export async function listarLinhas(organizationId: string, id: string, f: { status?: string | undefined; aviso?: string | undefined; page: number; pageSize: number }) {
  await carregarLote(organizationId, id);
  const filtros = [eq(geImportRows.batchId, id)];
  if (f.status) filtros.push(eq(geImportRows.status, f.status));
  if (f.aviso) filtros.push(sql`${geImportRows.issues} ? ${f.aviso}`);
  const onde = and(...filtros);
  const [[tot], items] = await Promise.all([
    db.select({ n: count() }).from(geImportRows).where(onde),
    db.select().from(geImportRows).where(onde).orderBy(asc(geImportRows.rowNo)).limit(f.pageSize).offset((f.page - 1) * f.pageSize),
  ]);
  return { total: tot?.n ?? 0, items };
}

/**
 * Liga, de uma vez, as linhas "duplicado provável" ao cadastro que TEM O MESMO DOCUMENTO. Só
 * documento: nome igual nunca liga nada. É uma ação explícita da pessoa, não um efeito colateral.
 */
export async function vincularPorDocumento(ator: Ator, id: string) {
  const lote = await carregarLote(ator.organizationId, id);
  if (lote.kind === 'lancamentos') throw new ErroDeNegocio(409, 'Lançamentos não têm documento para vincular.');
  const r = await db.execute<{ id: string }>(sql`
    update ge_import_rows r set resolved_party_id = p.id, decided_by = ${ator.userId}, decided_at = now()
    from ge_parties p
    where r.batch_id = ${id} and r.status = 'duplicado_provavel' and r.resolved_party_id is null
      and p.organization_id = ${ator.organizationId} and p.document = r.normalized->>'document'
    returning r.id`);
  return { vinculadas: r.length };
}

export async function decidirLinha(ator: Ator, id: string, rowId: string, decisao: { acao: 'vincular'; partyId: string } | { acao: 'ignorar' }) {
  await carregarLote(ator.organizationId, id);
  const [linha] = await db.select().from(geImportRows).where(and(eq(geImportRows.id, rowId), eq(geImportRows.batchId, id))).limit(1);
  if (!linha) throw new ErroDeNegocio(404, 'Linha não encontrada.');
  if (linha.status === 'aplicado') throw new ErroDeNegocio(409, 'Esta linha já foi aplicada.');
  if (decisao.acao === 'ignorar') {
    const [l] = await db.update(geImportRows).set({ status: 'ignorado', decidedBy: ator.userId, decidedAt: new Date() }).where(eq(geImportRows.id, rowId)).returning();
    return l!;
  }
  const [p] = await db.select({ id: geParties.id }).from(geParties).where(and(eq(geParties.id, decisao.partyId), eq(geParties.organizationId, ator.organizationId))).limit(1);
  if (!p) throw new ErroDeNegocio(404, 'Cadastro não encontrado.');
  const volta = linha.status === 'precisa_vinculo' ? 'novo' : linha.status;
  const [l] = await db.update(geImportRows).set({ resolvedPartyId: p.id, status: volta, decidedBy: ator.userId, decidedAt: new Date() }).where(eq(geImportRows.id, rowId)).returning();
  return l!;
}

/** Cedentes distintos de um lote de lançamentos, com os candidatos de NOME EXATO. Sugerir não vincula. */
export async function cedentesDoLote(organizationId: string, id: string) {
  const lote = await carregarLote(organizationId, id);
  if (lote.kind !== 'lancamentos') throw new ErroDeNegocio(409, 'Só lotes de lançamentos têm cedentes.');
  const grupos = await db.execute<{ rotulo: string; linhas: number; total: string }>(sql`
    select normalized->>'partyLabel' as rotulo, count(*)::int as linhas, sum((normalized->>'amountCents')::bigint)::text as total
    from ge_import_rows where batch_id = ${id} and status = 'precisa_vinculo'
    group by 1 order by 2 desc, 1`);
  const cadastros = await db
    .select({ id: geParties.id, name: geParties.name, legalName: geParties.legalName })
    .from(geParties)
    .where(eq(geParties.organizationId, organizationId));
  const papeis = await db.select({ partyId: gePartyRoles.partyId, role: gePartyRoles.role }).from(gePartyRoles).where(eq(gePartyRoles.organizationId, organizationId));
  const porId = new Map<string, string[]>();
  papeis.forEach((p) => porId.set(p.partyId, [...(porId.get(p.partyId) ?? []), p.role]));
  const porNome = new Map<string, typeof cadastros>();
  for (const c of cadastros) for (const n of new Set([normalizarNome(c.name), normalizarNome(c.legalName)].filter(Boolean))) porNome.set(n, [...(porNome.get(n) ?? []), c]);
  return {
    items: [...grupos].map((g) => ({
      label: g.rotulo,
      linhas: g.linhas,
      totalCents: Number(g.total),
      candidatos: (porNome.get(normalizarNome(g.rotulo)) ?? []).map((c) => ({ id: c.id, name: c.name, roles: (porId.get(c.id) ?? []).sort() })),
    })),
  };
}

/** Decide quem é o cedente: um cadastro, ou "importar sem vínculo" (partyId nulo, texto preservado). */
export async function vincularCedente(ator: Ator, id: string, dados: { label: string; partyId: string | null }) {
  const lote = await carregarLote(ator.organizationId, id);
  if (lote.kind !== 'lancamentos') throw new ErroDeNegocio(409, 'Só lotes de lançamentos têm cedentes.');
  if (dados.partyId) {
    const [p] = await db.select({ id: geParties.id }).from(geParties).where(and(eq(geParties.id, dados.partyId), eq(geParties.organizationId, ator.organizationId))).limit(1);
    if (!p) throw new ErroDeNegocio(404, 'Cadastro não encontrado.');
  }
  const r = await db
    .update(geImportRows)
    .set({ resolvedPartyId: dados.partyId, status: 'novo', decidedBy: ator.userId, decidedAt: new Date() })
    .where(and(eq(geImportRows.batchId, id), eq(geImportRows.status, 'precisa_vinculo'), sql`${geImportRows.normalized}->>'partyLabel' = ${dados.label}`))
    .returning({ id: geImportRows.id });
  if (r.length === 0) throw new ErroDeNegocio(404, 'Nenhuma linha pendente com esse cedente.');
  return { atualizadas: r.length };
}

export async function aplicarLote(ator: Ator, id: string) {
  return db.transaction(async (tx) => {
    // Trava o lote: duas aplicações simultâneas esperam uma pela outra e a segunda já encontra tudo aplicado.
    const [lote] = await tx.select().from(geImportBatches).where(and(eq(geImportBatches.id, id), eq(geImportBatches.organizationId, ator.organizationId))).for('update').limit(1);
    if (!lote) throw new ErroDeNegocio(404, 'Lote não encontrado.');
    if (lote.status !== 'em_staging') throw new ErroDeNegocio(409, lote.status === 'aplicado' ? 'Este lote já foi aplicado.' : 'Este lote foi descartado.');

    const resultado = { criados: 0, vinculados: 0, jaExistiam: 0, adiados: 0 };
    const linhas = await tx.select().from(geImportRows).where(and(eq(geImportRows.batchId, id), inArray(geImportRows.status, ['novo', 'duplicado_provavel']))).orderBy(asc(geImportRows.rowNo));
    if (lote.kind === 'lancamentos') await aplicarLancamentos(tx, ator, linhas, resultado);
    else await aplicarCadastros(tx, ator, lote.kind as Exclude<TipoDeLote, 'lancamentos'>, linhas, resultado);

    const restantes = await tx.select({ n: count() }).from(geImportRows).where(and(eq(geImportRows.batchId, id), inArray(geImportRows.status, [...PENDENTES])));
    const aberto = (restantes[0]?.n ?? 0) > 0;
    const porSituacao = Object.fromEntries((await tx.select({ s: geImportRows.status, n: count() }).from(geImportRows).where(eq(geImportRows.batchId, id)).groupBy(geImportRows.status)).map((x) => [x.s, x.n]));
    await tx.update(geImportBatches).set({ totals: { ...porSituacao, total: Object.values(porSituacao).reduce((a, b) => a + b, 0) }, ...(aberto ? {} : { status: 'aplicado', appliedAt: new Date() }) }).where(eq(geImportBatches.id, id));
    return { ...resultado, pendentes: restantes[0]?.n ?? 0, loteConcluido: !aberto };
  });
}

type Contagem = { criados: number; vinculados: number; jaExistiam: number; adiados: number };

async function aplicarCadastros(tx: Tx, ator: Ator, tipo: Exclude<TipoDeLote, 'lancamentos'>, linhas: Array<typeof geImportRows.$inferSelect>, c: Contagem) {
  const papel = PAPEL_DO_TIPO[tipo];
  const garantirPapel = async (partyId: string) => {
    await tx.insert(gePartyRoles).values({ organizationId: ator.organizationId, partyId, role: papel }).onConflictDoNothing();
    if (papel === 'veiculo_midia') await tx.insert(geMediaVehicles).values({ organizationId: ator.organizationId, partyId }).onConflictDoNothing();
  };
  for (const l of linhas) {
    const n = l.normalized as Normalizado;
    if (l.status === 'duplicado_provavel') {
      // Só age com decisão humana. Vincular ACRESCENTA o papel; nenhum campo do cadastro existente é sobrescrito.
      if (!l.resolvedPartyId) {
        c.adiados++;
        continue;
      }
      await garantirPapel(l.resolvedPartyId);
      await tx.update(geImportRows).set({ status: 'aplicado', appliedId: l.resolvedPartyId }).where(eq(geImportRows.id, l.id));
      c.vinculados++;
      continue;
    }
    const doc = txt(n, 'document');
    if (doc) {
      // Pode ter sido criado depois da prévia (outra linha deste lote, outro lote): não duplica, devolve para decisão.
      const [existente] = await tx.select({ id: geParties.id }).from(geParties).where(and(eq(geParties.organizationId, ator.organizationId), eq(geParties.document, doc))).limit(1);
      if (existente) {
        await tx.update(geImportRows).set({ status: 'duplicado_provavel', issues: sql`case when ${geImportRows.issues} ? 'documento_ja_cadastrado' then ${geImportRows.issues} else ${geImportRows.issues} || '["documento_ja_cadastrado"]'::jsonb end`, normalized: { ...n, matchPartyId: existente.id } }).where(eq(geImportRows.id, l.id));
        c.adiados++;
        continue;
      }
    }
    const [criado] = await tx
      .insert(geParties)
      .values({
        organizationId: ator.organizationId,
        name: txt(n, 'name')!,
        legalName: txt(n, 'legalName'),
        document: doc,
        rawDocument: txt(n, 'rawDocument'),
        documentKind: txt(n, 'documentKind'),
        documentValid: typeof n['documentValid'] === 'boolean' ? (n['documentValid'] as boolean) : null,
        email: txt(n, 'email'),
        phone: txt(n, 'phone'),
        city: txt(n, 'city'),
        state: txt(n, 'state'),
        status: n['active'] === false ? 'inativo' : 'ativo',
        source: 'operand',
        sourceKey: `${tipo}:${l.sourceKey}`,
        createdBy: ator.userId,
      })
      .onConflictDoNothing()
      .returning({ id: geParties.id });
    if (!criado) {
      await tx.update(geImportRows).set({ status: 'ignorado', issues: sql`${geImportRows.issues} || '["ja_importado"]'::jsonb` }).where(eq(geImportRows.id, l.id));
      c.jaExistiam++;
      continue;
    }
    await garantirPapel(criado.id);
    await tx.update(geImportRows).set({ status: 'aplicado', appliedId: criado.id }).where(eq(geImportRows.id, l.id));
    c.criados++;
  }
}

async function aplicarLancamentos(tx: Tx, ator: Ator, linhas: Array<typeof geImportRows.$inferSelect>, c: Contagem) {
  for (const l of linhas) {
    const n = l.normalized as Normalizado;
    const status = txt(n, 'status') as 'aberto' | 'quitado' | 'cancelado';
    const [criado] = await tx
      .insert(geEntries)
      .values({
        organizationId: ator.organizationId,
        kind: txt(n, 'kind')!,
        partyId: l.resolvedPartyId,
        partyLabel: txt(n, 'partyLabel'),
        description: txt(n, 'description')!,
        amountCents: n['amountCents'] as number,
        competenceDate: txt(n, 'competenceDate'),
        dueDate: txt(n, 'dueDate')!,
        status,
        // A data real do pagamento não existe no export: marca como desconhecida, nunca usa o vencimento.
        paidAtUnknown: status === 'quitado',
        installmentNo: typeof n['installmentNo'] === 'number' ? (n['installmentNo'] as number) : null,
        installmentTotal: typeof n['installmentTotal'] === 'number' ? (n['installmentTotal'] as number) : null,
        docNumber: txt(n, 'docNumber'),
        relatedKind: txt(n, 'relatedKind'),
        relatedRef: txt(n, 'relatedRef'),
        source: 'operand',
        sourceKey: l.sourceKey,
        createdBy: ator.userId,
      })
      .onConflictDoNothing()
      .returning({ id: geEntries.id });
    if (!criado) {
      await tx.update(geImportRows).set({ status: 'ignorado', issues: sql`${geImportRows.issues} || '["ja_importado"]'::jsonb` }).where(eq(geImportRows.id, l.id));
      c.jaExistiam++;
      continue;
    }
    await tx.update(geImportRows).set({ status: 'aplicado', appliedId: criado.id }).where(eq(geImportRows.id, l.id));
    c.criados++;
  }
}

export async function descartarLote(ator: Ator, id: string) {
  const lote = await carregarLote(ator.organizationId, id);
  if (lote.status !== 'em_staging') throw new ErroDeNegocio(409, 'Só um lote em staging pode ser descartado.');
  const [aplicadas] = await db.select({ n: count() }).from(geImportRows).where(and(eq(geImportRows.batchId, id), eq(geImportRows.status, 'aplicado')));
  if ((aplicadas?.n ?? 0) > 0) throw new ErroDeNegocio(409, 'Este lote já tem linhas aplicadas: não dá para descartar. Os registros criados ficam, e podem ser arquivados.');
  const [l] = await db.update(geImportBatches).set({ status: 'descartado' }).where(eq(geImportBatches.id, id)).returning();
  return l!;
}

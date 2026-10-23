import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { csvDeLancamentos, linhaCadastro, CAB_CADASTRO, xlsxDe } from './importador/teste-util';

/**
 * Importador contra o Postgres LOCAL (GESTAO_TEST_DATABASE_URL). Cada execução cria as próprias
 * organizações e as remove. O bloco final importa os arquivos REAIS do Operand quando
 * GESTAO_DADOS_OPERAND_DIR existe, numa organização descartável.
 */
const url = process.env.GESTAO_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
else process.env.DATABASE_URL ??= 'postgres://t:t@127.0.0.1:1/t';
process.env.GESTAO_EMPRESARIAL_ENABLED = 'true';

const estado = vi.hoisted(() => ({ userId: '', auditoria: [] as Array<{ action: string; metadata?: Record<string, unknown> }> }));
vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { headers: Record<string, string>; authUser?: unknown }, reply: { code(n: number): { send(b: unknown): void } }) => {
    const papel = request.headers['x-papel'];
    if (!papel) return reply.code(401).send({ error: 'Missing bearer token' });
    request.authUser = { id: estado.userId, email: 't@desigual.test', name: 'Teste', roles: [papel], permissions: [] };
  },
}));
vi.mock('../lib/tenant-context', () => ({
  requireTenant: async (request: { headers: Record<string, string>; tenantContext?: unknown }) => {
    request.tenantContext = { userId: estado.userId, organizationId: request.headers['x-org'], membershipId: 'm', role: 'master', permissions: [], actingAsProvider: false };
  },
}));
vi.mock('../lib/auditoria', () => ({ auditarAcao: async (_r: unknown, e: { action: string; metadata?: Record<string, unknown> }) => void estado.auditoria.push(e) }));

const { registerGestaoEmpresarialRoutes } = await import('./routes');
const { db, schema } = await import('@desigual-os/database');
const { and, eq, inArray, sql } = await import('drizzle-orm');

const P = '/gestao-empresarial';
let orgA = '';
let orgB = '';
let orgReal = '';
let app: ReturnType<typeof Fastify>;

const chamar = (org: string, metodo: 'GET' | 'POST' | 'PUT', caminho: string, body?: unknown) =>
  app.inject({ method: metodo, url: `${P}${caminho}`, headers: { 'x-papel': 'master', 'x-org': org }, ...(body !== undefined && { payload: body as object }) });
const enviar = (org: string, kind: string, fileName: string, conteudo: Buffer) => chamar(org, 'POST', '/importador/lotes', { kind, fileName, contentBase64: conteudo.toString('base64') });

const lancamento = (o: Record<string, string> = {}) => ({ operand_id: '1', venc_pgto: '23/10/2026', competencia: '01/10/2026', categoria: 'Receitas', titulo: 'Serviço', parcela: '', relacionado_codigo: 'PRO 1', sacado_cedente: 'Cedente Um', status: 'Quitado', valor_num: '100.00', rel_tipo: 'producao', rel_id: '1', ...o });

beforeAll(async () => {
  if (!url) return;
  const suf = Math.random().toString(36).slice(2, 10);
  const [u] = await db.insert(schema.users).values({ email: `imp-${suf}@desigual.test`, name: 'Teste Importador' }).returning();
  estado.userId = u!.id;
  const orgs = await db.insert(schema.organizations).values([{ name: 'A', slug: `imp-a-${suf}` }, { name: 'B', slug: `imp-b-${suf}` }, { name: 'Real', slug: `imp-r-${suf}` }]).returning();
  [orgA, orgB, orgReal] = orgs.map((o) => o.id) as [string, string, string];
  app = Fastify();
  await app.register(registerGestaoEmpresarialRoutes);
  await app.ready();
});
afterAll(async () => {
  if (!url) return;
  await app.close();
  const ids = [orgA, orgB, orgReal];
  await db.delete(schema.geLedger).where(inArray(schema.geLedger.organizationId, ids));
  await db.delete(schema.organizations).where(inArray(schema.organizations.id, ids));
  await db.delete(schema.users).where(eq(schema.users.id, estado.userId));
});
beforeEach(() => void (estado.auditoria.length = 0));

describe.skipIf(!url)('upload e validação', () => {
  it('o mesmo arquivo não entra duas vezes (409 apontando o lote)', async () => {
    const arq = await xlsxDe([CAB_CADASTRO, linhaCadastro({ Nome: 'Única Ltda', 'CNPJ / CPF': '11222333000181', Situação: 'Ativo' })]);
    const a = await enviar(orgA, 'clientes', 'c.xlsx', arq);
    expect(a.statusCode).toBe(201);
    const b = await enviar(orgA, 'clientes', 'c-copia.xlsx', arq);
    expect(b.statusCode).toBe(409);
    expect(b.json().error).toContain(a.json().lote.id);
    // outra organização pode importar o mesmo arquivo
    expect((await enviar(orgB, 'clientes', 'c.xlsx', arq)).statusCode).toBe(201);
  });
  it('dois envios SIMULTÂNEOS do mesmo arquivo: um lote só, e o outro recebe a mensagem certa', async () => {
    const arq = await xlsxDe([CAB_CADASTRO, linhaCadastro({ Nome: `Simultâneo ${Math.random()}`, Situação: 'Ativo' })]);
    const rs = await Promise.all([1, 2, 3].map(() => enviar(orgA, 'clientes', 'sim.xlsx', arq)));
    expect(rs.map((r) => r.statusCode).sort()).toEqual([201, 409, 409]);
    for (const r of rs.filter((x) => x.statusCode === 409)) expect(r.json().error).toMatch(/já foi importado/);
  });

  it('arquivo errado: extensão, colunas e conteúdo ilegível são 422 explicados', async () => {
    expect((await enviar(orgA, 'clientes', 'c.csv', Buffer.from('a,b'))).statusCode).toBe(422);
    expect((await enviar(orgA, 'clientes', 'c.xlsx', await xlsxDe([['Foo', 'Bar'], ['1', '2']]))).json().error).toMatch(/faltam as colunas/);
    expect((await enviar(orgA, 'clientes', 'c.xlsx', Buffer.from('não sou um zip'))).statusCode).toBe(422);
    expect((await enviar(orgA, 'lancamentos', 'x.csv', Buffer.from('a,b\n1,2'))).json().error).toMatch(/faltam as colunas/);
    expect((await chamar(orgA, 'POST', '/importador/lotes', { kind: 'clientes', fileName: 'c.xlsx', contentBase64: '!!!!' })).statusCode).toBe(400);
  });
});

describe.skipIf(!url)('cadastros: staging, decisão e aplicação', () => {
  it('nada vira cadastro antes de aplicar; aplicar cria os novos e ADIA o que precisa de decisão', async () => {
    const arq = await xlsxDe([
      CAB_CADASTRO,
      linhaCadastro({ Nome: 'Nova Gráfica', 'CNPJ / CPF': '11.444.777/0001-61', Situação: 'Ativo', Estado: ' ' }),
      linhaCadastro({ Nome: 'Sem Documento', Situação: 'Inativo', Telefone: '3333-4444' }),
      linhaCadastro({ Nome: 'Nova Gráfica Filial', 'CNPJ / CPF': '11444777000161', Situação: 'Ativo' }),
    ]);
    const up = (await enviar(orgA, 'fornecedores', 'f.xlsx', arq)).json();
    expect(up.totals).toMatchObject({ novo: 2, duplicado_provavel: 1, total: 3 });
    expect((await db.select().from(schema.geParties).where(and(eq(schema.geParties.organizationId, orgA), eq(schema.geParties.document, '11444777000161')))).length).toBe(0);

    const r = (await chamar(orgA, 'POST', `/importador/lotes/${up.lote.id}/aplicar`)).json();
    expect(r).toMatchObject({ criados: 2, adiados: 1, pendentes: 1, loteConcluido: false });
    const [nova] = await db.select().from(schema.geParties).where(and(eq(schema.geParties.organizationId, orgA), eq(schema.geParties.document, '11444777000161')));
    expect(nova).toMatchObject({ name: 'Nova Gráfica', state: null, status: 'ativo', source: 'operand', documentValid: true });
    const [semDoc] = await db.select().from(schema.geParties).where(and(eq(schema.geParties.organizationId, orgA), eq(schema.geParties.name, 'Sem Documento')));
    expect(semDoc).toMatchObject({ status: 'inativo', document: null, documentValid: null });
    expect((await db.select().from(schema.gePartyRoles).where(eq(schema.gePartyRoles.partyId, nova!.id))).map((x) => x.role)).toEqual(['fornecedor']);

    // o duplicado SEGUE em staging até uma decisão humana
    const resumo = (await chamar(orgA, 'GET', `/importador/lotes/${up.lote.id}`)).json();
    expect(resumo.porSituacao).toMatchObject({ aplicado: 2, duplicado_provavel: 1 });
    expect(resumo.lote.status).toBe('em_staging');
    expect(resumo.avisos).toEqual(expect.arrayContaining([expect.objectContaining({ aviso: 'telefone_sem_ddd', n: 1 })]));
  });

  it('vincular por documento ACRESCENTA o papel e não sobrescreve nada do cadastro existente', async () => {
    const manual = (await chamar(orgA, 'POST', '/cadastros/pessoas', { name: 'Nome Manual Original', document: '52998224725', email: 'manual@x.com', roles: ['cliente'] })).json();
    const arq = await xlsxDe([CAB_CADASTRO, linhaCadastro({ Nome: 'Nome Diferente do Operand', 'CNPJ / CPF': '529.982.247-25', Situação: 'Ativo', 'E-mail': 'operand@x.com' })]);
    const up = (await enviar(orgA, 'veiculos_midia', 'v.xlsx', arq)).json();
    expect(up.totals).toMatchObject({ duplicado_provavel: 1 });
    // sem decisão, aplicar não toca em nada
    expect((await chamar(orgA, 'POST', `/importador/lotes/${up.lote.id}/aplicar`)).json()).toMatchObject({ criados: 0, vinculados: 0, adiados: 1 });
    expect((await chamar(orgA, 'GET', `/cadastros/pessoas/${manual.id}`)).json().roles).toEqual(['cliente']);

    expect((await chamar(orgA, 'POST', `/importador/lotes/${up.lote.id}/vincular-por-documento`)).json()).toEqual({ vinculadas: 1 });
    const r = (await chamar(orgA, 'POST', `/importador/lotes/${up.lote.id}/aplicar`)).json();
    expect(r).toMatchObject({ criados: 0, vinculados: 1, pendentes: 0, loteConcluido: true });
    const depois = (await chamar(orgA, 'GET', `/cadastros/pessoas/${manual.id}`)).json();
    expect(depois.roles).toEqual(['cliente', 'veiculo_midia']);
    expect(depois).toMatchObject({ name: 'Nome Manual Original', email: 'manual@x.com' });
    expect((await chamar(orgA, 'GET', `/importador/lotes/${up.lote.id}`)).json().lote).toMatchObject({ status: 'aplicado' });
  });

  it('nome igual com documento diferente NÃO vincula: vira cadastro separado', async () => {
    await chamar(orgA, 'POST', '/cadastros/pessoas', { name: 'Homônimo Importado', document: '11144477735', roles: ['cliente'] });
    const up = (await enviar(orgA, 'clientes', 'h.xlsx', await xlsxDe([CAB_CADASTRO, linhaCadastro({ Nome: 'Homônimo Importado', 'CNPJ / CPF': '11222333000181', Situação: 'Ativo' })]))).json();
    expect(up.totals).toMatchObject({ novo: 1 });
    expect((await chamar(orgA, 'POST', `/importador/lotes/${up.lote.id}/aplicar`)).json()).toMatchObject({ criados: 1 });
  });

  it('ignorar uma linha a tira da fila e permite concluir o lote', async () => {
    const up = (await enviar(orgA, 'clientes', 'ign.xlsx', await xlsxDe([CAB_CADASTRO, linhaCadastro({ Nome: 'Doc A', 'CNPJ / CPF': '12345678909', Situação: 'Ativo' }), linhaCadastro({ Nome: 'Doc A de novo', 'CNPJ / CPF': '12345678909', Situação: 'Ativo' })]))).json();
    const linhas = (await chamar(orgA, 'GET', `/importador/lotes/${up.lote.id}/linhas?status=duplicado_provavel`)).json();
    expect(linhas.total).toBe(1);
    expect((await chamar(orgA, 'PUT', `/importador/lotes/${up.lote.id}/linhas/${linhas.items[0].id}/decisao`, { acao: 'ignorar' })).statusCode).toBe(200);
    expect((await chamar(orgA, 'POST', `/importador/lotes/${up.lote.id}/aplicar`)).json()).toMatchObject({ pendentes: 0, loteConcluido: true });
  });

  it('decidir vincular exige um cadastro DA MESMA organização', async () => {
    const dono = (await chamar(orgB, 'POST', '/cadastros/pessoas', { name: 'Dono B', roles: ['cliente'] })).json();
    const up = (await enviar(orgA, 'clientes', 'dec.xlsx', await xlsxDe([CAB_CADASTRO, linhaCadastro({ Nome: 'Z1', 'CNPJ / CPF': '39053344705', Situação: 'Ativo' }), linhaCadastro({ Nome: 'Z2', 'CNPJ / CPF': '39053344705', Situação: 'Ativo' })]))).json();
    const dup = (await chamar(orgA, 'GET', `/importador/lotes/${up.lote.id}/linhas?status=duplicado_provavel`)).json().items[0];
    expect((await chamar(orgA, 'PUT', `/importador/lotes/${up.lote.id}/linhas/${dup.id}/decisao`, { acao: 'vincular', partyId: dono.id })).statusCode).toBe(404);
  });

  it('descartar antes de aplicar funciona; depois de aplicar parcialmente, não', async () => {
    const livre = (await enviar(orgA, 'clientes', 'd1.xlsx', await xlsxDe([CAB_CADASTRO, linhaCadastro({ Nome: 'Descartável', Situação: 'Ativo' })]))).json();
    expect((await chamar(orgA, 'POST', `/importador/lotes/${livre.lote.id}/descartar`)).json()).toMatchObject({ status: 'descartado' });
    expect((await chamar(orgA, 'POST', `/importador/lotes/${livre.lote.id}/aplicar`)).statusCode).toBe(409);
    const aplicado = (await enviar(orgA, 'clientes', 'd2.xlsx', await xlsxDe([CAB_CADASTRO, linhaCadastro({ Nome: 'Aplicado Parcial', Situação: 'Ativo' }), linhaCadastro({ Nome: 'Dup Parcial', 'CNPJ / CPF': '11144477735', Situação: 'Ativo' })]))).json();
    await chamar(orgA, 'POST', `/importador/lotes/${aplicado.lote.id}/aplicar`);
    expect((await chamar(orgA, 'POST', `/importador/lotes/${aplicado.lote.id}/descartar`)).statusCode).toBe(409);
  });

  it('ISOLAMENTO: outra organização não vê, não decide e não aplica o lote', async () => {
    const up = (await enviar(orgA, 'clientes', 'iso.xlsx', await xlsxDe([CAB_CADASTRO, linhaCadastro({ Nome: 'Isolada', Situação: 'Ativo' })]))).json();
    const id = up.lote.id;
    const tentativas: Array<['GET' | 'POST', string]> = [['GET', `/importador/lotes/${id}`], ['GET', `/importador/lotes/${id}/linhas`], ['POST', `/importador/lotes/${id}/aplicar`], ['POST', `/importador/lotes/${id}/descartar`], ['POST', `/importador/lotes/${id}/vincular-por-documento`]];
    for (const [m, c] of tentativas) {
      expect((await chamar(orgB, m, c)).statusCode, `${m} ${c}`).toBe(404);
    }
    expect((await chamar(orgB, 'GET', '/importador/lotes')).json().items.map((l: { id: string }) => l.id)).not.toContain(id);
  });

  it('duas aplicações SIMULTÂNEAS não duplicam: uma aplica, a outra recebe 409', async () => {
    const up = (await enviar(orgA, 'clientes', 'conc.xlsx', await xlsxDe([CAB_CADASTRO, ...Array.from({ length: 20 }, (_, i) => linhaCadastro({ Nome: `Concorrente ${i}`, Situação: 'Ativo' }))]))).json();
    const rs = await Promise.all([1, 2, 3].map(() => chamar(orgA, 'POST', `/importador/lotes/${up.lote.id}/aplicar`)));
    expect(rs.map((r) => r.statusCode).sort()).toEqual([200, 409, 409]);
    const [contagem] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.geParties).where(and(eq(schema.geParties.organizationId, orgA), sql`${schema.geParties.name} like 'Concorrente %'`));
    expect(contagem?.n).toBe(20);
  });
});

describe.skipIf(!url)('lançamentos: vínculo explícito e aplicação', () => {
  const csv = csvDeLancamentos([
    lancamento({ operand_id: '10', sacado_cedente: 'Cedente Um', status: 'Quitado', valor_num: '1000.00' }),
    lancamento({ operand_id: '11', sacado_cedente: 'Cedente Um', status: 'Cancelado', valor_num: '500.50', titulo: 'Banner, lona "premium"' }),
    lancamento({ operand_id: '12', sacado_cedente: 'Cedente Dois', status: 'Em Aberto', valor_num: '250.25', parcela: '2/3' }),
    lancamento({ operand_id: '13', sacado_cedente: '', status: 'Em Aberto', valor_num: '10.00' }),
    lancamento({ operand_id: '14', sacado_cedente: 'Cedente Dois', status: 'Quitado', valor_num: '0' }),
  ]);

  it('só entra o que está pronto; cedente sem vínculo espera uma decisão', async () => {
    const up = (await enviar(orgB, 'lancamentos', 'l.csv', csv)).json();
    expect(up.totals).toMatchObject({ precisa_vinculo: 3, novo: 1, invalido: 1, total: 5 });
    const r = (await chamar(orgB, 'POST', `/importador/lotes/${up.lote.id}/aplicar`)).json();
    expect(r).toMatchObject({ criados: 1, pendentes: 3, loteConcluido: false });
    const ced = (await chamar(orgB, 'GET', `/importador/lotes/${up.lote.id}/cedentes`)).json().items;
    expect(ced.map((c: { label: string; linhas: number; totalCents: number }) => [c.label, c.linhas, c.totalCents])).toEqual([['Cedente Um', 2, 150050], ['Cedente Dois', 1, 25025]]);
    expect(ced.every((c: { candidatos: unknown[] }) => c.candidatos.length === 0)).toBe(true);
  });

  it('sugere candidato por nome EXATO, mas só vincula quando a pessoa decide', async () => {
    const cliente = (await chamar(orgB, 'POST', '/cadastros/pessoas', { name: 'cedente  um', roles: ['cliente'] })).json();
    const up = (await enviar(orgB, 'lancamentos', 'l2.csv', csvDeLancamentos([lancamento({ operand_id: '20', sacado_cedente: 'Cedente Um' })]))).json();
    const ced = (await chamar(orgB, 'GET', `/importador/lotes/${up.lote.id}/cedentes`)).json().items;
    expect(ced[0].candidatos).toEqual([{ id: cliente.id, name: 'cedente  um', roles: ['cliente'] }]);
    expect((await chamar(orgB, 'POST', `/importador/lotes/${up.lote.id}/aplicar`)).json()).toMatchObject({ criados: 0 });

    expect((await chamar(orgB, 'PUT', `/importador/lotes/${up.lote.id}/cedentes`, { label: 'Cedente Um', partyId: cliente.id })).json()).toEqual({ atualizadas: 1 });
    expect((await chamar(orgB, 'POST', `/importador/lotes/${up.lote.id}/aplicar`)).json()).toMatchObject({ criados: 1, loteConcluido: true });
    const [e] = await db.select().from(schema.geEntries).where(and(eq(schema.geEntries.organizationId, orgB), eq(schema.geEntries.sourceKey, '20')));
    expect(e).toMatchObject({ partyId: cliente.id, partyLabel: 'Cedente Um' });
  });

  it('"importar sem vínculo" preserva o texto do cedente; cancelado e quitado entram como vieram, sem inventar data', async () => {
    const up = (await enviar(orgA, 'lancamentos', 'l3.csv', csv)).json();
    for (const label of ['Cedente Um', 'Cedente Dois']) expect((await chamar(orgA, 'PUT', `/importador/lotes/${up.lote.id}/cedentes`, { label, partyId: null })).statusCode).toBe(200);
    const r = (await chamar(orgA, 'POST', `/importador/lotes/${up.lote.id}/aplicar`)).json();
    expect(r).toMatchObject({ criados: 4, pendentes: 0, loteConcluido: true });

    const todos = await db.select().from(schema.geEntries).where(eq(schema.geEntries.organizationId, orgA));
    const por = (k: string) => todos.find((e) => e.sourceKey === k)!;
    expect(por('10')).toMatchObject({ status: 'quitado', paidAt: null, paidAtUnknown: true, amountCents: 100000, partyId: null, partyLabel: 'Cedente Um', source: 'operand', kind: 'receita', relatedKind: 'producao', relatedRef: 'PRO 1' });
    expect(por('11')).toMatchObject({ status: 'cancelado', amountCents: 50050, description: 'Banner, lona "premium"' });
    expect(por('12')).toMatchObject({ status: 'aberto', paidAtUnknown: false, installmentNo: 2, installmentTotal: 3, dueDate: '2026-10-23', competenceDate: '2026-10-01' });
    expect(todos.find((e) => e.sourceKey === '14')).toBeUndefined();
    // pagamento de origem desconhecida NÃO cria movimento no razão (a conta é desconhecida)
    expect(await db.select().from(schema.geLedger).where(eq(schema.geLedger.organizationId, orgA))).toHaveLength(0);
  });

  it('o indicador exclui o cancelado: receita realizada é só o quitado', async () => {
    const lista = (await chamar(orgA, 'GET', '/financeiro/lancamentos?pageSize=100')).json();
    const quitado = lista.items.filter((i: { status: string }) => i.status === 'quitado');
    expect(quitado.reduce((s: number, i: { amountCents: number }) => s + i.amountCents, 0)).toBe(100000);
  });

  it('reimportar com outro hash mas as mesmas linhas não duplica: tudo "já importado"', async () => {
    const outroArquivo = Buffer.concat([csv, Buffer.from('\n')]);
    const up = (await enviar(orgA, 'lancamentos', 'l3-reexportado.csv', outroArquivo)).json();
    expect(up.totals).toMatchObject({ ignorado: 4, invalido: 1 });
    expect((await chamar(orgA, 'POST', `/importador/lotes/${up.lote.id}/aplicar`)).json()).toMatchObject({ criados: 0, loteConcluido: true });
    expect(await db.select().from(schema.geEntries).where(eq(schema.geEntries.organizationId, orgA))).toHaveLength(4);
  });

  it('o rastro de auditoria cobre upload, decisão e aplicação', async () => {
    const up = (await enviar(orgB, 'lancamentos', 'aud.csv', csvDeLancamentos([lancamento({ operand_id: '90' })]))).json();
    await chamar(orgB, 'PUT', `/importador/lotes/${up.lote.id}/cedentes`, { label: 'Cedente Um', partyId: null });
    await chamar(orgB, 'POST', `/importador/lotes/${up.lote.id}/aplicar`);
    expect(estado.auditoria.map((e) => e.action)).toEqual(expect.arrayContaining(['gestao.importacao.lote_criado', 'gestao.importacao.cedente_vinculado', 'gestao.importacao.lote_aplicado']));
  });
});

const dir = process.env.GESTAO_DADOS_OPERAND_DIR;
describe.skipIf(!url || !dir || !existsSync(dir))('ponta a ponta com os arquivos REAIS do Operand (organização descartável)', () => {
  const ler = (nome: string) => readFileSync(join(dir!, nome));
  const contar = async (tabela: 'parties' | 'entries') =>
    Number((await db.execute<{ n: string }>(sql`select count(*)::text as n from ${sql.raw(tabela === 'parties' ? 'ge_parties' : 'ge_entries')} where organization_id = ${orgReal}`))[0]!.n);

  it('clientes, fornecedores, veículos e lançamentos: contagens e totais exatos da auditoria', async () => {
    // CLIENTES: 760 linhas, 12 repetidos por documento ficam para decisão
    const cli = (await enviar(orgReal, 'clientes', 'Relatório de Clientes.xlsx', ler('Relatório de Clientes.xlsx'))).json();
    expect(cli.totals).toMatchObject({ total: 760, novo: 748, duplicado_provavel: 12 });
    expect((await chamar(orgReal, 'POST', `/importador/lotes/${cli.lote.id}/aplicar`)).json()).toMatchObject({ criados: 748, pendentes: 12 });
    expect(await contar('parties')).toBe(748);
    expect((await chamar(orgReal, 'POST', `/importador/lotes/${cli.lote.id}/vincular-por-documento`)).json()).toEqual({ vinculadas: 12 });
    expect((await chamar(orgReal, 'POST', `/importador/lotes/${cli.lote.id}/aplicar`)).json()).toMatchObject({ vinculados: 12, pendentes: 0, loteConcluido: true });
    expect(await contar('parties')).toBe(748);

    // FORNECEDORES: os 7 documentos em comum com clientes viram papel extra, não cadastro novo
    const forn = (await enviar(orgReal, 'fornecedores', 'Relatório de Fornecedores.xlsx', ler('Relatório de Fornecedores.xlsx'))).json();
    expect(forn.totals['total']).toBe(254);
    expect((await chamar(orgReal, 'POST', `/importador/lotes/${forn.lote.id}/aplicar`)).json()).toMatchObject({ pendentes: expect.any(Number) });
    await chamar(orgReal, 'POST', `/importador/lotes/${forn.lote.id}/vincular-por-documento`);
    expect((await chamar(orgReal, 'POST', `/importador/lotes/${forn.lote.id}/aplicar`)).json()).toMatchObject({ pendentes: 0, loteConcluido: true });
    // a cópia "(1)" tem outro hash e o MESMO conteúdo: nada novo é criado
    const antes = await contar('parties');
    const copia = (await enviar(orgReal, 'fornecedores', 'Relatório de Fornecedores (1).xlsx', ler('Relatório de Fornecedores (1).xlsx'))).json();
    expect(copia.totals).toMatchObject({ duplicado_provavel: expect.any(Number) });
    await chamar(orgReal, 'POST', `/importador/lotes/${copia.lote.id}/vincular-por-documento`);
    await chamar(orgReal, 'POST', `/importador/lotes/${copia.lote.id}/aplicar`);
    expect(await contar('parties')).toBe(antes);

    // VEÍCULOS DE MÍDIA: 38 documentos em comum com fornecedores
    const vei = (await enviar(orgReal, 'veiculos_midia', 'Relatório de Veículos.xlsx', ler('Relatório de Veículos.xlsx'))).json();
    expect(vei.totals['total']).toBe(74);
    await chamar(orgReal, 'POST', `/importador/lotes/${vei.lote.id}/aplicar`);
    await chamar(orgReal, 'POST', `/importador/lotes/${vei.lote.id}/vincular-por-documento`);
    expect((await chamar(orgReal, 'POST', `/importador/lotes/${vei.lote.id}/aplicar`)).json()).toMatchObject({ pendentes: 0 });
    const veiculos = await db.execute<{ n: string }>(sql`select count(*)::text as n from ge_party_roles where organization_id = ${orgReal} and role = 'veiculo_midia'`);
    expect(Number(veiculos[0]!.n)).toBe(73);

    // Nenhum documento aparece duas vezes, e nenhum cadastro foi fundido por nome
    const dup = await db.execute<{ n: string }>(sql`select count(*)::text as n from (select document from ge_parties where organization_id = ${orgReal} and document is not null group by document having count(*) > 1) t`);
    expect(Number(dup[0]!.n)).toBe(0);

    // LANÇAMENTOS: 171 em staging; os 31 cedentes precisam de decisão; nada entra sem ela
    const lan = (await enviar(orgReal, 'lancamentos', 'lancamentos_derivado_2026-10-22.csv', ler('lancamentos_derivado_2026-10-22.csv'))).json();
    expect(lan.totals).toMatchObject({ total: 171, precisa_vinculo: 171 });
    expect((await chamar(orgReal, 'POST', `/importador/lotes/${lan.lote.id}/aplicar`)).json()).toMatchObject({ criados: 0, pendentes: 171 });
    const ced = (await chamar(orgReal, 'GET', `/importador/lotes/${lan.lote.id}/cedentes`)).json().items as Array<{ label: string; candidatos: unknown[] }>;
    expect(ced).toHaveLength(31);
    expect(ced.filter((c) => c.candidatos.length > 0).length).toBeGreaterThanOrEqual(30);
    for (const c of ced) await chamar(orgReal, 'PUT', `/importador/lotes/${lan.lote.id}/cedentes`, { label: c.label, partyId: null });
    expect((await chamar(orgReal, 'POST', `/importador/lotes/${lan.lote.id}/aplicar`)).json()).toMatchObject({ criados: 171, pendentes: 0, loteConcluido: true });

    expect(await contar('entries')).toBe(171);
    const totais = await db.execute<{ status: string; n: string; soma: string }>(sql`select status, count(*)::text as n, sum(amount_cents)::text as soma from ge_entries where organization_id = ${orgReal} group by status`);
    const t = Object.fromEntries(totais.map((r) => [r.status, [Number(r.n), Number(r.soma)]]));
    expect(t).toEqual({ quitado: [122, 12565849], aberto: [7, 169800], cancelado: [42, 19209510] });
    // nenhum pagamento inventado
    const semData = await db.execute<{ n: string }>(sql`select count(*)::text as n from ge_entries where organization_id = ${orgReal} and status = 'quitado' and paid_at is null and paid_at_unknown`);
    expect(Number(semData[0]!.n)).toBe(122);
    expect((await db.select().from(schema.geLedger).where(eq(schema.geLedger.organizationId, orgReal)))).toHaveLength(0);
    // reenviar o mesmo CSV: recusado
    expect((await enviar(orgReal, 'lancamentos', 'de-novo.csv', ler('lancamentos_derivado_2026-10-22.csv'))).statusCode).toBe(409);
  }, 120_000);
});

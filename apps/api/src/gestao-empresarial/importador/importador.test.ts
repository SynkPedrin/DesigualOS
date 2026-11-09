import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { lerCsv } from './csv';
import { lerXlsx } from './xlsx';
import { lerArquivoDoLote, prepararCadastros, prepararLancamentos } from './normalizar';

const CAB_CAD = ['Nome', 'CNPJ / CPF', 'E-mail', 'Telefone', 'Cidade', 'Estado', 'Situação', 'Razão Social'];
const CAB_LANC = ['operand_id', 'venc_pgto', 'competencia', 'faturamento', 'categoria', 'titulo', 'parcela', 'relacionado_codigo', 'relacionado_ref', 'sacado_cedente', 'doc_nf', 'status', 'valor_brl', 'valor_num', 'rel_tipo', 'rel_id', 'ano_venc_pgto'];
const lanc = (o: Record<string, string>) => CAB_LANC.map((c) => o[c] ?? '');
const base = { operand_id: '1', venc_pgto: '23/10/2026', competencia: '01/10/2026', categoria: 'Receitas', titulo: 'Serviço', sacado_cedente: 'Fulano', status: 'Quitado', valor_num: '100.50', rel_tipo: 'producao', relacionado_codigo: 'PRO 1', rel_id: '1' };

async function xlsxDe(linhas: string[][], opcoes: { aba?: string } = {}): Promise<Buffer> {
  const col = (i: number) => String.fromCharCode(65 + i);
  const textos: string[] = [];
  const idx = (t: string) => {
    let i = textos.indexOf(t);
    if (i < 0) i = textos.push(t) - 1;
    return i;
  };
  const xmlLinhas = linhas.map((l, r) => `<row r="${r + 1}">${l.map((v, c) => (v === '' ? '' : `<c r="${col(c)}${r + 1}" t="s"><v>${idx(v)}</v></c>`)).join('')}</row>`).join('');
  const z = new JSZip();
  z.file('xl/workbook.xml', `<workbook xmlns:r="x"><sheets><sheet r:id="rId1" sheetId="1" name="${opcoes.aba ?? 'Relatório'}"/></sheets></workbook>`);
  z.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Target="worksheets/sheet1.xml" Id="rId1"/></Relationships>');
  z.file('xl/worksheets/sheet1.xml', `<worksheet><sheetData>${xmlLinhas}</sheetData></worksheet>`);
  z.file('xl/sharedStrings.xml', `<sst>${textos.map((t) => `<si><t>${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></si>`).join('')}</sst>`);
  return z.generateAsync({ type: 'nodebuffer' });
}

describe('CSV', () => {
  it('campo entre aspas com vírgula, aspas escapadas e quebra de linha', () => {
    expect(lerCsv('a,b,c\n1,"x, y",3\n"a ""b""","l1\nl2",z\n')).toEqual([['a', 'b', 'c'], ['1', 'x, y', '3'], ['a "b"', 'l1\nl2', 'z']]);
  });
  it('aceita CRLF, BOM, campo vazio e última linha sem quebra', () => {
    expect(lerCsv('﻿a,b\r\n1,\r\n,2')).toEqual([['a', 'b'], ['1', ''], ['', '2']]);
  });
  it('recusa aspas sem fechar em vez de engolir o arquivo', () => {
    expect(() => lerCsv('a,b\n"aberto,1')).toThrow(/aspas/);
  });
});

describe('xlsx', () => {
  it('lê texto, célula vazia no meio, acento e & escapado', async () => {
    const r = await lerXlsx(await xlsxDe([['Nome', 'E-mail', 'Cidade'], ['A & B', '', 'São Paulo']]));
    expect(r.aba).toBe('Relatório');
    expect(r.linhas).toEqual([['Nome', 'E-mail', 'Cidade'], ['A & B', null, 'São Paulo']]);
  });
  it('arquivo que não é xlsx dá erro legível', async () => {
    await expect(lerXlsx(Buffer.from('isto não é um zip'))).rejects.toThrow();
    const z = new JSZip();
    z.file('qualquer.txt', 'x');
    await expect(lerXlsx(await z.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow(/planilha/);
  });
  it('tipo errado de arquivo para o lote é 422 explicado', async () => {
    await expect(lerArquivoDoLote('clientes', 'x.csv', Buffer.from('a'))).rejects.toMatchObject({ status: 422 });
    await expect(lerArquivoDoLote('lancamentos', 'x.xlsx', Buffer.from('a'))).rejects.toMatchObject({ status: 422 });
  });
});

describe('cadastros', () => {
  const linhas = (...rows: Array<Array<string | null>>) => [CAB_CAD, ...rows];
  it('exige as colunas: arquivo errado não vira lixo importado', () => {
    expect(() => prepararCadastros('clientes', [['Foo', 'Bar'], ['1', '2']])).toThrow(/faltam as colunas/);
  });
  it('normaliza sem inventar: espaço vira nulo, documento só dígitos, DDD ausente é aviso', () => {
    const [l] = prepararCadastros('clientes', linhas(['  Padaria  Central ', '11.222.333/0001-81', 'contato@padaria.com', '3333-4444', ' ', ' ', 'Ativo', null]));
    expect(l!.normalized).toMatchObject({ name: 'Padaria Central', document: '11222333000181', documentKind: 'cnpj', documentValid: true, city: null, state: null, phone: '3333-4444', active: true, role: 'cliente' });
    expect(l!.issues).toEqual(['telefone_sem_ddd']);
    expect(l!.status).toBe('novo');
  });
  it('documento ausente e inválido são avisos, não bloqueios; o original é preservado', () => {
    const [a, b] = prepararCadastros('fornecedores', linhas(['Sem Doc', null, null, null, null, null, 'Ativo', null], ['Doc Ruim', '11.222.333/0001-82', null, null, null, null, 'Inativo', null]));
    expect(a!.issues).toContain('documento_ausente');
    expect(b!.issues).toContain('documento_invalido');
    expect(b!.normalized).toMatchObject({ rawDocument: '11.222.333/0001-82', documentValid: false, active: false });
    expect([a!.status, b!.status]).toEqual(['novo', 'novo']);
  });
  it('mesmo documento na planilha: a segunda linha vira duplicado provável, apontando a primeira', () => {
    const r = prepararCadastros('clientes', linhas(['A', '11222333000181', null, null, null, null, 'Ativo', null], ['A Filial', '11.222.333/0001-81', null, null, null, null, 'Ativo', null]));
    expect(r.map((x) => x.status)).toEqual(['novo', 'duplicado_provavel']);
    expect(r[1]!.issues).toContain('documento_repetido_na_linha_2');
    expect(r[0]!.sourceKey).not.toBe(r[1]!.sourceKey);
  });
  it('mesmo nome SEM documento não é bloqueado (homônimo), só avisado', () => {
    const r = prepararCadastros('clientes', linhas(['João Silva', null, null, null, 'Bauru', null, 'Ativo', null], ['João Silva', null, null, null, 'Bauru', null, 'Ativo', null]));
    expect(r.map((x) => x.status)).toEqual(['novo', 'novo']);
    expect(r[1]!.issues).toContain('nome_repetido_sem_documento');
  });
  it('sem nome é inválido; e-mail ruim vira aviso e não é gravado', () => {
    const [semNome, emailRuim] = prepararCadastros('clientes', linhas([null, '52998224725', null, null, null, null, 'Ativo', null], ['X', null, 'sem-arroba', null, null, null, 'Ativo', null]));
    expect(semNome!.status).toBe('invalido');
    expect(emailRuim!.normalized['email']).toBeNull();
    expect(emailRuim!.issues).toContain('email_invalido');
  });
  it('a chave de origem é estável: o mesmo arquivo gera as mesmas chaves', () => {
    const l = linhas(['A', '11222333000181', null, null, null, null, 'Ativo', null], ['B', null, null, null, 'Bauru', null, 'Ativo', null]);
    expect(prepararCadastros('clientes', l).map((x) => x.sourceKey)).toEqual(prepararCadastros('clientes', l).map((x) => x.sourceKey));
    expect(prepararCadastros('clientes', l).map((x) => x.sourceKey)).toEqual(['doc:11222333000181', 'nome:b|bauru']);
  });
});

describe('lançamentos', () => {
  it('lê um lançamento do Operand sem inventar nada', () => {
    const [l] = prepararLancamentos([CAB_LANC, lanc({ ...base, parcela: '2/3' })]);
    expect(l!.normalized).toMatchObject({ kind: 'receita', amountCents: 10050, dueDate: '2026-10-23', competenceDate: '2026-10-01', status: 'quitado', partyLabel: 'Fulano', installmentNo: 2, installmentTotal: 3, relatedKind: 'producao', relatedRef: 'PRO 1', docNumber: null });
    expect(l!.sourceKey).toBe('1');
    expect(l!.status).toBe('precisa_vinculo');
  });
  it('cedente sem vínculo NÃO entra sozinho: fica em staging aguardando um humano', () => {
    const [l] = prepararLancamentos([CAB_LANC, lanc(base)]);
    expect(l!.status).toBe('precisa_vinculo');
  });
  it('sem cedente não há o que vincular: segue como novo, com aviso', () => {
    const [l] = prepararLancamentos([CAB_LANC, lanc({ ...base, sacado_cedente: '' })]);
    expect(l!.status).toBe('novo');
    expect(l!.issues).toContain('sem_cedente');
  });
  it('mapeia os três status e mantém o cancelado como cancelado', () => {
    const r = prepararLancamentos([CAB_LANC, lanc({ ...base, operand_id: '1', status: 'Em Aberto' }), lanc({ ...base, operand_id: '2', status: 'Quitado' }), lanc({ ...base, operand_id: '3', status: 'Cancelado' })]);
    expect(r.map((x) => x.normalized['status'])).toEqual(['aberto', 'quitado', 'cancelado']);
  });
  it('bloqueia o que não dá para importar certo: valor, data, status, categoria, título e id', () => {
    const casos: Array<[Record<string, string>, string]> = [
      [{ valor_num: 'abc' }, 'valor_invalido'],
      [{ valor_num: '0' }, 'valor_nao_positivo'],
      [{ venc_pgto: '31/02/2026' }, 'vencimento_invalido'],
      [{ status: 'Pendente' }, 'status_desconhecido'],
      [{ categoria: 'Despesa X' }, 'categoria_desconhecida'],
      [{ titulo: '' }, 'sem_titulo'],
      [{ operand_id: '' }, 'sem_operand_id'],
    ];
    for (const [mudanca, aviso] of casos) {
      const [l] = prepararLancamentos([CAB_LANC, lanc({ ...base, ...mudanca })]);
      expect(l!.status, aviso).toBe('invalido');
      expect(l!.issues, aviso).toContain(aviso);
    }
  });
  it('operand_id repetido no arquivo: a segunda ocorrência é inválida', () => {
    const r = prepararLancamentos([CAB_LANC, lanc(base), lanc(base)]);
    expect(r.map((x) => x.status)).toEqual(['precisa_vinculo', 'invalido']);
    expect(r[1]!.issues).toContain('operand_id_repetido');
  });
  it('parcela fora do padrão (5x18) é avisada e guardada como veio, sem chute', () => {
    const [l] = prepararLancamentos([CAB_LANC, lanc({ ...base, parcela: '5x18' })]);
    expect(l!.issues).toContain('parcela_nao_reconhecida');
    expect(l!.normalized).toMatchObject({ installmentNo: null, installmentTotal: null, parcelaOriginal: '5x18' });
    expect(l!.status).toBe('precisa_vinculo');
  });
  it('despesa é aceita (o motor existe, ainda que o arquivo atual só tenha receitas)', () => {
    expect(prepararLancamentos([CAB_LANC, lanc({ ...base, categoria: 'Despesas' })])[0]!.normalized['kind']).toBe('despesa');
  });
  it('título com vírgula e aspas atravessa o CSV inteiro', () => {
    const csv = `${CAB_LANC.join(',')}\n1,23/10/2026,01/10/2026,,Receitas,"Banner 3x2, lona ""premium""",,PRO 1,,Fulano,,Quitado,"R$ 1.000,50",1000.50,producao,1,2026`;
    const [l] = prepararLancamentos(lerCsv(csv));
    expect(l!.normalized).toMatchObject({ description: 'Banner 3x2, lona "premium"', amountCents: 100050 });
  });
});

/**
 * PROVA CONTRA OS ARQUIVOS REAIS. Roda só quando `GESTAO_DADOS_OPERAND_DIR` aponta para a pasta
 * (ela não mora no repositório: tem dado pessoal e comercial). Os números abaixo são os da
 * auditoria de 22/10/2026; se o importador discordar dela, um dos dois está errado.
 */
const dir = process.env.GESTAO_DADOS_OPERAND_DIR;
describe.skipIf(!dir || !existsSync(dir))('contra os arquivos reais do Operand', () => {
  const conta = (r: ReturnType<typeof prepararCadastros>, aviso: string) => r.filter((x) => x.issues.includes(aviso)).length;
  const cadastro = async (arquivo: string, tipo: 'clientes' | 'fornecedores' | 'veiculos_midia') =>
    prepararCadastros(tipo, await lerArquivoDoLote(tipo, arquivo, readFileSync(join(dir!, arquivo))));

  it('clientes: 760 linhas, 454 sem documento, 6 documentos inválidos, 12 repetidos', async () => {
    const r = await cadastro('Relatório de Clientes.xlsx', 'clientes');
    expect(r).toHaveLength(760);
    expect(conta(r, 'documento_ausente')).toBe(454);
    expect(conta(r, 'documento_invalido')).toBe(6);
    expect(r.filter((x) => x.status === 'duplicado_provavel')).toHaveLength(12);
    expect(r.filter((x) => x.status === 'invalido')).toHaveLength(0);
    expect(r.filter((x) => x.normalized['active']).length).toBe(407);
    expect(new Set(r.map((x) => x.sourceKey)).size).toBe(760);
  });
  it('fornecedores: 254 linhas, 125 sem documento, 4 inválidos, 5 repetidos', async () => {
    const r = await cadastro('Relatório de Fornecedores.xlsx', 'fornecedores');
    expect(r).toHaveLength(254);
    expect(conta(r, 'documento_ausente')).toBe(125);
    expect(conta(r, 'documento_invalido')).toBe(4);
    expect(r.filter((x) => x.status === 'duplicado_provavel')).toHaveLength(5);
  });
  it('as duas cópias de fornecedores geram exatamente as mesmas linhas', async () => {
    const a = await cadastro('Relatório de Fornecedores.xlsx', 'fornecedores');
    const b = await cadastro('Relatório de Fornecedores (1).xlsx', 'fornecedores');
    expect(b.map((x) => [x.sourceKey, x.normalized])).toEqual(a.map((x) => [x.sourceKey, x.normalized]));
  });
  it('veículos de mídia: 74 linhas, 26 sem documento, 1 inválido, 1 repetido', async () => {
    const r = await cadastro('Relatório de Veículos.xlsx', 'veiculos_midia');
    expect(r).toHaveLength(74);
    expect(conta(r, 'documento_ausente')).toBe(26);
    expect(conta(r, 'documento_invalido')).toBe(1);
    expect(r.filter((x) => x.status === 'duplicado_provavel')).toHaveLength(1);
  });
  it('lançamentos: 171 linhas, nenhuma inválida, totais EXATOS por status', async () => {
    const r = prepararLancamentos(await lerArquivoDoLote('lancamentos', 'lancamentos_derivado_2026-10-22.csv', readFileSync(join(dir!, 'lancamentos_derivado_2026-10-22.csv'))));
    expect(r).toHaveLength(171);
    expect(r.filter((x) => x.status === 'invalido')).toHaveLength(0);
    const soma = (s: string) => r.filter((x) => x.normalized['status'] === s).reduce((t, x) => t + (x.normalized['amountCents'] as number), 0);
    expect(soma('quitado')).toBe(12565849);
    expect(soma('aberto')).toBe(169800);
    expect(soma('cancelado')).toBe(19209510);
    expect(soma('quitado') + soma('aberto') + soma('cancelado')).toBe(31945159);
    expect(r.filter((x) => x.normalized['status'] === 'cancelado')).toHaveLength(42);
    expect(r.filter((x) => x.issues.includes('parcela_nao_reconhecida'))).toHaveLength(0);
    expect(new Set(r.map((x) => x.sourceKey)).size).toBe(171);
    expect(r.every((x) => x.normalized['kind'] === 'receita')).toBe(true);
  });
});

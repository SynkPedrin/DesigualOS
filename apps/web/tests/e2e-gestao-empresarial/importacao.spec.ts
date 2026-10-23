import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import type JSZipTipo from 'jszip';
import { abrir, api, entrar, RODADA, tokenDaApi, vigiarErros } from './ajuda';

const JSZip = createRequire(import.meta.url)('jszip') as typeof JSZipTipo;

test.describe.configure({ mode: 'serial' });

/** CNPJ válido e único por rodada: a base vem do relógio, os dígitos verificadores são calculados. */
function cnpj(semente: number): string {
  const base = String(semente).padStart(12, '0').slice(-12);
  const dv = (s: string, pesos: number[]) => { const r = pesos.reduce((t, p, i) => t + Number(s[i]) * p, 0) % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = dv(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv(base + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base}${d1}${d2}`;
}

async function xlsx(linhas: string[][]): Promise<Buffer> {
  const textos: string[] = [];
  const idx = (t: string) => (textos.includes(t) ? textos.indexOf(t) : textos.push(t) - 1);
  const xml = linhas.map((l, r) => `<row r="${r + 1}">${l.map((v, c) => (v === '' ? '' : `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="s"><v>${idx(v)}</v></c>`)).join('')}</row>`).join('');
  const z = new JSZip();
  z.file('xl/workbook.xml', '<workbook xmlns:r="x"><sheets><sheet r:id="rId1" sheetId="1" name="Relatório"/></sheets></workbook>');
  z.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Target="worksheets/sheet1.xml" Id="rId1"/></Relationships>');
  z.file('xl/worksheets/sheet1.xml', `<worksheet><sheetData>${xml}</sheetData></worksheet>`);
  z.file('xl/sharedStrings.xml', `<sst>${textos.map((t) => `<si><t>${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></si>`).join('')}</sst>`);
  return z.generateAsync({ type: 'nodebuffer' });
}

const CAB = ['Nome', 'CNPJ / CPF', 'E-mail', 'Telefone', 'Cidade', 'Estado', 'Situação', 'Razão Social'];
const semente = Number.parseInt(RODADA, 36);

test('cadastros: nada entra antes de aplicar; repetido só se liga pelo documento', async ({ page }) => {
  const erros = vigiarErros(page);
  const doc = cnpj(semente);
  const arquivo = await xlsx([
    CAB,
    [`Gráfica Importada imp${RODADA}`, doc, '', '', 'Bauru', 'SP', 'Ativo', ''],
    [`Sem Documento imp${RODADA}`, '', '', '3333-4444', '', ' ', 'Inativo', ''],
    [`Gráfica Importada Filial imp${RODADA}`, doc, '', '', '', '', 'Ativo', ''],
  ]);
  await entrar(page);
  await abrir(page, '/gestao-empresarial/configuracoes/importacao');
  await page.getByLabel('O que está no arquivo').selectOption('fornecedores');
  await page.locator('#arquivo-importacao').setInputFiles({ name: `fornecedores-${RODADA}.xlsx`, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: arquivo });
  const linha = page.getByRole('row', { name: new RegExp(`fornecedores-${RODADA}`) });
  await expect(linha).toContainText('Em revisão');

  const t = await tokenDaApi();
  const antes = await api<{ total: number }>(t, 'GET', `/cadastros/pessoas?q=imp${RODADA}`);
  expect(antes.total).toBe(0);

  await linha.getByRole('link', { name: 'Abrir' }).click();
  await expect(page.getByRole('button', { name: /Duplicado provável/ })).toContainText('1');
  await page.getByRole('button', { name: 'Aplicar', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Aplicar', exact: true }).click();
  await expect(page.getByRole('button', { name: /Aplicada/ })).toContainText('2');
  await page.getByRole('button', { name: 'Ligar repetidos pelo documento' }).click();
  await page.getByRole('button', { name: 'Aplicar', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Aplicar', exact: true }).click();
  await expect(page.getByText(/aplicado$/).first()).toBeVisible();

  const depois = await api<{ total: number; items: Array<{ name: string; documentValid: boolean | null; state: string | null; status: string }> }>(t, 'GET', `/cadastros/pessoas?q=imp${RODADA}&pageSize=10`);
  expect(depois.total).toBe(2);
  expect(depois.items.find((p) => p.name.startsWith('Sem Documento'))).toMatchObject({ status: 'inativo', state: null, documentValid: null });
  expect(erros).toEqual([]);
});

test('lançamentos: o cedente espera decisão, e "sem vínculo" guarda o nome', async ({ page }) => {
  const erros = vigiarErros(page);
  const cab = 'operand_id,venc_pgto,competencia,faturamento,categoria,titulo,parcela,relacionado_codigo,relacionado_ref,sacado_cedente,doc_nf,status,valor_brl,valor_num,rel_tipo,rel_id,ano_venc_pgto';
  const csv = [cab, `e2e-${RODADA}-1,10/03/2099,01/03/2099,,Receitas,"Banner, lona ${RODADA}",1/2,PRO 1,,Cedente ${RODADA},,Quitado,"R$ 1.000,50",1000.50,producao,1,2099`, `e2e-${RODADA}-2,10/04/2099,01/03/2099,,Receitas,Evento ${RODADA},2/2,PRO 1,,Cedente ${RODADA},,Cancelado,"R$ 99,00",99.00,producao,1,2099`].join('\n');
  await entrar(page);
  await abrir(page, '/gestao-empresarial/configuracoes/importacao');
  await page.getByLabel('O que está no arquivo').selectOption('lancamentos');
  await page.locator('#arquivo-importacao').setInputFiles({ name: `lancamentos-${RODADA}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('row', { name: new RegExp(`lancamentos-${RODADA}`) }).getByRole('link', { name: 'Abrir' }).click();
  await expect(page.getByRole('button', { name: /Precisa de vínculo/ })).toContainText('2');
  await expect(page.getByRole('button', { name: 'Aplicar', exact: true })).toBeDisabled();

  await page.getByRole('tab', { name: /Cedentes/ }).click();
  const ced = page.getByRole('listitem').filter({ hasText: `Cedente ${RODADA}` });
  await expect(ced).toContainText('2 linhas');
  await expect(ced).toContainText('R$ 1.099,50');
  await ced.getByRole('button', { name: /Importar sem vínculo/ }).click();
  await page.getByRole('button', { name: 'Aplicar', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Aplicar', exact: true }).click();
  await expect(page.getByText(/aplicado$/).first()).toBeVisible();

  const t = await tokenDaApi();
  const r = await api<{ items: Array<{ status: string; partyLabel: string; paidAt: string | null; paidAtUnknown: boolean; amountCents: number; description: string }> }>(t, 'GET', `/financeiro/lancamentos?q=${RODADA}&pageSize=10`);
  const quitado = r.items.find((i) => i.status === 'quitado')!;
  expect(quitado).toMatchObject({ partyLabel: `Cedente ${RODADA}`, paidAt: null, paidAtUnknown: true, amountCents: 100050, description: `Banner, lona ${RODADA}` });
  expect(r.items.find((i) => i.status === 'cancelado')).toMatchObject({ amountCents: 9900 });
  expect(erros).toEqual([]);
});

test('o mesmo arquivo não entra duas vezes', async ({ page }) => {
  await entrar(page);
  const arquivo = await xlsx([CAB, [`Única ${RODADA}`, '', '', '', '', '', 'Ativo', '']]);
  await abrir(page, '/gestao-empresarial/configuracoes/importacao');
  for (let i = 0; i < 2; i++) await page.locator('#arquivo-importacao').setInputFiles({ name: `unica-${RODADA}.xlsx`, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: arquivo });
  await expect(page.getByRole('alert').filter({ hasText: 'já foi importado' })).toBeVisible();
});

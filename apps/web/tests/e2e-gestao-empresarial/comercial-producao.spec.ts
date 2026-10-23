import { expect, test } from '@playwright/test';
import { abrir, api, entrar, RODADA, tokenDaApi, vigiarErros } from './ajuda';

test.describe.configure({ mode: 'serial' });

test('comercial: proposta com itens → aprovada → pedido → faturado em contas a receber', async ({ page }) => {
  const erros = vigiarErros(page);
  const t = await tokenDaApi();
  await api(t, 'POST', '/cadastros/pessoas', { name: `Cliente Comercial ${RODADA}`, roles: ['cliente'] });
  await entrar(page);
  await abrir(page, '/gestao-empresarial/comercial/propostas');

  await page.getByRole('button', { name: 'Nova proposta' }).click();
  const nova = page.getByRole('dialog', { name: 'Nova proposta' });
  await nova.getByLabel('Título *').fill(`Campanha E2E ${RODADA}`);
  await nova.getByRole('searchbox').fill(`Cliente Comercial ${RODADA}`);
  await nova.getByRole('option').getByRole('button', { name: new RegExp(`Cliente Comercial ${RODADA}`) }).click();
  await nova.getByRole('button', { name: 'Adicionar item' }).click();
  await nova.getByLabel('Descrição').fill('Banner 3x2');
  await nova.getByLabel('Qtd.').fill('3');
  await nova.getByLabel('Preço unitário').fill('333,33');
  await nova.getByLabel('Desconto').fill('0,99');
  // 3 × 333,33 − 0,99 = 999,00, em centavos exatos
  await expect(nova.getByText('R$ 999,00')).toBeVisible();
  await nova.getByRole('button', { name: 'Criar proposta' }).click();
  await expect(page).toHaveURL(/\/comercial\/propostas\/[0-9a-f-]{36}$/);

  const acoes = page.getByRole('group', { name: 'Mudar situação' });
  await acoes.getByRole('button', { name: 'Marcar como enviada' }).click();
  await acoes.getByRole('button', { name: 'Aprovar' }).click();
  await acoes.getByRole('button', { name: 'Gerar pedido de venda' }).click();

  await abrir(page, '/gestao-empresarial/comercial/pedidos');
  const linha = page.getByRole('row', { name: new RegExp(`Campanha E2E ${RODADA}`) });
  await expect(linha).toContainText('R$ 999,00');
  await linha.getByRole('button', { name: 'Faturar' }).click();
  const fat = page.getByRole('dialog', { name: /Faturar/ });
  await fat.getByLabel('Parcelas', { exact: true }).fill('2');
  await fat.getByLabel('Primeiro vencimento').fill('2099-03-31');
  await expect(fat.getByRole('list', { name: 'Prévia das parcelas' })).toContainText('R$ 499,50');
  await fat.getByRole('button', { name: /^Faturar/ }).click();
  const feito = page.getByRole('dialog', { name: /faturado$/ });
  await expect(feito).toContainText('2 contas a receber criadas');
  await expect(feito.getByRole('link', { name: 'Ver no financeiro' })).toBeVisible();

  const lanc = await api<{ items: Array<{ amountCents: number; dueDate: string; relatedKind: string }>; total: number }>(t, 'GET', `/financeiro/lancamentos?q=${encodeURIComponent(`Campanha E2E ${RODADA}`)}&pageSize=10`);
  expect(lanc.total).toBe(2);
  expect(lanc.items.map((l) => l.amountCents).sort()).toEqual([49950, 49950]);
  expect(lanc.items.map((l) => l.dueDate).sort()).toEqual(['2099-03-31', '2099-04-30']);
  expect(erros).toEqual([]);
});

test('produção: cotações comparadas → escolha → pedido → custo → despesa no financeiro', async ({ page }) => {
  const erros = vigiarErros(page);
  const t = await tokenDaApi();
  for (const n of ['Barato', 'Caro']) await api(t, 'POST', '/cadastros/pessoas', { name: `Gráfica ${n} ${RODADA}`, roles: ['fornecedor'] });
  await entrar(page);
  await abrir(page, '/gestao-empresarial/producao/solicitacoes');
  await page.getByRole('button', { name: /Nova solicitação/ }).click();
  const nova = page.getByRole('dialog', { name: 'Nova solicitação de produção' });
  await nova.getByLabel('O que precisa ser produzido *').fill(`Adesivagem E2E ${RODADA}`);
  await nova.getByRole('button', { name: /Criar|Abrir|Salvar/ }).last().click();
  await expect(page).toHaveURL(/\/producao\/solicitacoes\/[0-9a-f-]{36}$/);

  for (const [n, v] of [['Caro', '1.800,00'], ['Barato', '1.200,00']] as const) {
    await page.getByRole('button', { name: 'Registrar cotação' }).first().click();
    const d = page.getByRole('dialog', { name: 'Registrar cotação' });
    await d.getByRole('searchbox').fill(`Gráfica ${n} ${RODADA}`);
    await d.getByRole('option').getByRole('button', { name: new RegExp(`Gráfica ${n} ${RODADA}`) }).click();
    await d.getByLabel('Valor total da cotação *').fill(v);
    await d.getByRole('button', { name: 'Registrar cotação' }).click();
    await expect(d).toBeHidden();
  }
  const barato = page.getByRole('row', { name: new RegExp(`Gráfica Barato ${RODADA}`) });
  await expect(page.getByRole('row', { name: new RegExp(`Gráfica Caro ${RODADA}`) })).toContainText('R$ 600,00');
  await barato.getByRole('button', { name: 'Escolher' }).click();
  await page.getByRole('dialog', { name: 'Escolher esta cotação?' }).getByRole('button', { name: 'Escolher' }).click();
  await page.getByRole('button', { name: 'Abrir pedido de produção' }).click();
  const ped = page.getByRole('dialog', { name: 'Abrir pedido de produção' });
  await ped.getByLabel('Valor cobrado do cliente').fill('2.000,00');
  await ped.getByRole('button', { name: 'Abrir pedido', exact: true }).click();
  await expect(page).toHaveURL(/\/producao\/pedidos\/[0-9a-f-]{36}$/);

  await page.getByRole('button', { name: 'Adicionar custo' }).click();
  const custo = page.getByRole('dialog', { name: 'Adicionar custo' });
  await custo.getByLabel('Descrição *').fill('Material');
  await custo.getByLabel('Valor *').fill('1.500,00');
  await custo.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await expect(custo).toBeHidden();
  const resumo = page.getByRole('region', { name: 'Resumo financeiro' }).or(page.locator('[aria-label="Resumo financeiro"]'));
  await expect(resumo.first()).toContainText('R$ 500,00');
  await expect(resumo.first()).toContainText('25');

  await page.getByRole('button', { name: 'Gerar despesa' }).first().click();
  const desp = page.getByRole('dialog', { name: 'Gerar despesa no financeiro' });
  await desp.getByLabel('Vencimento').fill('2099-05-10');
  await desp.getByRole('button', { name: 'Gerar despesa' }).click();
  await expect(desp).toBeHidden();
  await expect(page.getByRole('button', { name: 'Gerar despesa' })).toHaveCount(0);

  const desps = await api<{ items: Array<{ amountCents: number; kind: string; status: string }>; total: number }>(t, 'GET', `/financeiro/lancamentos?kind=despesa&q=Material&pageSize=50`);
  expect(desps.items.some((d) => d.amountCents === 150000 && d.status === 'aberto')).toBe(true);
  expect(erros).toEqual([]);
});

test('relatórios abrem sem erro e o CSV baixa', async ({ page }) => {
  const erros = vigiarErros(page);
  await entrar(page);
  for (const r of ['atraso', 'resultado', 'rentabilidade', 'funil']) {
    await abrir(page, `/gestao-empresarial/relatorios/${r}`);
    await expect(page.getByText('Não conseguimos')).toHaveCount(0);
  }
  await abrir(page, '/gestao-empresarial/relatorios/atraso');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Exportar|CSV/ }).first().click();
  const arquivo = await download;
  expect(arquivo.suggestedFilename()).toMatch(/\.csv$/);
  expect(erros).toEqual([]);
});

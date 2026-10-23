import { expect, test } from '@playwright/test';
import { abrir, api, COLABORADOR, entrar, RODADA, semRolagemHorizontal, tokenDaApi, vigiarErros } from './ajuda';

test.describe.configure({ mode: 'serial' });

test('colaborador não vê o módulo, nem no menu nem pelo endereço', async ({ page }) => {
  const erros = vigiarErros(page);
  await entrar(page, COLABORADOR);
  await abrir(page, '/today');
  // A ausência só prova algo se o menu estiver de fato na tela.
  await expect(page.getByRole('link', { name: 'Calendário' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Gestão Empresarial' })).toHaveCount(0);
  await abrir(page, '/gestao-empresarial');
  await expect(page.getByText('Gestão Empresarial não está disponível')).toBeVisible();
  expect(erros).toEqual([]);
});

test('administrador vê o item único no menu e as sete seções', async ({ page }) => {
  const erros = vigiarErros(page);
  await entrar(page);
  await abrir(page, '/today');
  await page.getByRole('link', { name: 'Gestão Empresarial' }).first().click();
  await expect(page).toHaveURL(/\/gestao-empresarial$/);
  const secoes = page.getByRole('navigation', { name: 'Gestão Empresarial' });
  for (const s of ['Visão geral', 'Financeiro', 'Comercial', 'Produção', 'Cadastros', 'Relatórios', 'Configurações']) await expect(secoes.getByRole('link', { name: s })).toBeVisible();
  expect(erros).toEqual([]);
});

test('financeiro: parcelar, receber, estornar e transferir pela interface', async ({ page }) => {
  const erros = vigiarErros(page);
  await entrar(page);

  // Duas contas: uma com saldo inicial, outra sem (saldo "—", nunca zero presumido).
  await abrir(page, '/gestao-empresarial/financeiro/contas');
  for (const [nome, saldo] of [[`Banco E2E ${RODADA}`, '1.000,00'], [`Caixa E2E ${RODADA}`, '']] as const) {
    await page.getByRole('button', { name: 'Nova conta' }).click();
    const d = page.getByRole('dialog', { name: 'Nova conta' });
    await d.getByLabel('Nome').fill(nome);
    if (saldo) {
      await d.getByLabel('Saldo inicial (opcional)').fill(saldo);
      await d.getByLabel('Data do saldo inicial').fill('2026-01-01');
    }
    await d.getByRole('button', { name: 'Criar conta' }).click();
    await expect(d).toBeHidden();
  }
  const linhaBanco = page.getByRole('row', { name: new RegExp(`Banco E2E ${RODADA}`) });
  await expect(linhaBanco).toContainText('R$ 1.000,00');
  await expect(page.getByRole('row', { name: new RegExp(`Caixa E2E ${RODADA}`) })).toContainText('—');

  // R$ 100,00 em 3 parcelas: 33,34 + 33,33 + 33,33, somando exatamente o total.
  await abrir(page, '/gestao-empresarial/financeiro/receber');
  await page.getByRole('button', { name: 'Novo a receber' }).click();
  const novo = page.getByRole('dialog', { name: 'Novo valor a receber' });
  await novo.getByLabel('Descrição').fill(`Mensalidade E2E ${RODADA}`);
  await novo.getByLabel('Valor total', { exact: false }).or(novo.getByLabel('Valor', { exact: true })).first().fill('100,00');
  await novo.getByRole('spinbutton', { name: 'Parcelas' }).fill('3');
  await novo.getByLabel('Vencimento da 1ª parcela').fill('2099-01-31');
  await novo.getByRole('button', { name: 'Lançar' }).click();
  await expect(novo).toBeHidden();
  await page.getByLabel('Buscar na descrição').fill(`Mensalidade E2E ${RODADA}`);
  await page.getByLabel('Buscar na descrição').press('Enter');
  const linhas = page.getByRole('row', { name: new RegExp(`Mensalidade E2E ${RODADA}`) });
  await expect(linhas).toHaveCount(3);
  await expect(page.getByText('R$ 100,00').first()).toBeVisible();
  for (const [venc, valor] of [['31/01/2099', 'R$ 33,34'], ['28/02/2099', 'R$ 33,33'], ['31/03/2099', 'R$ 33,33']]) {
    await expect(page.getByRole('row', { name: new RegExp(venc) })).toContainText(valor);
  }

  // Receber a 1ª parcela na conta Banco: o saldo sobe exatamente R$ 33,34.
  await page.getByRole('row', { name: /31\/01\/2099/ }).getByRole('button', { name: 'Receber' }).click();
  const baixa = page.getByRole('dialog', { name: 'Registrar recebimento' });
  await baixa.getByLabel('Conta').selectOption({ label: `Banco E2E ${RODADA}` });
  await baixa.getByRole('button', { name: 'Confirmar' }).click();
  await expect(baixa).toBeHidden();
  await expect(page.getByRole('row', { name: /31\/01\/2099/ })).toContainText('Quitado');
  await abrir(page, '/gestao-empresarial/financeiro/contas');
  await expect(linhaBanco).toContainText('R$ 1.033,34');

  // Estornar: o lançamento volta a aberto e o saldo volta ao inicial.
  await abrir(page, `/gestao-empresarial/financeiro/receber?q=${encodeURIComponent(`Mensalidade E2E ${RODADA}`)}`);
  await page.getByRole('row', { name: /31\/01\/2099/ }).getByRole('button', { name: 'Estornar' }).click();
  const estorno = page.getByRole('dialog', { name: 'Estornar baixa' });
  await estorno.getByLabel('Motivo').fill('Recebido na conta errada (teste E2E)');
  await estorno.getByRole('button', { name: 'Estornar baixa' }).click();
  await expect(estorno).toBeHidden();
  await expect(page.getByRole('row', { name: /31\/01\/2099/ })).toContainText('Em aberto');
  await abrir(page, '/gestao-empresarial/financeiro/contas');
  await expect(linhaBanco).toContainText('R$ 1.000,00');

  // Transferir R$ 250,00 do Banco para o Caixa: o Banco cai, o Caixa (sem saldo inicial) segue "—".
  await page.getByRole('button', { name: 'Transferir' }).click();
  const tr = page.getByRole('dialog', { name: 'Transferir entre contas' });
  await tr.getByLabel('Sai da conta').selectOption({ label: `Banco E2E ${RODADA}` });
  await tr.getByLabel('Entra na conta').selectOption({ label: `Caixa E2E ${RODADA}` });
  await tr.getByLabel('Valor').fill('250,00');
  await tr.getByRole('button', { name: 'Transferir' }).click();
  await expect(tr).toBeHidden();
  await expect(linhaBanco).toContainText('R$ 750,00');
  await expect(page.getByRole('row', { name: new RegExp(`Caixa E2E ${RODADA}`) })).toContainText('R$ 250,00');

  expect(erros).toEqual([]);
});

test('financeiro no celular: sem rolagem horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await entrar(page);
  for (const c of ['/gestao-empresarial', '/gestao-empresarial/financeiro/receber', '/gestao-empresarial/financeiro/contas']) {
    await abrir(page, c);
    await semRolagemHorizontal(page);
  }
});

void api;
void tokenDaApi;

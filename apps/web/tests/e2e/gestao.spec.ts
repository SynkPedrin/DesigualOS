import { execFileSync } from 'node:child_process';
import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * GESTÃO DA EQUIPE no navegador, contra a pilha LOCAL (docs/comunicacao-interna.md),
 * com a Tammy (administradora, tela inicial '/gestao') e a equipe de E2E.
 * Nunca contra produção.
 *
 *   E2E_COMUNICACAO=1 E2E_BASE_URL=http://localhost:3190 pnpm exec playwright test tests/e2e/gestao.spec.ts
 */
test.skip(!process.env.E2E_COMUNICACAO, 'só com a pilha local (E2E_COMUNICACAO=1)');
test.describe.configure({ mode: 'serial' });

const SENHA = process.env.E2E_COMUNICACAO_SENHA ?? 'e2e-senha';

function sql(q: string): string {
  return execFileSync('docker', ['exec', 'chat-qa-pg', 'psql', '-U', 'postgres', '-d', process.env.E2E_DB ?? 'e2e_chat', '-tAc', q], { encoding: 'utf8' }).trim();
}

// Agenda de AGORA para o arquivo todo (o seed fixo envelhece de um dia para o outro).
test.beforeAll(() => {
  sql(`update calendar_events set start_at = now() - interval '15 minutes', end_at = now() + interval '45 minutes' where source = 'e2e-gestao' and title like 'Reunião de pauta%'`);
  sql(`update calendar_events set start_at = now() + interval '3 hours', end_at = now() + interval '4 hours' where source = 'e2e-gestao' and title = 'Médico'`);
  sql(`update calendar_events set start_at = now() + interval '1 hour', end_at = now() + interval '2 hours' where source = 'e2e-gestao' and title like 'Revisão das peças%'`);
  sql(`update calendar_events set start_at = now() + interval '1 day', end_at = now() + interval '1 day 1 hour' where source = 'e2e-gestao' and title like 'Apresentação do relatório%'`);
});

async function entrar(browser: Browser, email: string, viewport = { width: 1440, height: 900 }): Promise<Page> {
  const contexto = await browser.newContext({ viewport });
  await contexto.addInitScript(() => {
    // tutorial de boas-vindas já visto, para qualquer id
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function (k: string) { return k.startsWith('desigual-os:tutorial-visto:') ? '1' : original.call(this, k); };
  });
  const page = await contexto.newPage();
  page.setDefaultTimeout(20_000);
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(SENHA);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 45_000 });
  return page;
}

test('Tammy entra direto na gestão da equipe e vê cada colaborador', async ({ browser }) => {
  const tammy = await entrar(browser, 'tammy@e2e.test');
  await expect(tammy).toHaveURL(/\/gestao$/, { timeout: 20_000 });
  await expect(tammy.getByRole('heading', { name: 'Gestão da equipe' })).toBeVisible();
  const ana = tammy.getByRole('link', { name: 'Abrir Ana Ribeiro' });
  await expect(ana).toBeVisible();
  // a equipe não inclui a própria administradora
  await expect(tammy.getByRole('link', { name: 'Abrir Tammy Gestora' })).toHaveCount(0);
  // em reunião agora, compromisso particular só como "Ocupado"
  await expect(ana).toContainText('Em reunião até');
  await expect(ana).toContainText('Ocupado');
  await expect(tammy.getByText('Médico')).toHaveCount(0);
  // Bruno sem Outlook: o cartão diz, não esconde
  await expect(tammy.getByRole('link', { name: 'Abrir Bruno Lima' })).toContainText('Não conectou o Outlook');
  await expect(ana).toContainText('Quinzenas: 2');
  await expect(ana).toContainText('1 atrasada');
  await tammy.waitForTimeout(400);
  await tammy.screenshot({ path: 'test-results/gestao-equipe.png', fullPage: true });

  await ana.click();
  await expect(tammy).toHaveURL(/\/gestao\/aaaaaaaa-0000-4000-8000-000000000001$/);
  await expect(tammy.getByRole('heading', { name: 'Ana Ribeiro' })).toBeVisible();
  await expect(tammy.getByRole('region', { name: 'Agenda dos próximos 7 dias' })).toContainText('Reunião de pauta com o Café Aurora');
  await expect(tammy.getByRole('region', { name: 'Agenda dos próximos 7 dias' })).toContainText('Apresentação do relatório mensal');
  await expect(tammy.getByRole('region', { name: 'Quinzenas' })).toContainText('Quinzena 2 de outubro');
  await expect(tammy.getByRole('region', { name: 'O que andou fazendo' })).toContainText('Carrossel de outubro');
  await tammy.waitForTimeout(300);
  await tammy.screenshot({ path: 'test-results/gestao-colaborador.png', fullPage: true });

  // a Visão geral continua alcançável pelo menu (a tela inicial só vale na entrada)
  await tammy.getByRole('link', { name: 'Visão geral' }).first().click();
  await expect(tammy).toHaveURL(/\/$/);
  await tammy.waitForTimeout(1500);
  await expect(tammy).toHaveURL(/\/$/);
  await tammy.context().close();
});

test('celular: os cartões cabem inteiros na tela', async ({ browser }) => {
  const tammy = await entrar(browser, 'tammy@e2e.test', { width: 390, height: 844 });
  await expect(tammy).toHaveURL(/\/gestao$/, { timeout: 20_000 });
  await expect(tammy.getByRole('link', { name: 'Abrir Ana Ribeiro' })).toBeVisible();
  const largura = await tammy.evaluate(() => document.documentElement.scrollWidth);
  expect(largura).toBeLessThanOrEqual(390);
  await tammy.screenshot({ path: 'test-results/gestao-celular.png', fullPage: true });
  await tammy.context().close();
});

test('colaborador não vê o item no menu nem abre a tela', async ({ browser }) => {
  const ana = await entrar(browser, 'ana@e2e.test');
  await expect(ana).not.toHaveURL(/\/gestao/);
  await expect(ana.getByRole('link', { name: 'Gestão da equipe' })).toHaveCount(0);
  await ana.goto('/gestao');
  await expect(ana.getByText('Acesso restrito')).toBeVisible();
  await expect(ana.getByRole('link', { name: /Abrir / })).toHaveCount(0);
  await ana.context().close();
});

test('Hoje da gestão: a equipe ao vivo no Hoje de quem administra', async ({ browser }) => {
  test.setTimeout(150_000); // espera até dois ciclos do refetch de 30 s
  // Agenda e atividade de AGORA (o seed fixo de ontem já passou).
  sql(`update calendar_events set start_at = now() - interval '15 minutes', end_at = now() + interval '45 minutes' where source = 'e2e-gestao' and title like 'Reunião de pauta%'`);
  sql(`update calendar_events set start_at = now() + interval '3 hours', end_at = now() + interval '4 hours' where source = 'e2e-gestao' and title = 'Médico'`);
  const tammy = await entrar(browser, 'tammy@e2e.test');
  await tammy.goto('/today');
  const secao = tammy.getByRole('region', { name: 'Sua equipe agora' }).or(tammy.locator('[aria-label="Sua equipe agora"]'));
  await expect(secao).toBeVisible({ timeout: 20_000 });
  await expect(secao.getByText('ao vivo')).toBeVisible();
  await expect(secao.getByRole('link', { name: 'Abrir Ana Ribeiro' })).toContainText('Ana Ribeiro');
  await expect(secao.getByRole('link', { name: 'Abrir Bruno Lima' })).toContainText('Outlook não conectado');
  await expect(secao.getByText('Reunião de pauta com o Café Aurora').first()).toBeVisible();
  await expect(secao.getByText('Médico')).toHaveCount(0);
  await expect(secao.getByText('Ocupado').first()).toBeVisible();
  await expect(secao.getByRole('tab', { name: /Atrasadas/ })).toBeVisible();
  await tammy.waitForTimeout(500);
  await tammy.screenshot({ path: 'test-results/hoje-gestao.png', fullPage: true });

  // AO VIVO: atividade nova aparece sem recarregar a página (aba "Atividade" do dia da equipe).
  await secao.getByRole('tab', { name: /Atividade/ }).click();
  const marca = `Atividade ao vivo ${Date.now().toString(36)}`;
  sql(`insert into operational_events (source, type, summary, organization_id, user_id, occurred_at) select 'clickup', 'task.status', '${marca}', organization_id, 'aaaaaaaa-0000-4000-8000-000000000004', now() from organization_members where user_id = 'aaaaaaaa-0000-4000-8000-000000000004' limit 1`);
  // refetch de 30 s (o aviso pelo WebSocket só vem de webhook do ClickUp, que a pilha local não tem): até 2 ciclos
  await expect(secao.getByText(marca)).toBeVisible({ timeout: 75_000 });
  await tammy.context().close();
});

test('colaborador não vê a equipe no Hoje', async ({ browser }) => {
  const ana = await entrar(browser, 'ana@e2e.test');
  await ana.goto('/today');
  await expect(ana.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
  await ana.waitForTimeout(2000);
  await expect(ana.locator('[aria-label="Sua equipe agora"]')).toHaveCount(0);
  await ana.context().close();
});

import { test, expect } from '@playwright/test';
const EMAIL = process.env.STUDIO_TEST_EMAIL ?? '';
const PASSWORD = process.env.STUDIO_TEST_PASSWORD ?? '';
test.skip(!EMAIL || !PASSWORD, 'credenciais ausentes');

test('explora o formulário de geração', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('/login');
  await page.locator('input[type="email"], input[name="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"], input[name="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45000 });

  await page.goto('/studio');
  await page.waitForLoadState('networkidle');

  // seleciona um cliente (o select nativo da galeria)
  const select = page.locator('select').first();
  const opts = await select.locator('option').allTextContents();
  console.log('CLIENTES NO SELECT:', JSON.stringify(opts.slice(0, 12)));

  await page.getByRole('button', { name: /novo projeto/i }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'tests/e2e/shots/10-novo-projeto.png', fullPage: true });

  const textareas = await page.locator('textarea').count();
  const selects = await page.locator('select').count();
  const buttons = await page.getByRole('button').allTextContents();
  console.log('textareas:', textareas, '| selects:', selects);
  console.log('BOTOES:', JSON.stringify(buttons.slice(0, 25)));
});

import { test } from '@playwright/test';
const EMAIL = process.env.STUDIO_TEST_EMAIL ?? '';
const PASSWORD = process.env.STUDIO_TEST_PASSWORD ?? '';
test.skip(!EMAIL || !PASSWORD, 'credenciais ausentes');
test('dump do modal', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/login');
  await page.locator('input[type="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45000 });
  await page.goto('/studio');
  await page.getByRole('button', { name: /novo projeto/i }).waitFor({ state: 'visible', timeout: 45000 });
  await page.getByRole('button', { name: /novo projeto/i }).click();
  await page.waitForTimeout(2500);

  // Acha o container do modal pelo título e lista os botões DELE.
  const modal = page.locator('div').filter({ hasText: /TIPO DE CONTE/i }).last();
  const btns = modal.locator('button');
  const n = await btns.count();
  console.log('botoes no modal:', n);
  for (let i = 0; i < Math.min(n, 30); i++) {
    const b = btns.nth(i);
    console.log(`  [${i}] text="${(await b.innerText().catch(()=>'')).replace(/\n/g,'|')}" visible=${await b.isVisible().catch(()=>false)}`);
  }
});

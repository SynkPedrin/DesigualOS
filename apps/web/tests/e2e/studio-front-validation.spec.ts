import { test, expect } from '@playwright/test';

const EMAIL = process.env.STUDIO_TEST_EMAIL ?? '';
const PASSWORD = process.env.STUDIO_TEST_PASSWORD ?? '';

// Sem credencial a suíte não roda (CI não tem o usuário de teste). Pular é
// correto aqui: falhar deixaria o CI vermelho por ausência de segredo, não
// por regressão de produto.
test.skip(!EMAIL || !PASSWORD, 'defina STUDIO_TEST_EMAIL/STUDIO_TEST_PASSWORD');

/**
 * FRONT TEST 01 (parte 1) — login REAL pelo formulário, do jeito que o
 * colaborador entra. Sem token fabricado, sem service key.
 */
test('login real pelo formulário e chegada ao Studio', async ({ page }) => {
  await page.goto('/login');
  await page.screenshot({ path: 'tests/e2e/shots/01-login.png' });

  // Descobre os campos pelo que o usuário vê, não por data-testid inventado.
  const email = page.locator('input[type="email"], input[name="email"]').first();
  const senha = page.locator('input[type="password"], input[name="password"]').first();
  await email.fill(EMAIL);
  await senha.fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();

  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45000 });
  await page.screenshot({ path: 'tests/e2e/shots/02-after-login.png', fullPage: true });
  console.log('URL após login:', page.url());

  await page.goto('/studio');
  await page.waitForLoadState('networkidle', { timeout: 45000 });
  await page.screenshot({ path: 'tests/e2e/shots/03-studio.png', fullPage: true });
  expect(page.url()).toContain('/studio');
});

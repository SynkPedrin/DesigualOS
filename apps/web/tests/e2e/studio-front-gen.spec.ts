import { test, expect } from '@playwright/test';
const EMAIL = process.env.STUDIO_TEST_EMAIL ?? '';
const PASSWORD = process.env.STUDIO_TEST_PASSWORD ?? '';
const CLIENTE = process.env.STUDIO_TEST_CLIENT ?? 'Clinica Teste Fase 7';
const PROMPT = process.env.STUDIO_TEST_PROMPT ?? 'Campanha publicitária premium de um tênis esportivo preto sobre superfície molhada, fotografia comercial cinematográfica, iluminação lateral dramática, estética de campanha internacional';
test.skip(!EMAIL || !PASSWORD, 'credenciais ausentes');

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.locator('input[type="email"], input[name="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"], input[name="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45000 });
}

test('FRONT 01 - gera imagem sem referência pela interface real', async ({ page }) => {
  test.setTimeout(20 * 60 * 1000);
  const apiCalls: string[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/studio/')) apiCalls.push(`${r.status()} ${r.request().method()} ${r.url().replace(/.*\/studio/, '/studio')}`);
  });

  await login(page);
  await page.goto('/studio');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: /novo projeto/i }).click();
  await page.waitForTimeout(1500);

  // cliente (o select DENTRO do painel de novo projeto)
  const painel = page.locator('select').filter({ hasText: CLIENTE }).first();
  await painel.selectOption({ label: CLIENTE });

  // tipo = Imagem
  await page.getByRole('button', { name: 'Imagem', exact: true }).first().click();
  await page.waitForTimeout(400);

  await page.locator('textarea').first().fill(PROMPT);
  await page.screenshot({ path: 'tests/e2e/shots/20-form-preenchido.png', fullPage: true });

  const gerar = page.getByRole('button', { name: /gerar projeto/i });
  await expect(gerar).toBeEnabled({ timeout: 10000 });
  await gerar.click();

  // job criado -> acompanha pela UI
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'tests/e2e/shots/21-apos-gerar.png', fullPage: true });
  console.log('CHAMADAS API:', JSON.stringify(apiCalls));

  // Espera a peça aparecer. A UI faz polling sozinha; aqui só observamos.
  const deadline = Date.now() + 17 * 60 * 1000;
  let visto = '';
  while (Date.now() < deadline) {
    const txt = await page.locator('body').innerText();
    const m = txt.match(/gerando|processando|fila|conclu|pronto|falhou|erro|cancel/i);
    const agora = m?.[0] ?? '';
    if (agora && agora !== visto) { visto = agora; console.log(`[${new Date().toISOString().slice(11,19)}] UI:`, agora); }
    const imgs = await page.locator('img[src*="supabase"], img[src*="studio-assets"]').count();
    if (imgs > 0) { console.log('IMAGEM VISIVEL NA UI:', imgs); break; }
    await page.waitForTimeout(10000);
  }
  await page.screenshot({ path: 'tests/e2e/shots/22-resultado.png', fullPage: true });
  console.log('CHAMADAS API (final):', JSON.stringify(apiCalls.slice(-12)));
});

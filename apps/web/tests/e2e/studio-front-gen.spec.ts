import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.STUDIO_TEST_EMAIL ?? '';
const PASSWORD = process.env.STUDIO_TEST_PASSWORD ?? '';
const CLIENTE = process.env.STUDIO_TEST_CLIENT ?? 'Clinica Teste Fase 7';
const PROMPT = process.env.STUDIO_TEST_PROMPT ?? 'Campanha publicitária premium de um tênis esportivo preto sobre superfície molhada, fotografia comercial cinematográfica, iluminação lateral dramática, estética de campanha internacional';
const TAG = process.env.STUDIO_TEST_TAG ?? 'front01';

test.skip(!EMAIL || !PASSWORD, 'defina STUDIO_TEST_EMAIL/STUDIO_TEST_PASSWORD');

export async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45000 });
}

/** O modal do Studio cobre a galeria; os botões de fora ficam interceptados. */
function modalDo(page: Page) {
  return page.locator('div').filter({ hasText: /TIPO DE CONTE/i }).last();
}

test('FRONT 01 - gera imagem pela interface real e acompanha até a peça', async ({ page }) => {
  test.setTimeout(25 * 60 * 1000);
  const chamadas: string[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/studio/')) chamadas.push(`${r.status()} ${r.request().method()} ${r.url().replace(/.*\/studio/, '/studio').split('?')[0]}`);
  });

  await login(page);
  await page.goto('/studio');
  await page.getByRole('button', { name: /novo projeto/i }).waitFor({ state: 'visible', timeout: 45000 });
  await page.getByRole('button', { name: /novo projeto/i }).click();
  await page.waitForTimeout(2000);

  const modal = modalDo(page);
  for (let i = 0; i < (await page.locator('select').count()); i++) {
    await page.locator('select').nth(i).selectOption({ label: CLIENTE }).catch(() => {});
  }
  await modal.locator('button', { hasText: 'Imagem' }).first().click();
  await page.locator('textarea').first().fill(PROMPT);
  await page.screenshot({ path: `tests/e2e/shots/${TAG}-1-form.png`, fullPage: true });

  const gerar = modal.getByRole('button', { name: /gerar projeto/i });
  await expect(gerar).toBeEnabled({ timeout: 10000 });
  const t0 = Date.now();
  await gerar.click();
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `tests/e2e/shots/${TAG}-2-enviado.png`, fullPage: true });
  console.log('API apos enviar:', JSON.stringify([...new Set(chamadas)]));

  // Acompanha pela UI até a peça aparecer (ou falhar).
  const limite = Date.now() + 22 * 60 * 1000;
  let ultimo = '';
  while (Date.now() < limite) {
    const corpo = await page.locator('body').innerText().catch(() => '');
    const estado = (corpo.match(/na fila|gerando|processando|avaliando|refinando|finalizando|conclu\w+|pronto|falhou|erro/gi) ?? []).join(',');
    if (estado && estado !== ultimo) { ultimo = estado; console.log(`[+${Math.round((Date.now()-t0)/1000)}s] UI: ${estado}`); }
    if (await page.locator('img[src*="studio-assets"]').count() > 0) { console.log(`[+${Math.round((Date.now()-t0)/1000)}s] IMAGEM NA UI`); break; }
    if (/falhou|erro/i.test(corpo)) { console.log(`[+${Math.round((Date.now()-t0)/1000)}s] UI mostra erro`); break; }
    await page.waitForTimeout(8000);
  }
  await page.screenshot({ path: `tests/e2e/shots/${TAG}-3-resultado.png`, fullPage: true });
  console.log('total UI:', Math.round((Date.now()-t0)/1000), 's');
  console.log('API final:', JSON.stringify([...new Set(chamadas)]));
});

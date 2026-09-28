import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.QA_USER_EMAIL ?? '';
const PASSWORD = process.env.QA_USER_PASSWORD ?? '';

async function login(page: Page) {
  page.setDefaultTimeout(45_000);
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 45_000 });
}

async function falar(page: Page, texto: string, timeout = 90_000): Promise<string> {
  const mensagens = page.getByTestId('chat-assistant-message');
  const antes = await mensagens.count();
  const campo = page.getByRole('textbox').first();
  await campo.fill(texto);
  await campo.press('Enter');
  await expect(page.getByText(texto.slice(0, 30)).first()).toBeVisible({ timeout: 10_000 });
  const nova = mensagens.nth(antes);
  await expect(nova).toBeVisible({ timeout });
  const bolha = nova.getByTestId('chat-assistant-bubble');
  await expect.poll(async () => (await bolha.count()) > 0, { timeout }).toBe(true);
  await expect
    .poll(async () => {
      const a = (await bolha.innerText()).trim().length;
      await page.waitForTimeout(1200);
      const b = (await bolha.innerText()).trim().length;
      return a === b && a > 0;
    }, { timeout })
    .toBe(true);
  return (await bolha.innerText()).trim();
}

test('regressão: "e a segunda?" / "e o prazo?" não mutam mais uma task arbitrária', async ({ page }) => {
  test.setTimeout(600_000);
  await login(page);
  await page.goto('/chat');
  if (await page.getByText(/NOTIFICAÇÕES NOVAS/i).isVisible().catch(() => false)) await page.keyboard.press('Escape');
  const novo = page.getByRole('button', { name: /novo chat/i });
  if (await novo.isVisible().catch(() => false)) await novo.click();
  const chip = page.getByRole('button', { name: /^Bento$/i });
  if (await chip.isVisible().catch(() => false)) await chip.click();

  await falar(page, 'oi');
  const select = page.locator('select').first();
  await expect(select).toBeVisible({ timeout: 45_000 });
  await select.selectOption({ label: 'Cliente Teste 7' });

  const rA = await falar(page, 'quais são as demandas da Alícia?', 120_000);
  console.log('=== [A] ===\n', rA);

  const rSeg = await falar(page, 'e a segunda?', 60_000);
  console.log('=== [e a segunda?] ===\n', rSeg);
  expect(rSeg.toLowerCase()).not.toContain('não encontrei ninguém chamado');

  const rPrazo = await falar(page, 'e o prazo?', 60_000);
  console.log('=== [e o prazo?] ===\n', rPrazo);
  expect(rPrazo.toLowerCase()).not.toContain('não encontrei ninguém chamado');
});

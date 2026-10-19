import { test, expect, type Page } from '@playwright/test';

/**
 * tammy-regression-20260928-delete-latency — validação MÍNIMA e barata (3
 * turnos, não a bateria de 6) da correção de latência do INC-001: o
 * pre-check de delete fazia a MESMA chamada GET ao ClickUp duas vezes em
 * sequência (taskExiste() por dentro é getTask(), e getTask() rodava de
 * novo logo depois só pra pegar o nome). Mede o tempo real de parede do
 * pedido de exclusão e da confirmação, turno a turno.
 */

const EMAIL = process.env.QA_USER_EMAIL ?? '';
const PASSWORD = process.env.QA_USER_PASSWORD ?? '';
test.skip(!EMAIL || !PASSWORD, 'QA_USER_EMAIL/QA_USER_PASSWORD ausentes');

const CLIENTE_TESTE_7 = 'Cliente Teste 7';

async function login(page: Page) {
  page.setDefaultTimeout(45_000);
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 45_000 });
}

async function novoChat(page: Page, agente?: 'Bento' | 'Otto' | 'Jarbas' | 'AUTO') {
  await page.goto('/chat');
  if (await page.getByText(/NOTIFICAÇÕES NOVAS/i).isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
  }
  const novo = page.getByRole('button', { name: /novo chat/i });
  if (await novo.isVisible().catch(() => false)) await novo.click();
  if (agente) {
    const chip = page.getByRole('button', { name: new RegExp(`^${agente}\\b`, 'i') });
    if (await chip.isVisible().catch(() => false)) await chip.click();
  }
}

async function selecionaCliente(page: Page, cliente: string) {
  const select = page.locator('select').first();
  await expect(select).toBeVisible({ timeout: 45_000 });
  await select.selectOption({ label: cliente });
}

async function falar(page: Page, texto: string, timeout = 180_000): Promise<{ texto: string; ms: number }> {
  const mensagens = page.getByTestId('chat-assistant-message');
  const antes = await mensagens.count();
  const inicio = Date.now();
  const campo = page.getByRole('textbox').first();
  await campo.fill(texto);
  await campo.press('Enter');
  await expect(page.getByText(texto.slice(0, 30)).first()).toBeVisible({ timeout: 10_000 });

  const nova = mensagens.nth(antes);
  await expect(nova).toBeVisible({ timeout });
  const bolha = nova.getByTestId('chat-assistant-bubble');
  await expect
    .poll(async () => ((await bolha.count()) > 0 ? 'ok' : 'pensando'), { timeout })
    .toBe('ok');
  await expect
    .poll(
      async () => {
        const a = (await bolha.innerText()).trim().length;
        await page.waitForTimeout(1200);
        const b = (await bolha.innerText()).trim().length;
        return a === b && a > 0 ? 'estavel' : 'crescendo';
      },
      { timeout },
    )
    .toBe('estavel');
  const ms = Date.now() - inicio;
  return { texto: (await bolha.innerText()).trim(), ms };
}

test.describe('INC-001 regressão de latência — delete', () => {
  test.setTimeout(300_000);

  test('create → apaga essa task → confirma, medindo ms de parede por turno', async ({ page }) => {
    await login(page);
    await novoChat(page, 'Bento');
    await falar(page, 'oi');
    await selecionaCliente(page, CLIENTE_TESTE_7);

    const titulo = `QA LATENCIA DELETE ${Date.now()}`;
    const r1 = await falar(page, `cria uma task chamada ${titulo}`);
    console.log(`\n=== [1 CREATE] ${r1.ms}ms ===\n${r1.texto}`);

    const r2 = await falar(page, 'apaga essa task');
    console.log(`\n=== [2 DELETE pedido] ${r2.ms}ms ===\n${r2.texto}`);

    const r3 = await falar(page, 'sim, confirmo');
    console.log(`\n=== [3 DELETE confirmação] ${r3.ms}ms ===\n${r3.texto}`);

    console.log(`\n[titulo] ${titulo}`);
    console.log(`\n[TOTAL turnos 2+3 — o caminho que a correção tocou] ${r2.ms + r3.ms}ms`);
  });
});

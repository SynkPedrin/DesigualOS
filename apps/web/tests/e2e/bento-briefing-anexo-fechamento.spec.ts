import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/**
 * O ciclo real que os 1015 testes de unidade NÃO provam. Eles provam a fiação
 * (o core chama a cadeia de briefing, sobe o anexo, manda o statusHint); não
 * provam que o briefing sai BOM e que o ClickUp aceita o que mandamos.
 *
 * Aqui o alvo é a lista QA ("Cliente Teste 7" → space QA DESIGUAL OS), com um
 * pedido criativo de verdade e uma imagem anexada. A conferência do resultado
 * é feita FORA daqui, lendo a task no ClickUp pela API — este spec só conduz a
 * conversa e imprime o ID da task pra inspeção.
 */

const EMAIL = process.env.QA_USER_EMAIL ?? '';
const PASSWORD = process.env.QA_USER_PASSWORD ?? '';
test.skip(!EMAIL || !PASSWORD, 'QA_USER_EMAIL/QA_USER_PASSWORD ausentes');

const CLIENTE = 'Cliente Teste 7';
const PESSOA = 'Matheus Sain';
// `tests/e2e/artifacts` é ignorado pelo git, então a referência nasce aqui:
// um PNG 2x2 válido, que é tudo que o upload precisa pra ser real.
const IMAGEM = path.join(os.tmpdir(), 'qa-referencia.png');
fs.writeFileSync(
  IMAGEM,
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z4AATAxDVjAAAAD//wMAA2AA/1Pd4sYAAAAASUVORK5CYII=',
    'base64',
  ),
);

async function login(page: Page) {
  page.setDefaultTimeout(45_000);
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 45_000 });
}

async function falar(page: Page, texto: string, anexo?: string, timeout = 240_000) {
  const mensagens = page.getByTestId('chat-assistant-message');
  const antes = await mensagens.count();
  const inicio = Date.now();
  const enviar = page.getByRole('button', { name: 'Enviar mensagem' });
  if (anexo) {
    // O input do composer, não o de arquivos de projeto que também existe na
    // página. E o submit fica travado enquanto o upload não termina
    // (composer.tsx:135), então esperar o botão habilitar não é cosmético.
    await page.locator('form input[type="file"]').setInputFiles(anexo);
  }
  const campo = page.getByRole('textbox', { name: /pergunte para/i });
  await campo.fill(texto);
  await expect(enviar).toBeEnabled({ timeout: 120_000 });
  await enviar.click();

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
        await page.waitForTimeout(1500);
        const b = (await bolha.innerText()).trim().length;
        return a === b && a > 0 ? 'estavel' : 'crescendo';
      },
      { timeout },
    )
    .toBe('estavel');
  const r = { texto: (await bolha.innerText()).trim(), duplicadas: (await mensagens.count()) - antes - 1, ms: Date.now() - inicio };
  console.log(`\n=== ${texto.slice(0, 50)} (${r.ms}ms) ===\n${r.texto}`);
  if (r.duplicadas !== 0) console.log(`[ALERTA] bolhas extras: ${r.duplicadas}`);
  return r;
}

test('ciclo real — briefing do dossiê + anexo + fechamento', async ({ page }) => {
  test.setTimeout(900_000);
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[console.error] ${m.text().slice(0, 200)}`); });
  page.on('requestfailed', (r) => console.log(`[requestfailed] ${r.method()} ${r.url().slice(0, 120)} — ${r.failure()?.errorText}`));
  await login(page);
  await page.goto('/chat');
  const novo = page.getByRole('button', { name: /novo chat/i });
  if (await novo.isVisible().catch(() => false)) await novo.click();
  const chip = page.getByRole('button', { name: /^Bento\b/i });
  if (await chip.isVisible().catch(() => false)) await chip.click();

  await falar(page, 'oi');
  const select = page.locator('select').first();
  await expect(select).toBeVisible({ timeout: 45_000 });
  await select.selectOption({ label: CLIENTE });

  const titulo = `QA CICLO REAL ${Date.now()}`;

  const r1 = await falar(
    page,
    `Bento, cria a task "${titulo}" para a ${PESSOA}: um carrossel de 5 slides pro Instagram sobre manutenção preventiva das lavadoras, prazo pra amanhã. Segue a referência em anexo.`,
    IMAGEM,
  );
  expect(r1.duplicadas).toBe(0);

  const r2 = await falar(page, 'fecha essa task');
  expect(r2.duplicadas).toBe(0);

  console.log(`\n[TITULO DA TASK DESTE CICLO]: ${titulo}`);
});

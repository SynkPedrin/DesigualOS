import { test, expect } from '@playwright/test';

/**
 * Gate do release de confiabilidade de conhecimento, no NAVEGADOR publicado.
 *
 * Cobre o que a operação relatou em 16/09/2026:
 *  - resposta do agente fragmentada em várias caixas (a Tammy precisa copiar e
 *    reusar o conteúdo, e estava copiando pedaço por pedaço);
 *  - campanha existente não recuperada.
 */
const EMAIL = process.env.QA_USER_EMAIL ?? '';
const PASSWORD = process.env.QA_USER_PASSWORD ?? '';

test.skip(!EMAIL || !PASSWORD, 'QA_USER_EMAIL/QA_USER_PASSWORD ausentes');

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
}

async function perguntar(page: import('@playwright/test').Page, texto: string, timeout = 240_000) {
  const campo = page.getByRole('textbox').first();
  await campo.fill(texto);
  await campo.press('Enter');
  await expect(page.getByText(texto, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  // Espera a bolha do agente existir e ter resposta de verdade dentro.
  //
  // O primeiro assert aqui era /\S{40,}/, que exige 40 caracteres SEGUIDOS sem
  // espaço: prosa nenhuma casa isso, e o teste ficava pendurado até o timeout
  // mesmo com a resposta na tela. Medir o tamanho do texto é o que se queria.
  const bolhas = page.getByTestId('chat-assistant-bubble');
  await expect(bolhas.first()).toBeVisible({ timeout });
  await expect
    .poll(async () => (await bolhas.first().innerText()).trim().length, { timeout })
    .toBeGreaterThan(40);
}

test.describe('Knowledge reliability — navegador real', () => {
  test.setTimeout(420_000);

  test('one_execution_produces_one_assistant_bubble', async ({ page }) => {
    await login(page);
    await page.goto('/chat');
    await perguntar(page, 'Bento, quantas tarefas vencem hoje? Me explique em detalhe.');
    // Antes deste release a resposta virava um balão POR PARÁGRAFO.
    await expect(page.getByTestId('chat-assistant-bubble')).toHaveCount(1);
  });

  test('copy_button_copies_complete_final_message', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await login(page);
    await page.goto('/chat');
    await perguntar(page, 'Bento, quantas tarefas vencem hoje?');

    const bolha = page.getByTestId('chat-assistant-bubble').first();
    const textoNaTela = ((await bolha.innerText()) ?? '').trim();
    await page.getByTestId('chat-copy-button').first().click();
    const copiado = await page.evaluate(() => navigator.clipboard.readText());

    expect(copiado.length).toBeGreaterThan(30);
    // O copiado é o conteúdo da resposta, sem os controles da bolha.
    expect(copiado).not.toMatch(/Copiado|Encaminhar/);
    const primeiraFrase = copiado.split(/[.\n]/)[0]!.slice(0, 40);
    expect(textoNaTela).toContain(primeiraFrase);
  });

  test('otto_resolves_exact_campaign pelo nome que a operação fala', async ({ page }) => {
    await login(page);
    await page.goto('/chat');
    // A Tammy falou "Jardim Europa 5"; a fonte escreve "Europa V" (Cosentino).
    await perguntar(page, 'Otto, crie uma legenda para a campanha de aniversário do Jardim Europa 5.');
    // Lê a RESPOSTA, não a página: o seletor de clientes lista "Jardim do Lago"
    // como <option> e fazia a asserção falhar sozinha, com a resposta correta.
    const resposta = await page.getByTestId('chat-assistant-bubble').first().innerText();
    // Não pode entregar a campanha de OUTRO cliente (foi o que aconteceu:
    // veio peça do Jardim do Lago, em Penápolis).
    expect(resposta).not.toMatch(/Penápolis|Jardim do Lago/i);
    // E precisa ser a campanha certa, do cliente certo.
    expect(resposta).toMatch(/Europa|Cosentino/i);
  });
});

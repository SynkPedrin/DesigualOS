import { test, expect } from '@playwright/test';

/**
 * Bateria da arquitetura cognitiva, pelo NAVEGADOR publicado.
 *
 * O critério não é "respondeu": é se a resposta parece de alguém que trabalha
 * aqui. Cada teste abaixo falha se o agente inventar, se perder contexto entre
 * conversas, ou se vazar cliente.
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

/** Manda a pergunta e devolve o texto da RESPOSTA (não da página). */
async function perguntar(page: import('@playwright/test').Page, texto: string, timeout = 240_000): Promise<string> {
  const campo = page.getByRole('textbox').first();
  await campo.fill(texto);
  await campo.press('Enter');
  const bolha = page.getByTestId('chat-assistant-bubble').first();
  await expect(bolha).toBeVisible({ timeout });
  await expect.poll(async () => (await bolha.innerText()).trim().length, { timeout }).toBeGreaterThan(40);
  // ESPERA ESTABILIZAR. O balão renderiza com efeito de máquina de escrever, e
  // ler assim que passa de 40 caracteres captura a resposta pela metade: uma
  // asserção falhou com o texto cortado em "Tammy é", com a resposta certa
  // terminando de aparecer na tela. Duas leituras iguais seguidas = terminou.
  await expect
    .poll(
      async () => {
        const a = (await bolha.innerText()).trim().length;
        await page.waitForTimeout(1200);
        const b = (await bolha.innerText()).trim().length;
        return a === b ? 'estavel' : 'crescendo';
      },
      { timeout },
    )
    .toBe('estavel');
  return (await bolha.innerText()).trim();
}

async function novaConversa(page: import('@playwright/test').Page) {
  await page.goto('/chat');
  await page.getByRole('button', { name: /nova conversa|novo chat/i }).first().click().catch(() => {});
  await page.waitForTimeout(1500);
}

test.describe('Arquitetura cognitiva — navegador real', () => {
  test.setTimeout(600_000);

  test('bento_explica_a_fonte_sem_inventar', async ({ page }) => {
    await login(page);
    await page.goto('/chat');
    const r = await perguntar(page, 'Bento, quem trabalha na conta da Cosentino e de onde você tirou essa informação?');
    // Precisa citar gente real da conta e dizer a origem.
    expect(r).toMatch(/Tammy|Gui|Matheus|Endrigo/i);
    expect(r).toMatch(/ClickUp|registro|dossi|fonte|perfil/i);
  });

  test('pessoa_inexistente_e_declarada_ausente', async ({ page }) => {
    await login(page);
    await page.goto('/chat');
    const r = await perguntar(page, 'Bento, quais demandas a Esther possui?');
    // Esther não existe em nenhuma fonte: 0 de 19 membros, 0 de 7.408 tasks.
    expect(r).toMatch(/não|nao/i);
    expect(r).not.toMatch(/respons[áa]vel pela conta/i);
  });

  test('otto_resolve_campanha_e_nao_vaza_cliente', async ({ page }) => {
    await login(page);
    await page.goto('/chat');
    const r = await perguntar(page, 'Otto, me explique a campanha de aniversário do Jardim Europa 5.');
    expect(r).toMatch(/Europa|Cosentino/i);
    expect(r).not.toMatch(/Penápolis|Jardim do Lago|Top Tennis/i);
  });

  test('memoria_episodica_atravessa_conversa_nova', async ({ page }) => {
    await login(page);
    await page.goto('/chat');
    // Conversa 1: ensina uma decisão.
    await perguntar(page, 'Decidimos que a comunicação da Cosentino vai priorizar legado e permanência, não preço.');

    // Conversa NOVA: o conhecimento tem que atravessar.
    await novaConversa(page);
    const r = await perguntar(page, 'Bento, o que a gente decidiu hoje sobre a Cosentino?');
    expect(r).toMatch(/legado|permanência|permanencia/i);
  });
});

import { test, expect, type Page } from '@playwright/test';

/**
 * Busca de cliente na barra de pesquisa (pedido do usuário, 14/09/2026):
 * digitar o nome do cliente e cair DENTRO da conta dele, não na lista.
 *
 * Roda contra a API real (NEXT_PUBLIC_API_MODE=live) — o ponto do teste é
 * justamente provar que o caminho inteiro (ILIKE sem acento no Postgres ->
 * paleta -> deep link -> ficha) funciona ponta a ponta.
 */
const EMAIL = process.env.QA_USER_EMAIL ?? 'super@institutoalmada.org';
const PASSWORD = process.env.QA_USER_PASSWORD ?? '';
/** Sem acento de propósito: é assim que a equipe digita na pressa. */
const QUERY = process.env.QA_CLIENT_QUERY ?? 'agencia';
const CLIENT_NAME = process.env.QA_CLIENT_NAME ?? 'Agência Desigual';
/** Erro de digitação real do usuário: "consentino" para o cliente "Cosentino". */
const TYPO_QUERY = process.env.QA_TYPO_QUERY ?? 'consentino';
const TYPO_CLIENT = process.env.QA_TYPO_CLIENT ?? 'Cosentino';

test.skip(!PASSWORD, 'QA_USER_PASSWORD não definida — rode via scripts/qa');

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

async function openPalette(page: Page): Promise<void> {
  await page.getByRole('button', { name: /buscar/i }).first().click();
  await expect(page.getByPlaceholder(/Buscar telas/i)).toBeVisible();
}

/**
 * Digita e espera o cliente aparecer. Sem espera explícita isto fica flaky:
 * pelo caminho público (Funnel) o /search leva 1.2-2.5s.
 */
async function searchFor(page: Page, term: string, expected: RegExp): Promise<void> {
  await page.getByPlaceholder(/Buscar telas/i).fill(term);
  await expect(page.getByRole('option', { name: expected }).first()).toBeVisible({ timeout: 25_000 });
}

test.describe('busca de cliente', () => {
  test('nome sem acento acha o cliente e o Enter entra na conta', async ({ page }) => {
    await login(page);
    await openPalette(page);

    // O cliente precisa aparecer mesmo com "agencia" != "Agência".
    await searchFor(page, QUERY, new RegExp(CLIENT_NAME, 'i'));

    // Enter sem seta nenhuma: o grupo "Clientes" é o primeiro da lista, então
    // é o cliente que está selecionado — não um item de navegação.
    await page.getByPlaceholder(/Buscar telas/i).press('Enter');

    await expect(page).toHaveURL(/\/clients\?id=/, { timeout: 20_000 });
    // <h2> só existe na ficha aberta (os cards da roleta usam <p>): isto prova
    // que entrou na CONTA, não que parou na lista de clientes.
    await expect(page.getByRole('heading', { name: CLIENT_NAME })).toBeVisible({ timeout: 20_000 });
  });

  test('fechar a ficha e buscar o MESMO cliente de novo reabre a conta', async ({ page }) => {
    await login(page);
    await openPalette(page);
    await searchFor(page, QUERY, new RegExp(CLIENT_NAME, 'i'));
    await page.getByRole('option', { name: new RegExp(CLIENT_NAME, 'i') }).first().click();
    await expect(page.getByRole('heading', { name: CLIENT_NAME })).toBeVisible({ timeout: 25_000 });

    // Escopo em <main>: o X da ficha, não o "Fechar" de outros elementos da tela.
    await page.getByRole('main').getByRole('button', { name: 'Fechar' }).click();
    await expect(page.getByRole('heading', { name: CLIENT_NAME })).toHaveCount(0);

    // Segunda tentativa no MESMO cliente: antes do fix a URL continuava com o
    // ?id= antigo, o efeito não rodava de novo e o Enter não fazia nada.
    await openPalette(page);
    await searchFor(page, QUERY, new RegExp(CLIENT_NAME, 'i'));
    await page.getByRole('option', { name: new RegExp(CLIENT_NAME, 'i') }).first().click();
    await expect(page.getByRole('heading', { name: CLIENT_NAME })).toBeVisible({ timeout: 25_000 });
  });

  test('erro de digitação ainda acha o cliente e abre a conta', async ({ page }) => {
    await login(page);
    await openPalette(page);

    // "consentino" tem um "n" a mais que "Cosentino": nenhum casamento por
    // substring resolve isso, e o filtro do cmdk também escondia o resultado.
    await searchFor(page, TYPO_QUERY, new RegExp(TYPO_CLIENT, 'i'));
    await page.getByPlaceholder(/Buscar telas/i).press('Enter');

    await expect(page).toHaveURL(/\/clients\?id=/, { timeout: 25_000 });
    await expect(page.getByRole('heading', { name: new RegExp(TYPO_CLIENT, 'i') }).first()).toBeVisible({
      timeout: 25_000,
    });
  });

  test('termo sem sentido não inventa resultado', async ({ page }) => {
    await login(page);
    await openPalette(page);
    await page.getByPlaceholder(/Buscar telas/i).fill('xyzabc');
    await expect(page.getByText('Nenhum resultado encontrado.')).toBeVisible({ timeout: 25_000 });
  });
});

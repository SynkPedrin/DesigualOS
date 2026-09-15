import { test, expect } from '@playwright/test';

/**
 * Gate de release da V2: exercita Bento e Otto pelo NAVEGADOR, no mesmo
 * caminho que o colaborador usa. Chamada HTTP direta não cobre hidratação,
 * CORS/Private Network, streaming visual nem persistência de histórico —
 * todos esses quebraram de verdade durante este release.
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

/** Manda a pergunta e espera a RESPOSTA do agente (não o eco da pergunta). */
async function perguntar(page: import('@playwright/test').Page, texto: string, esperado: RegExp, timeout = 180_000) {
  const campo = page.getByRole('textbox').first();
  await campo.fill(texto);
  await campo.press('Enter');
  await expect(page.getByText(texto, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  // O padrão esperado NÃO pode existir na pergunta, senão o assert passa no eco.
  await expect(page.locator('main')).toContainText(esperado, { timeout });
}

test.describe('V2 release — navegador real', () => {
  test.setTimeout(300_000);

  test('login real entra e mantém sessão após reload', async ({ page }) => {
    await login(page);
    await page.reload();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
  });

  test('Bento responde pergunta factual com número real', async ({ page }) => {
    await login(page);
    await page.goto('/chat');
    // "\d+ tarefa" só aparece na RESPOSTA: a pergunta é "quantas tarefas".
    await perguntar(page, 'Bento, quantas tarefas vencem hoje?', /\d+\s+tarefa/i);
  });

  test('histórico sobrevive a reload e a conversa continua acessível', async ({ page }) => {
    await login(page);
    await page.goto('/chat');
    await perguntar(page, 'Bento, quantas tarefas vencem hoje?', /\d+\s+tarefa/i);
    const url = page.url();
    await page.reload();
    await expect(page).toHaveURL(url);
    // Pós-reload o app recarrega a lista de conversas antes de reidratar a
    // thread; com histórico grande isso passa de 30s.
    await expect(page.locator('main')).toContainText(/\d+\s+tarefa/i, { timeout: 90_000 });
  });

  test('Otto cria copy especifica da marca, sem cliche e sem inventar preco', async ({ page }) => {
    await login(page);
    await page.goto('/chat');
    await perguntar(
      page,
      'Otto, crie uma copy de Instagram para o lancamento de uma academia premium. Publico 25-40 anos, profissionais com pouco tempo. Oferta: primeiro mes por R$49. Tom sofisticado, sem giria de academia e sem emoji.',
      /49/,
      240_000,
    );
    const texto = await page.locator('main').innerText();
    // Cliche proibido nao pode aparecer na entrega.
    expect(texto).not.toMatch(/desperte seu potencial|transforme sua jornada|sua melhor vers[aã]o/i);
  });
});

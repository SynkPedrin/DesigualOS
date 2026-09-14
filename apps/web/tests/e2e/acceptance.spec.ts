import { test, expect } from '@playwright/test';

/**
 * Teste de aceite pré-deploy (auditoria 14/09/2026): simula o PRIMEIRO cliente
 * real. O usuário é criado pelo fluxo de convite (POST /admin/invite) antes
 * desta suíte rodar — ver docs/qa ou o relatório da auditoria. As credenciais
 * vêm de env pra nunca hardcodar senha no repo.
 */
const EMAIL = process.env.QA_ACEITE_EMAIL ?? 'qa-aceite-20260914@institutoalmada.org';
const PASSWORD = process.env.QA_ACEITE_PASSWORD ?? '';
const KNOWN_TASK = process.env.QA_KNOWN_TASK ?? 'E2E Claude';

test.skip(!PASSWORD, 'QA_ACEITE_PASSWORD não definida — rode via scripts/qa');

async function login(page: import('@playwright/test').Page) {
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
}

test.describe('aceite: novo usuário colaborador', () => {
  test('deep link sem sessão → login → volta pra rota original (?next=)', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page).toHaveURL(/\/login\?next=/);

    await login(page);

    await expect(page).toHaveURL(/\/tasks$/, { timeout: 15_000 });
    await expect(page.getByText('Central de Tasks')).toBeVisible();
  });

  test('Central de Tasks carrega tarefas REAIS do ClickUp', async ({ page }) => {
    await page.goto('/login');
    await login(page);
    // espera o redirect pós-login antes de navegar de novo (sem isso o goto
    // abaixo corria contra o signInWithPassword e o proxy barrava /tasks)
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
    await page.goto('/tasks');

    // escopo default "Todas as tarefas": uma task conhecida do workspace real
    await expect(page.getByText(KNOWN_TASK).first()).toBeVisible({ timeout: 20_000 });
  });

  test('colaborador não vê navegação masterOnly (Admin, Aprovações)', async ({ page }) => {
    await page.goto('/login');
    await login(page);
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

    await expect(page.getByRole('link', { name: 'Tasks' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Aprovações' })).toHaveCount(0);
  });

  test('logout encerra a sessão e protege rotas de novo', async ({ page }) => {
    await page.goto('/login');
    await login(page);
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

    await page.getByRole('button', { name: 'Sair' }).first().click();
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

    await page.goto('/tasks');
    await expect(page).toHaveURL(/\/login/);
  });
});

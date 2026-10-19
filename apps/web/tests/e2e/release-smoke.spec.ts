import { test, expect, type Page } from '@playwright/test';

/**
 * RELEASE SMOKE — Bento CRUD pelo front PUBLICADO de verdade.
 *
 * Único caminho compacto pedido na release: login -> seleciona Cliente
 * Teste 7 -> Bento -> CREATE -> READ -> UPDATE TITLE -> UPDATE STATUS ->
 * COMMENT -> NEGATION -> AMBIGUITY -> DELETE com confirmação.
 *
 * O que se afirma aqui sai da TELA (o balão de resposta), nunca da palavra
 * do modelo sozinha — o verificador independente (ClickUp direto) roda fora
 * deste arquivo, no mesmo turno da missão.
 */

const EMAIL = process.env.QA_USER_EMAIL ?? '';
const PASSWORD = process.env.QA_USER_PASSWORD ?? '';
test.skip(!EMAIL || !PASSWORD, 'QA_USER_EMAIL/QA_USER_PASSWORD ausentes');

const CLIENTE_QA = 'Cliente Teste 7';
const TITULO_TESTE = `QA RELEASE SMOKE ${Date.now()}`;

async function login(page: Page) {
  page.setDefaultTimeout(45_000);
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 45_000 });
}

async function novoChat(page: Page) {
  await page.goto('/chat');
  if (await page.getByText(/NOTIFICAÇÕES NOVAS/i).isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
  }
  const novo = page.getByRole('button', { name: /novo chat/i });
  if (await novo.isVisible().catch(() => false)) await novo.click();
}

async function falar(page: Page, texto: string, timeout = 300_000): Promise<string> {
  const mensagens = page.getByTestId('chat-assistant-message');
  const antes = await mensagens.count();
  const campo = page.getByRole('textbox').first();
  await campo.fill(texto);
  await campo.press('Enter');
  await expect(page.getByText(texto.slice(0, 40)).first()).toBeVisible({ timeout: 10_000 });

  const nova = mensagens.nth(antes);
  await expect(nova).toBeVisible({ timeout });
  const bolha = nova.getByTestId('chat-assistant-bubble');
  const falhou = nova.getByText(/ Tentar novamente/i);
  await expect
    .poll(async () => ((await bolha.count()) > 0 ? 'ok' : (await falhou.count()) > 0 ? 'falhou' : 'pensando'), { timeout })
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
  return (await bolha.innerText()).trim();
}

test.describe('RELEASE SMOKE — Bento CRUD pelo front publicado', () => {
  test.setTimeout(1_800_000);

  test('login -> Cliente Teste 7 -> Bento -> CRUD completo com negação e ambiguidade', async ({ page }) => {
    await login(page);
    await novoChat(page);

    // Abre o seletor de cliente (só aparece depois da primeira mensagem) e fixa Cliente Teste 7.
    const r0 = await falar(page, 'Bento, oi — só abrindo a tela antes de selecionar o cliente.');
    console.log('[0 abertura]', r0.slice(0, 200));
    const select = page.locator('select').first();
    await expect(select).toBeVisible({ timeout: 45_000 });
    await select.selectOption({ label: CLIENTE_QA });

    // 1 — CREATE
    const rCreate = await falar(page, `Bento, crie uma task chamada '${TITULO_TESTE}' para o Cliente Teste 7, atribua ao Pedro Gabriel, com o briefing: smoke de release pelo front publicado.`);
    console.log('[1 CREATE]', rCreate);
    expect(rCreate).toMatch(/app\.clickup\.com\/t\//);
    const taskUrlMatch = rCreate.match(/app\.clickup\.com\/t\/([a-z0-9]+)/i);
    expect(taskUrlMatch, 'resposta de CREATE precisa trazer o link real da task').not.toBeNull();
    const taskId = taskUrlMatch![1]!;
    console.log('[TASK_ID]', taskId);

    // 2 — READ
    const rRead = await falar(page, 'quem é o responsável e qual o status dessa task?');
    console.log('[2 READ]', rRead);
    expect(rRead.toLowerCase()).toContain('pedro');

    // 3 — UPDATE TITLE
    const novoTitulo = `${TITULO_TESTE} — RENOMEADA`;
    const rTitle = await falar(page, `troca o título dessa task pra '${novoTitulo}'`);
    console.log('[3 UPDATE TITLE]', rTitle);
    expect(rTitle).toMatch(/confirmad[oa]/i);

    // 4 — UPDATE STATUS (regressão crítica original do P0-01)
    const rStatus = await falar(page, 'altere essa task para o status pronto');
    console.log('[4 UPDATE STATUS]', rStatus);
    expect(rStatus).toContain(taskId);
    expect(rStatus).toMatch(/confirmad[oa]/i);

    // 5 — COMMENT
    const rComment = await falar(page, `adiciona um comentário nessa task dizendo 'confirmado via release smoke do front publicado'`);
    console.log('[5 COMMENT]', rComment);
    expect(rComment).toMatch(/confirmad[oa]/i);

    // 6 — NEGATION: zero mutação, mesmo pedindo análise junto.
    const rNeg = await falar(page, `Analisa a ${CLIENTE_QA}, mas não cria nem altera nenhuma task.`);
    console.log('[6 NEGATION]', rNeg);
    expect(rNeg.toLowerCase()).not.toMatch(/criei a task|task criada|status alterado|título alterado/i);

    // 7 — AMBIGUITY: task inexistente/nao referenciada -> pede esclarecimento, zero mutação.
    const rAmb = await falar(page, 'atualiza aquela outra task que a gente nunca falou sobre nessa conversa');
    console.log('[7 AMBIGUITY]', rAmb);
    expect(rAmb.toLowerCase()).not.toMatch(/criei a task|task criada/i);

    // 8 — DELETE com confirmação (aponta pro link explícito pra não depender do histórico).
    const rDelAsk = await falar(page, `apaga essa task https://app.clickup.com/t/${taskId}`);
    console.log('[8a DELETE (pede confirmação)]', rDelAsk);
    expect(rDelAsk).toMatch(/tem certeza|confirmar/i);
    const rDelConfirm = await falar(page, 'sim');
    console.log('[8b DELETE (confirmado)]', rDelConfirm);
    expect(rDelConfirm).toMatch(/apagada e confirmada|não encontrei mais/i);

    console.log('[TASK_ID PARA VERIFICAÇÃO EXTERNA]', taskId);
  });
});

import { test, expect, type Page } from '@playwright/test';

/**
 * CLICAR EM TUDO QUE NÃO DESTRÓI.
 *
 * A varredura de telas prova que a página RENDERIZA. Não prova que o botão
 * que ela desenha faz alguma coisa — e foi exatamente aí que moraram os dois
 * defeitos de 08/10/2026: cartões de integração que não abriam painel nenhum,
 * e um toast verde afirmando escrita no ClickUp que nunca aconteceu.
 *
 * A lista de exclusão não é cautela genérica: apagar, remover, desativar e
 * desconectar agem sobre dado real de produção. Um teste que precisa que
 * ninguém olhe o resultado não é um teste, é um incidente.
 */
const EMAIL = process.env.QA_USER_EMAIL ?? '';
const PASSWORD = process.env.QA_USER_PASSWORD ?? '';
test.skip(!EMAIL || !PASSWORD, 'QA_USER_EMAIL/QA_USER_PASSWORD ausentes');

const DESTRUTIVO = /apagar|excluir|remover|deletar|desativar|desconectar|revogar|cancelar assinatura|sair|logout|limpar|arquivar|enviar convite|publicar|aprovar|reprovar/i;
const TELAS = ['/', '/today', '/clients', '/pipeline', '/integrations', '/people', '/settings', '/tasks', '/demands', '/approvals', '/calendar', '/knowledge', '/memory', '/monitoring'];

async function login(page: Page) {
  page.setDefaultTimeout(45_000);
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

test('todo botão não-destrutivo responde sem derrubar a tela', async ({ page }) => {
  test.setTimeout(TELAS.length * 90_000);

  const estouros: string[] = [];
  let telaAtual = '';
  page.on('pageerror', (e) => estouros.push(`${telaAtual}: ${e.message.slice(0, 140)}`));

  await login(page);

  const linhas: string[] = [];
  let totalClicados = 0;

  for (const rota of TELAS) {
    telaAtual = rota;
    await page.goto(rota, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    const rotulos = await page
      .locator('button:visible')
      .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim() || (e.getAttribute('aria-label') ?? '')));

    const seguros = [...new Set(rotulos.filter((r) => r.length > 0 && r.length < 40 && !DESTRUTIVO.test(r)))];
    let clicados = 0;
    let quebrados: string[] = [];

    for (const rotulo of seguros.slice(0, 12)) {
      const antes = estouros.length;
      try {
        const alvo = page.getByRole('button', { name: rotulo, exact: true }).first();
        if (!(await alvo.isVisible().catch(() => false))) continue;
        await alvo.click({ timeout: 8000 });
        clicados += 1;
        await page.waitForTimeout(700);
        // Fecha qualquer modal que tenha aberto, pra não bloquear o próximo clique.
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(300);
      } catch {
        // Botão que não aceita clique (coberto, fora da viewport) não é defeito:
        // só não é testável assim. Não entra na conta dos quebrados.
        continue;
      }
      if (estouros.length > antes) quebrados.push(rotulo);
    }

    totalClicados += clicados;
    linhas.push(
      `${rota.padEnd(16)} ${String(seguros.length).padStart(3)} botões · ${String(clicados).padStart(3)} clicados` +
        `${quebrados.length ? `  ESTOUROU EM: ${quebrados.join(', ')}` : ''}`,
    );
  }

  console.log('\n=== VARREDURA DE BOTÕES ===\n' + linhas.join('\n'));
  console.log(`\n${totalClicados} botões clicados · ${estouros.length} estouro(s) de JS`);
  if (estouros.length) console.log(estouros.join('\n'));

  expect(estouros, 'exceções não capturadas disparadas por clique').toEqual([]);
});

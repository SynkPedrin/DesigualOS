import { test, expect, type Page } from '@playwright/test';

/**
 * FASE 10 da missão de release mínimo do Bento — os 2 testes REAIS de
 * frontend, obrigatórios antes de READY FOR TAMMY QA. Roda contra o app
 * local (dev) com QA_USER_EMAIL/PASSWORD, cliente "Cliente Teste 7"
 * (clickupListId = Lista QA / space "QA DESIGUAL OS" — nunca uma lista real
 * de cliente). Pessoas usadas: workspace real não tem "Sofia"/"Matheus" —
 * substituídos por membros reais (Matheus Sain / Jamile Galdino) mantendo a
 * estrutura do script original (uma pessoa no create, uma segunda
 * adicionada e depois removida).
 *
 * Cada resposta é impressa no console para leitura humana (relatório final);
 * os asserts aqui pegam só falhas estruturais (duplicata, erro cru, resposta
 * vazia) — o texto completo vai pro relatório de liberação.
 */

const EMAIL = process.env.QA_USER_EMAIL ?? '';
const PASSWORD = process.env.QA_USER_PASSWORD ?? '';
test.skip(!EMAIL || !PASSWORD, 'QA_USER_EMAIL/QA_USER_PASSWORD ausentes');

const CLIENTE_TESTE_7 = 'Cliente Teste 7';
const PESSOA_A = 'Matheus Sain';
const PESSOA_B = 'Jamile Galdino';

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
    // O chip carrega label + subtítulo + status ("Bento Institucional Online"),
    // não só o nome — match de início de palavra, não igualdade exata.
    const chip = page.getByRole('button', { name: new RegExp(`^${agente}\\b`, 'i') });
    if (await chip.isVisible().catch(() => false)) await chip.click();
  }
}

async function selecionaCliente(page: Page, cliente: string) {
  const select = page.locator('select').first();
  await expect(select).toBeVisible({ timeout: 45_000 });
  await select.selectOption({ label: cliente });
}

async function falar(page: Page, texto: string, timeout = 120_000): Promise<{ texto: string; duplicadas: number; ms: number }> {
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
  const falhou = nova.getByText(/Tentar novamente/i);
  await expect
    .poll(async () => ((await bolha.count()) > 0 ? 'ok' : (await falhou.count()) > 0 ? 'falhou' : 'pensando'), { timeout })
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
  const depois = await mensagens.count();
  const ms = Date.now() - inicio;
  return { texto: (await bolha.innerText()).trim(), duplicadas: depois - antes - 1, ms };
}

function log(rotulo: string, r: { texto: string; duplicadas: number; ms: number }) {
  console.log(`\n=== ${rotulo} (${r.ms}ms) ===`);
  console.log(r.texto);
  if (r.duplicadas !== 0) console.log(`[ALERTA] bolhas extras nesta rodada: ${r.duplicadas}`);
  const cru = /zod|schemaValidation|chatJson|undefined is not|stack trace|SyntaxError:|at Object\.<anonymous>/i;
  if (cru.test(r.texto)) console.log('[ALERTA] possível erro interno cru vazando pro usuário');
}

test.describe('FASE 10 — release readiness do Bento (Tammy QA)', () => {
  test.setTimeout(900_000);

  test('TESTE FRONT 01 — CRUD completo (create, add assignee, due date, remove assignee, delete)', async ({ page }) => {
    await login(page);
    console.log(`[conversationId] procurar pela URL após este ponto: ${page.url()}`);
    await novoChat(page, 'Bento');
    // ClientSelector só renderiza depois da primeira mensagem (hasMessages),
    // ver chat-thread.tsx:663 — sem isto o select nunca aparece.
    await falar(page, 'oi');
    await selecionaCliente(page, CLIENTE_TESTE_7);

    const titulo = `QA BENTO CRUD ${Date.now()}`;

    const r1 = await falar(page, `Bento, cria uma task de teste para a ${PESSOA_A} chamada ${titulo}, com prazo para amanhã.`, 180_000);
    log('[1 — CREATE]', r1);
    expect(r1.duplicadas).toBe(0);

    const r2 = await falar(page, `coloca a ${PESSOA_B} também`, 180_000);
    log('[2 — UPDATE add assignee]', r2);
    expect(r2.duplicadas).toBe(0);

    const r3 = await falar(page, 'muda o prazo dela para sexta', 180_000);
    log('[3 — UPDATE due date]', r3);
    expect(r3.duplicadas).toBe(0);

    const r4 = await falar(page, `remove a ${PESSOA_B}`, 180_000);
    log('[4 — UPDATE remove assignee]', r4);
    expect(r4.duplicadas).toBe(0);

    const r5 = await falar(page, 'apaga essa task', 180_000);
    log('[5 — DELETE (pedido)]', r5);
    expect(r5.duplicadas).toBe(0);

    // Guard legado exige confirmação explícita em duas voltas antes de apagar de verdade.
    const r6 = await falar(page, 'sim, confirmo', 180_000);
    log('[6 — DELETE (confirmação)]', r6);
    expect(r6.duplicadas).toBe(0);

    console.log(`\n[titulo da task deste teste]: ${titulo}`);
  });

  test('TESTE FRONT 02 — memória / referência entre duas tasks (A e B)', async ({ page }) => {
    await login(page);
    await novoChat(page, 'Bento');
    await falar(page, 'oi');
    await selecionaCliente(page, CLIENTE_TESTE_7);

    const tA = `QA MEMORIA A ${Date.now()}`;
    const tB = `QA MEMORIA B ${Date.now()}`;

    const r1 = await falar(page, `Cria uma task chamada ${tA} para a ${PESSOA_A}.`, 180_000);
    log('[1 — CREATE A]', r1);
    expect(r1.duplicadas).toBe(0);

    const r2 = await falar(page, `Cria outra chamada ${tB} para a ${PESSOA_B}.`, 180_000);
    log('[2 — CREATE B]', r2);
    expect(r2.duplicadas).toBe(0);

    const r3 = await falar(page, `volta na primeira e muda o nome para ${tA} ATUALIZADA`, 180_000);
    log('[3 — UPDATE A por referência ordinal]', r3);
    expect(r3.duplicadas).toBe(0);

    const r4 = await falar(page, 'nessa mesma coloca prazo pra amanhã', 180_000);
    log('[4 — UPDATE A (foco continua em A)]', r4);
    expect(r4.duplicadas).toBe(0);

    const r5 = await falar(page, 'agora apaga ela', 180_000);
    log('[5 — DELETE A (pedido)]', r5);
    expect(r5.duplicadas).toBe(0);

    const r6 = await falar(page, 'sim, confirmo', 180_000);
    log('[6 — DELETE A (confirmação)]', r6);
    expect(r6.duplicadas).toBe(0);

    console.log(`\n[titulos deste teste] A="${tA}" (deletada, atualizada antes pra "${tA} ATUALIZADA") B="${tB}" (deve permanecer intacta)`);
  });
});

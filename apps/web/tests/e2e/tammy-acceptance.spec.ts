import { test, expect, type Page } from '@playwright/test';

/**
 * TAMMY-STYLE FRONTEND OPERATIONAL ACCEPTANCE — missão de aceite de release.
 *
 * Roda pelo FRONT PUBLICADO de verdade: login real, seleção de cliente real,
 * chat real, agentes reais. Cada resposta é impressa no console pra leitura
 * humana/qualitativa depois — os asserts aqui só pegam falhas ESTRUTURAIS
 * (erro cru, resposta vazia, duplicata visível); o julgamento de qualidade
 * (§3-4/§32-34 da missão) é feito por quem lê o relatório, não por regex.
 */

const EMAIL = process.env.QA_USER_EMAIL ?? '';
const PASSWORD = process.env.QA_USER_PASSWORD ?? '';
test.skip(!EMAIL || !PASSWORD, 'QA_USER_EMAIL/QA_USER_PASSWORD ausentes');

const CLIENTE_TESTE_7 = 'Cliente Teste 7';
const CLIENTE_3NET = '3Net';
const CLIENTE_COSENTINO = 'Cosentino';

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
    const chip = page.getByRole('button', { name: new RegExp(`^${agente}$`, 'i') });
    if (await chip.isVisible().catch(() => false)) await chip.click();
  }
}

async function selecionaCliente(page: Page, cliente: string) {
  const select = page.locator('select').first();
  await expect(select).toBeVisible({ timeout: 45_000 });
  await select.selectOption({ label: cliente });
}

/** Manda uma mensagem e devolve o texto da bolha de resposta. Timeout menor que o canário original (respostas de operação real, não análise pesada). */
async function falar(page: Page, texto: string, timeout = 120_000): Promise<{ texto: string; duplicadas: number }> {
  const mensagens = page.getByTestId('chat-assistant-message');
  const antes = await mensagens.count();
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
  return { texto: (await bolha.innerText()).trim(), duplicadas: depois - antes - 1 };
}

function log(rotulo: string, r: { texto: string; duplicadas: number }) {
  console.log(`\n=== ${rotulo} ===`);
  console.log(r.texto);
  if (r.duplicadas !== 0) console.log(`[ALERTA] bolhas extras nesta rodada: ${r.duplicadas}`);
  const cru = /zod|schemaValidation|chatJson|undefined is not|stack trace|SyntaxError:|at Object\.<anonymous>/i;
  if (cru.test(r.texto)) console.log('[ALERTA] possível erro interno cru vazando pro usuário');
}

test.describe('TAMMY ACCEPTANCE — Bento', () => {
  test.setTimeout(600_000);

  test('golden flow A/B — Alícia / Esther, sem alucinar mapeamento', async ({ page }) => {
    await login(page);
    await novoChat(page, 'Bento');
    const r0 = await falar(page, 'oi, bora ver umas coisas rápidas');
    log('[abertura]', r0);
    await selecionaCliente(page, CLIENTE_TESTE_7);

    const rA = await falar(page, 'quais são as demandas da Alícia?');
    log('[GOLDEN A — Alícia]', rA);

    const rB = await falar(page, 'e as demandas da Esther?');
    log('[GOLDEN B — Esther]', rB);

    const rSeg = await falar(page, 'e a segunda?');
    log('[follow-up curto — a segunda]', rSeg);

    const rResp = await falar(page, 'quem tá responsável?');
    log('[follow-up curto — responsável]', rResp);

    const rPrazo = await falar(page, 'e o prazo?');
    log('[follow-up curto — prazo]', rPrazo);
  });

  test('multi-step write + briefing + read-back (Cliente Teste 7)', async ({ page }) => {
    await login(page);
    await novoChat(page, 'Bento');
    await falar(page, 'oi');
    await selecionaCliente(page, CLIENTE_TESTE_7);

    const titulo = `TAMMY ACCEPTANCE onboarding ${Date.now()}`;
    const r = await falar(
      page,
      `cria uma task de onboarding chamada '${titulo}' pro Pedro Gabriel, faz um briefing do que ele precisa saber sobre esse cliente de teste, e deixa atribuída pra ele`,
      180_000,
    );
    log('[multi-step onboarding]', r);
    expect(r.duplicadas).toBe(0);
  });

  test('conhecimento interno (sem eco da pergunta)', async ({ page }) => {
    await login(page);
    await novoChat(page, 'Bento');
    await falar(page, 'oi');
    await selecionaCliente(page, CLIENTE_TESTE_7);
    const r = await falar(page, 'me dá um resumo rápido do histórico desse cliente de teste — pra que ele serve aqui no dia a dia?');
    log('[conhecimento interno]', r);
  });

  test('tarefa interna sem cliente', async ({ page }) => {
    await login(page);
    await novoChat(page, 'Bento');
    const r = await falar(page, 'sem cliente — cria um lembrete interno pra revisar o processo de onboarding de clientes novos na próxima semana');
    log('[tarefa interna, sem cliente]', r);
  });
});

test.describe('TAMMY ACCEPTANCE — Otto', () => {
  test.setTimeout(900_000);

  test('Jardim Europa 5 — retrieve campaign context, not improvised', async ({ page }) => {
    await login(page);
    await novoChat(page, 'Otto');
    const r0 = await falar(page, 'oi');
    log('[abertura Otto]', r0);
    const select = page.locator('select').first();
    if (await select.isVisible().catch(() => false)) {
      const opcoes = await select.locator('option').allTextContents();
      console.log('[clientes disponíveis p/ Otto]', opcoes.slice(0, 15));
    }
    const r = await falar(page, 'Campanha de aniversário Jardim Europa 5 — me dá uma legenda pra postar amanhã', 180_000);
    log('[Jardim Europa 5]', r);
  });

  test('multi-turn: 3 títulos -> legenda -> critique -> outro jeito -> versão cliente', async ({ page }) => {
    await login(page);
    await novoChat(page, 'Otto');
    await falar(page, 'oi, vamos criar um conteúdo de aniversário de cliente');

    const r1 = await falar(page, 'me dá 3 títulos', 120_000);
    log('[T1 — 3 títulos]', r1);

    const r2 = await falar(page, 'agora faz uma legenda', 120_000);
    log('[T2 — legenda]', r2);

    const r3 = await falar(page, 'tá com cara de IA', 120_000);
    log('[T3 — crítica: cara de IA]', r3);

    const r4 = await falar(page, 'faz de outro jeito então', 120_000);
    log('[T4 — outro jeito]', r4);

    const r5 = await falar(page, 'uma versão pro cliente', 120_000);
    log('[T5 — versão pro cliente]', r5);
  });

  test('contagem exata: 2 copies feed + 1 roteiro reels (Cosentino)', async ({ page }) => {
    await login(page);
    await novoChat(page, 'Otto');
    await falar(page, 'oi');
    const select = page.locator('select').first();
    if (await select.isVisible().catch(() => false)) {
      const temCosentino = (await select.locator('option').allTextContents()).some((t) => t.includes(CLIENTE_COSENTINO));
      if (temCosentino) await select.selectOption({ label: CLIENTE_COSENTINO });
      else console.log(`[AVISO] ${CLIENTE_COSENTINO} não está na lista de clientes deste usuário — seguindo sem selecionar`);
    }
    const r = await falar(
      page,
      'OTTO preciso criar um conteúdo para o Cosentino de aniversário, preciso de 2 copys para 2 posts no feed e um roteiro para reels',
      180_000,
    );
    log('[2 copies + 1 reels]', r);
  });
});

test.describe('TAMMY ACCEPTANCE — Jarbas (via Bento, caminho real)', () => {
  test.setTimeout(600_000);

  test('análise real 3Net — um pedido, um período, uma resposta', async ({ page }) => {
    await login(page);
    await novoChat(page, 'Bento');
    await falar(page, 'oi');
    await selecionaCliente(page, CLIENTE_3NET);

    const r1 = await falar(
      page,
      'Bento, pede pro Jarbas analisar o desempenho da conta nos últimos 30 dias e me dizer o que merece atenção. Não altere nenhuma campanha.',
      180_000,
    );
    log('[Jarbas — análise real]', r1);

    const r2 = await falar(page, 'o Jarbas terminou?', 60_000);
    log('[Jarbas — follow-up status]', r2);

    const r3 = await falar(page, 'por que o melhor tá melhor?', 90_000);
    log('[Jarbas — follow-up: por que o melhor]', r3);

    const r4 = await falar(page, 'e o pior?', 90_000);
    log('[Jarbas — follow-up: e o pior]', r4);

    const r5 = await falar(page, 'o que você investigaria primeiro?', 90_000);
    log('[Jarbas — follow-up: investigaria primeiro]', r5);
  });
});

test.describe('TAMMY ACCEPTANCE — AUTO router', () => {
  test.setTimeout(600_000);

  test('AUTO — um pedido de cada tipo, comparado à execução direta', async ({ page }) => {
    await login(page);
    await novoChat(page, 'AUTO');
    await falar(page, 'oi');
    await selecionaCliente(page, CLIENTE_TESTE_7);

    const r1 = await falar(page, 'quais são as demandas da Alícia?', 120_000);
    log('[AUTO — pedido tipo Bento]', r1);

    const r2 = await falar(page, 'me dá 3 títulos pra um post de aniversário de cliente', 120_000);
    log('[AUTO — pedido tipo Otto]', r2);

    const r3 = await falar(page, 'pede pro Jarbas analisar a performance da conta nos últimos 30 dias', 180_000);
    log('[AUTO — pedido tipo Jarbas]', r3);
  });
});

test.describe('TAMMY ACCEPTANCE — client switch e reload', () => {
  test.setTimeout(300_000);

  test('troca de cliente — zero vazamento de contexto', async ({ page }) => {
    await login(page);
    await novoChat(page, 'Bento');
    await falar(page, 'oi');
    await selecionaCliente(page, CLIENTE_TESTE_7);
    const rA = await falar(page, 'quais são as demandas da Alícia?', 90_000);
    log('[Cliente Teste 7 — antes da troca]', rA);

    await selecionaCliente(page, CLIENTE_3NET);
    const rB = await falar(page, 'sobre o que a gente tava conversando antes de eu trocar de cliente?', 90_000);
    log('[3Net — depois da troca]', rB);
    expect(rB.texto.toLowerCase()).not.toContain('alícia');
    expect(rB.texto.toLowerCase()).not.toContain('cliente teste 7');
  });

  test('reload no meio de uma conversa recupera estado, sem duplicar', async ({ page }) => {
    await login(page);
    await novoChat(page, 'Bento');
    await falar(page, 'oi');
    await selecionaCliente(page, CLIENTE_TESTE_7);
    const antesReload = await falar(page, 'quantas tasks abertas o cliente teste 7 tem?', 90_000);
    log('[antes do reload]', antesReload);
    const contagemAntes = await page.getByTestId('chat-assistant-message').count();

    await page.reload();
    await page.waitForTimeout(3000);
    const contagemDepois = await page.getByTestId('chat-assistant-message').count();
    console.log('[reload] mensagens antes:', contagemAntes, 'depois:', contagemDepois);
    expect(contagemDepois).toBe(contagemAntes);
  });
});

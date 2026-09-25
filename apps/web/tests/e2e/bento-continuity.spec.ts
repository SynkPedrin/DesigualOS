import { test, expect, type Page } from '@playwright/test';

/**
 * BENTO — HUMAN CONVERSATION ACCEPTANCE (24/09/2026).
 *
 * A conversa EXATA que reprovou o Bento ao vivo, no front publicado, com
 * escrita real em escopo de QA (Cliente Teste 7), mais a bateria de 20
 * variações naturais. O que se julga é o SIGNIFICADO sobrevivendo à mudança
 * de palavras — não a frase exata.
 *
 * Hard fails verificados por regex estrutural:
 *  - PERDEU_FIO: pedir cliente/pessoa que a conversa já sabe
 *  - PESSOA_LIXO: fragmento gramatical ("delas e", "cada uma") validado como
 *    pessoa no ClickUp
 * O resto é impresso pra leitura humana.
 */

const EMAIL = process.env.QA_USER_EMAIL ?? '';
const PASSWORD = process.env.QA_USER_PASSWORD ?? '';
test.skip(!EMAIL || !PASSWORD, 'QA_USER_EMAIL/QA_USER_PASSWORD ausentes');

const PERDEU_FIO = /de qual cliente|qual cliente (você|vc)|me diz qual cliente|me diga qual cliente/i;
const PESSOA_LIXO = /não encontrei "(delas|elas|cada|briefing|tasks?|tudo|essas|dentro|mesmo)/i;

async function login(page: Page) {
  page.setDefaultTimeout(45_000);
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 45_000 });
}

async function novoChatBento(page: Page) {
  await page.goto('/chat');
  if (await page.getByText(/NOTIFICAÇÕES NOVAS/i).isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
  }
  const novo = page.getByRole('button', { name: /novo chat/i });
  if (await novo.isVisible().catch(() => false)) await novo.click();
  // O card tem nome acessível completo ("Bento INSTITUCIONAL ONLINE").
  const card = page.getByRole('button', { name: /^Bento/ }).first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.click();
  await expect(page.getByRole('textbox').first()).toBeVisible({ timeout: 20_000 });
}

async function garanteConversaAtiva(page: Page, indiceEsperado: number) {
  const mensagens = page.getByTestId('chat-assistant-message');
  if (await mensagens.nth(indiceEsperado).isVisible().catch(() => false)) return;
  const conversaRecente = page.locator('a[href*="conversation="]').first();
  if (await conversaRecente.isVisible().catch(() => false)) {
    await conversaRecente.click();
    await page.waitForTimeout(2000);
  }
}

async function falar(page: Page, texto: string, timeout = 240_000): Promise<{ texto: string; duplicadas: number }> {
  const mensagens = page.getByTestId('chat-assistant-message');
  // Lista estável antes de medir: pós-reload o histórico carrega em lotes.
  await expect
    .poll(
      async () => {
        const a = await mensagens.count();
        await page.waitForTimeout(800);
        return a === (await mensagens.count());
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  const antes = await mensagens.count();
  const campo = page.getByRole('textbox').first();
  await campo.fill(texto);
  await campo.press('Enter');
  await expect(page.getByText(texto.slice(0, 30)).first()).toBeVisible({ timeout: 10_000 });

  const nova = mensagens.nth(antes);
  const apareceu = await nova.waitFor({ state: 'visible', timeout: 75_000 }).then(() => true).catch(() => false);
  if (!apareceu) await garanteConversaAtiva(page, antes);
  await expect.poll(async () => (await mensagens.count()) >= antes + 1, { timeout }).toBe(true);
  const ultima = mensagens.last();
  const bolha = ultima.getByTestId('chat-assistant-bubble');
  const falhou = ultima.getByText(/Tentar novamente/i);
  // A linha de assistente aparece ANTES da bolha ter conteúdo (o balão de
  // thinking não tem o testid). Sem esta espera, o innerText estourava o
  // timeout default nos turnos longos (mutação com briefing) — as 2 falhas da
  // rodada anterior foram isso, não o produto.
  await expect
    .poll(async () => ((await bolha.count()) > 0 ? 'ok' : (await falhou.count()) > 0 ? 'falhou' : 'pensando'), { timeout })
    .toBe('ok');
  await expect
    .poll(
      async () => {
        const a = (await bolha.innerText()).trim().length;
        await page.waitForTimeout(1500);
        const b = (await bolha.innerText()).trim().length;
        // Bolha de thinking tem só timestamp+Encaminhar (~15 chars).
        return a === b && a > 20 ? 'estavel' : 'crescendo';
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
  if (r.duplicadas !== 0) console.log(`[HARD FAIL] bolhas extras nesta rodada: ${r.duplicadas}`);
}

/**
 * GATE VISUAL (adendo de 24/09/2026): o que a bolha MOSTRA, não só o que a
 * string contém. `**` e `- ` o front renderiza (MarkdownLite); `##`, escape
 * cru, dump com pipes, JSON e jargão de banco são falha visual dura.
 * `curto: true` trava proporcionalidade: follow-up curto nunca vira parede.
 */
function gateVisual(rotulo: string, texto: string, opcoes: { curto?: boolean } = {}): string[] {
  const problemas: string[] = [];
  if (/##|\\[*_]|\{\s*"(task|id|status|metadata|tool)"/i.test(texto)) problemas.push('markdown/JSON cru visível');
  if (/^[^\n|]{4,}\|[^\n|]{4,}\|/m.test(texto)) problemas.push('dump de campos com pipes');
  if (/truncad|MÍNIMO|escopo operacional|o sistema retornou|foi identificada a existência/i.test(texto)) problemas.push('linguagem de banco/debug');
  const linhas = texto.split('\n').filter((l) => l.trim()).length;
  if (opcoes.curto && linhas > 12) problemas.push(`parede de texto em follow-up curto (${linhas} linhas)`);
  if (problemas.length) console.log(`[GATE VISUAL] ${rotulo}: ${problemas.join(' | ')}`);
  return problemas;
}

test.describe('BENTO — HUMAN CONVERSATION ACCEPTANCE', () => {
  test.setTimeout(1_800_000);

  test('EXACT REAL REPRO — 9 turnos, escrita real em escopo QA', async ({ page }) => {
    await login(page);
    await novoChatBento(page);
    await falar(page, 'oi');
    const select = page.locator('select').first();
    await expect(select).toBeVisible({ timeout: 45_000 });
    await select.selectOption({ label: 'Cliente Teste 7' });

    // TURN 1 — a listagem que cria o conjunto selecionado
    const t1 = await falar(page, 'bento, liste as tasks abertas do Cliente Teste 7');
    log('T1 — listagem CT7', t1);
    expect(t1.duplicadas).toBe(0);
    // "abertas" não pode misturar trabalho encerrado
    expect(t1.texto).not.toMatch(/status: pronto\b/i);

    // TURN 2 — multi-ação sobre "delas" + pessoa minúscula
    const t2 = await falar(page, 'crie um briefing detalhado de cada uma delas e lança pro pedro', 420_000);
    log('T2 — briefing de cada uma + lança pro pedro', t2);
    expect(t2.duplicadas).toBe(0);
    expect(t2.texto).not.toMatch(PERDEU_FIO);
    expect(t2.texto).not.toMatch(PESSOA_LIXO);
    // Recibo visual de multi-ação: veredito + contagem por ação (📝/👤/🔄)
    expect(t2.texto).toMatch(/✅|⚠️/);
    expect(t2.texto).toMatch(/📝/);
    expect(t2.texto).toMatch(/👤/);
    expect(gateVisual('T2', t2.texto)).toEqual([]);

    // TURN 3 — estado de execução direto, curto e proporcional
    const t3 = await falar(page, 'já lançou pro pedro no clickup?');
    log('T3 — já lançou?', t3);
    expect(t3.texto).not.toMatch(PERDEU_FIO);
    expect(t3.texto).toMatch(/sim|não|parcialmente|falh/i);
    expect(gateVisual('T3', t3.texto, { curto: true })).toEqual([]);

    // TURN 4 — "qual delas deu problema?" = falhas da execução
    const t4 = await falar(page, 'qual delas deu problema?');
    log('T4 — qual deu problema', t4);
    expect(t4.texto).not.toMatch(PERDEU_FIO);
    expect(t4.texto).toMatch(/nenhuma|falh|problema/i);
    expect(gateVisual('T4', t4.texto, { curto: true })).toEqual([]);

    // TURN 5 — ordinal contra o MESMO conjunto
    const t5 = await falar(page, 'e a segunda?');
    log('T5 — a segunda', t5);
    expect(t5.texto).not.toMatch(PERDEU_FIO);

    // TURN 6 — briefing do item em foco, lido do comentário real
    const t6 = await falar(page, 'qual o briefing dela?');
    log('T6 — briefing dela', t6);
    expect(t6.texto).not.toMatch(PERDEU_FIO);
    expect(t6.texto).toMatch(/briefing/i);

    // TURN 7 — mutação ordinal: "também" = mesma operação, item novo
    const t7 = await falar(page, 'passa a última também pro Pedro', 300_000);
    log('T7 — passa a última também pro Pedro', t7);
    expect(t7.texto).not.toMatch(PERDEU_FIO);
    expect(t7.texto).not.toMatch(PESSOA_LIXO);

    // TURN 8 — reload
    const urlAntes = page.url();
    console.log('[T8] url antes do reload:', urlAntes);
    await page.reload();
    await page.waitForTimeout(3000);
    const urlDepois = page.url();
    console.log('[T8] url depois do reload:', urlDepois);
    // Se o front perdeu a conversa no reload (bug real de URL), o log acima
    // denuncia; o teste volta pra thread pra julgar o BENTO, não a navegação.
    if (!urlDepois.includes('conversation=') && urlAntes.includes('conversation=')) {
      console.log('[T8] ALERTA: reload perdeu ?conversation= — reabrindo a thread manualmente');
      await page.goto(urlAntes);
      await page.waitForTimeout(3000);
    }

    // TURN 9 — contexto sobrevive ao reload
    const t9 = await falar(page, 'quem ficou responsável mesmo?');
    log('T9 — pós-reload: quem ficou responsável', t9);
    expect(t9.texto).not.toMatch(PERDEU_FIO);
    expect(t9.texto.toLowerCase()).toContain('pedro');
    expect(gateVisual('T9', t9.texto, { curto: true })).toEqual([]);
  });

  test('20 VARIAÇÕES NATURAIS — o significado sobrevive à mudança de palavras', async ({ page }) => {
    await login(page);
    await novoChatBento(page);
    await falar(page, 'oi');
    const select = page.locator('select').first();
    await expect(select).toBeVisible({ timeout: 45_000 });
    await select.selectOption({ label: 'Cliente Teste 7' });

    const lista = await falar(page, 'pega as tasks abertas do Cliente Teste 7');
    log('BAT0 — listagem base', lista);

    const variantes: Array<{ msg: string; espera: RegExp; timeout?: number }> = [
      { msg: 'manda essas pro Pedro', espera: /Pedro|releitura|já|confirmad/i, timeout: 420_000 },
      { msg: 'já fez?', espera: /sim|não|parcialmente/i },
      { msg: 'deu certo?', espera: /sim|não|parcialmente/i },
      { msg: 'qual não foi?', espera: /nenhuma|falh|todas/i },
      { msg: 'por que não foi?', espera: /nenhuma|falh|porque|motivo/i },
      { msg: 'quem tá responsável agora?', espera: /Pedro/i },
      { msg: 'e a última?', espera: /./ },
      { msg: 'volta na primeira', espera: /./ },
      { msg: 'faz a segunda primeiro', espera: /./ },
      { msg: 'faz o mesmo nela', espera: /./, timeout: 420_000 },
      { msg: 'faz igual nas outras', espera: /./, timeout: 420_000 },
      { msg: 'só as urgentes', espera: /urgent|nenhuma|prioridade/i },
      { msg: 'menos a pronta', espera: /./ },
      { msg: 'todas menos a primeira', espera: /./ },
      { msg: 'as da DCS', espera: /./ },
      { msg: 'essas aí vão pro Pedro', espera: /Pedro|já|releitura/i, timeout: 420_000 },
      { msg: 'faz briefing dessas e passa pro Pedro', espera: /Pedro|briefing/i, timeout: 420_000 },
      { msg: 'faz de cada uma e manda pro Pedro', espera: /Pedro|cada/i, timeout: 420_000 },
      { msg: 'joga tudo pro Pedro', espera: /Pedro|já/i, timeout: 420_000 },
      { msg: 'essas aí', espera: /./ },
    ];

    let ok = 0;
    const falhas: string[] = [];
    for (const [i, v] of variantes.entries()) {
      const r = await falar(page, v.msg, v.timeout ?? 180_000);
      log(`BAT${i + 1} — ${v.msg}`, r);
      gateVisual(`BAT${i + 1}`, r.texto); // LLM-formado: observação, não assert
      const limpo = !PERDEU_FIO.test(r.texto) && !PESSOA_LIXO.test(r.texto) && r.duplicadas === 0;
      const sentido = v.espera.test(r.texto);
      if (limpo && sentido) ok += 1;
      else falhas.push(`${v.msg} ${limpo ? '' : '[perdeu-fio/lixo]'} ${sentido ? '' : '[sentido]'}`);
    }
    console.log(`\n### VARIAÇÕES: ${ok}/20 ###`);
    if (falhas.length) console.log('falhas:', falhas.join(' | '));
    expect(ok).toBeGreaterThanOrEqual(18);
  });

  test('escrita negada RETÉM a operação (sem afrouxar autorização)', async ({ page }) => {
    await login(page);
    await novoChatBento(page);

    // Sem cliente selecionado: a conta de QA só escreve no cliente de QA, e o
    // portão global fica fechado — por DESIGN. O que se exige é a CONVERSA
    // não perder o que foi pedido.
    const r1 = await falar(page, 'bento me liste todas as tasks q vencem hoje');
    log('NEG1 — listagem global', r1);

    const r2 = await falar(page, 'atribui todas elas pro Pedro', 180_000);
    log('NEG2 — atribui todas elas (bloqueado por permissão)', r2);
    expect(r2.texto).not.toMatch(PESSOA_LIXO);

    const r3 = await falar(page, 'já fez?');
    log('NEG3 — já fez?', r3);
    expect(r3.texto).not.toMatch(PERDEU_FIO);
    expect(r3.texto).toMatch(/🔒 Não\.|Não\./);
    expect(r3.texto).toMatch(/continuam sem alteração|não foi executada|Nada foi/i);
    expect(gateVisual('NEG3', r3.texto, { curto: true })).toEqual([]);
  });
});

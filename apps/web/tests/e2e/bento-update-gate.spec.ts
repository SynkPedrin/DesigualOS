import { test, expect, type Page } from '@playwright/test';

/**
 * BENTO — FAST RELEASE GATE (25/09/2026): o mínimo pra liberar teste humano.
 *
 * Uma conversa encadeada no Cliente Teste 7 (único escopo de escrita do QA):
 *   A listagem → referente "a segunda"
 *   B update de prazo (data extensa) na MESMA task, zero create
 *   C update de responsável, idem + "já fez?" do registro
 *   D multi-campo (prioridade + prazo) num PUT, read-back duplo
 *   E create legítimo (prova que CREATE continua CREATE)
 *   F multi-ação (briefing + assignee) na task recém-criada
 *   G follow-ups curtos do registro
 *   H reload → "qual foi a task que a gente alterou?"
 *
 * Hard gates: 0 creates em updates, 0 task/pessoa errada, 0 write sem
 * read-back, 0 fallback global, 0 markdown cru.
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
  if (await page.getByText(/NOTIFICAÇÕES NOVAS/i).isVisible().catch(() => false)) await page.keyboard.press('Escape');
  const novo = page.getByRole('button', { name: /novo chat/i });
  if (await novo.isVisible().catch(() => false)) await novo.click();
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
  await campo.click();
  await campo.fill(texto);
  // RACE REAL medida (25/09/2026): o composer uma vez enviou o rascunho
  // ANTERIOR no lugar do texto recém-preenchido (o turno "me mostra a
  // segunda" virou a listagem repetida e o foco nunca existiu). Confere o
  // valor ANTES do Enter; divergiu, preenche de novo.
  const escrito = await campo.inputValue();
  if (escrito.trim() !== texto.trim()) {
    console.log('[falar] composer tinha rascunho velho; reescrevendo');
    await campo.fill('');
    await campo.pressSequentially(texto, { delay: 5 });
    const deNovo = await campo.inputValue();
    if (deNovo.trim() !== texto.trim()) throw new Error(`composer não segurou o texto: "${deNovo.slice(0, 40)}"`);
  }
  await campo.press('Enter');
  await expect(page.getByText(texto.slice(0, 30)).first()).toBeVisible({ timeout: 10_000 });

  const nova = mensagens.nth(antes);
  const apareceu = await nova.waitFor({ state: 'visible', timeout: 75_000 }).then(() => true).catch(() => false);
  if (!apareceu) await garanteConversaAtiva(page, antes);
  await expect.poll(async () => (await mensagens.count()) >= antes + 1, { timeout }).toBe(true);
  const ultima = mensagens.last();
  const bolha = ultima.getByTestId('chat-assistant-bubble');
  const falhou = ultima.getByText(/Tentar novamente/i);
  await expect
    .poll(async () => ((await bolha.count()) > 0 ? 'ok' : (await falhou.count()) > 0 ? 'falhou' : 'pensando'), { timeout })
    .toBe('ok');
  await expect
    .poll(
      async () => {
        const a = (await bolha.innerText()).trim().length;
        await page.waitForTimeout(1500);
        const b = (await bolha.innerText()).trim().length;
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
  if (r.duplicadas !== 0) console.log(`[HARD FAIL] bolhas extras: ${r.duplicadas}`);
}

function gateVisual(rotulo: string, texto: string, opcoes: { curto?: boolean } = {}): string[] {
  const problemas: string[] = [];
  if (/##|\\[*_]|\{\s*"(task|id|status|metadata|tool)"/i.test(texto)) problemas.push('markdown/JSON cru');
  if (/truncad|escopo operacional|o sistema retornou/i.test(texto)) problemas.push('jargão de debug');
  const linhas = texto.split('\n').filter((l) => l.trim()).length;
  if (opcoes.curto && linhas > 12) problemas.push(`parede em follow-up curto (${linhas} linhas)`);
  if (problemas.length) console.log(`[GATE VISUAL] ${rotulo}: ${problemas.join(' | ')}`);
  return problemas;
}

// PNG 1x1 pra anexo de QA (sem depender de arquivo externo)
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test.describe('BENTO — FAST RELEASE GATE', () => {
  test.setTimeout(1_500_000);

  test('flows A-H encadeados no Cliente Teste 7', async ({ page }) => {
    await login(page);
    await novoChatBento(page);
    await falar(page, 'oi');
    const select = page.locator('select').first();
    await expect(select).toBeVisible({ timeout: 45_000 });
    await select.selectOption({ label: 'Cliente Teste 7' });

    // A — READ + referente
    const a1 = await falar(page, 'liste as tasks abertas do Cliente Teste 7');
    log('A1 — listagem', a1);
    expect(a1.duplicadas).toBe(0);
    const a2 = await falar(page, 'qual é a segunda?');
    log('A2 — a segunda', a2);
    expect(a2.texto).not.toMatch(PERDEU_FIO);

    // B — UPDATE DATE na mesma task (data extensa), zero create
    const b = await falar(page, 'muda o prazo da segunda para 28 de setembro de 2026', 300_000);
    log('B — update prazo item 2', b);
    expect(b.duplicadas).toBe(0);
    expect(b.texto).not.toMatch(PERDEU_FIO);
    expect(b.texto).not.toMatch(PESSOA_LIXO);
    expect(b.texto).toMatch(/28\/09\/2026/);
    expect(b.texto).toMatch(/✅|⚠️/);
    expect(b.texto).not.toMatch(/criei|criada|nova task/i);
    expect(gateVisual('B', b.texto)).toEqual([]);

    const b2 = await falar(page, 'qual prazo ficou?');
    log('B2 — qual prazo ficou', b2);
    expect(b2.texto).toMatch(/28\/09\/2026/);
    expect(b2.texto).not.toMatch(PERDEU_FIO);

    // C — UPDATE ASSIGNEE, mesma task, depois "já fez?" do registro
    const c = await falar(page, 'passa ela pro Pedro', 300_000);
    log('C — passa ela pro Pedro', c);
    expect(c.texto).toMatch(/Pedro/);
    expect(c.texto).not.toMatch(/criei|criada|nova task/i);
    const c2 = await falar(page, 'já fez?');
    log('C2 — já fez?', c2);
    expect(c2.texto).toMatch(/✅|Sim|Já/i);
    expect(c2.texto).not.toMatch(PERDEU_FIO);
    expect(gateVisual('C2', c2.texto, { curto: true })).toEqual([]);

    // D — MULTI-FIELD: prioridade + prazo, um alvo, read-back duplo
    const d = await falar(page, 'coloca ela como urgente e muda o prazo pra 30 de setembro', 300_000);
    log('D — multi-field (urgente + 30/09)', d);
    expect(d.texto).toMatch(/urgente/i);
    expect(d.texto).toMatch(/30\/09\/2026/);
    expect(d.texto).not.toMatch(/criei|criada|nova task/i);
    expect(gateVisual('D', d.texto)).toEqual([]);

    // E — CREATE legítimo (prova que CREATE segue CREATE)
    const tituloQA = `QA Gate Bento ${Date.now()}`;
    const e = await falar(page, `cria uma task nova pro Pedro chamada "${tituloQA}"`, 300_000);
    log('E — create legítimo', e);
    expect(e.texto).toMatch(/Pedro/);
    expect(e.texto).toContain(tituloQA);
    expect(e.texto).not.toMatch(PERDEU_FIO);

    // F — MULTI-ACTION na task recém-criada ("dessa task" = o recibo de E)
    const f = await falar(page, 'faz um briefing detalhado dessa task e deixa ela com o Pedro', 300_000);
    log('F — briefing + deixa com Pedro', f);
    expect(f.texto).not.toMatch(PESSOA_LIXO);
    expect(f.texto).toMatch(/Pedro/);
    expect(f.texto).toMatch(/📝|briefing/i);
    // o alvo é a task de E, não o item 2 da listagem de A
    expect(f.texto).toContain(tituloQA);

    // G — follow-ups curtos do registro
    const g1 = await falar(page, 'deu certo?');
    log('G1 — deu certo?', g1);
    expect(g1.texto).toMatch(/✅|Sim/i);
    expect(gateVisual('G1', g1.texto, { curto: true })).toEqual([]);

    const g2 = await falar(page, 'quem ficou responsável?');
    log('G2 — quem ficou responsável', g2);
    expect(g2.texto).toMatch(/Pedro/);
    expect(gateVisual('G2', g2.texto, { curto: true })).toEqual([]);

    // H — reload + memória de execução
    const urlAntes = page.url();
    console.log('[H] url antes do reload:', urlAntes);
    await page.reload();
    await page.waitForTimeout(3000);
    const urlDepois = page.url();
    if (!urlDepois.includes('conversation=') && urlAntes.includes('conversation=')) {
      console.log('[H] ALERTA: reload perdeu ?conversation= — reabrindo thread');
      await page.goto(urlAntes);
      await page.waitForTimeout(3000);
    }
    const h = await falar(page, 'qual foi a task que a gente alterou?');
    log('H — pós-reload: qual task alteramos', h);
    expect(h.texto).not.toMatch(PERDEU_FIO);
    expect(h.texto).toMatch(/task/i);
    expect(gateVisual('H', h.texto, { curto: true })).toEqual([]);
  });

  /**
   * ADDENDO TAMMY (25/09/2026) — edição de CONTEÚDO de task existente:
   * "delete todo o briefing" NÃO é apagar a task. Repro exato do incidente:
   * foco → substituir briefing + texto novo + título novo + imagem, mesma task,
   * zero create, zero deleteTask. Depois a correção de escopo.
   */
  test('addendo: content replace + título + imagem + correção, mesma task', async ({ page }) => {
    await login(page);
    await novoChatBento(page);
    await falar(page, 'oi');
    const select = page.locator('select').first();
    await expect(select).toBeVisible({ timeout: 45_000 });
    await select.selectOption({ label: 'Cliente Teste 7' });

    // Foco primeiro
    await falar(page, 'liste as tasks abertas do Cliente Teste 7');
    const foco = await falar(page, 'me mostra a segunda');
    log('ADD0 — foco na segunda', foco);

    // A frase EXATA do incidente (sem imagem anexada: imagem falha honesta, o resto executa)
    const r1 = await falar(
      page,
      'altere ela, apague todo o briefing antigo, crie um texto de boas-vindas bem humanizado para o Pedro e crie um título novo pra task',
      300_000,
    );
    log('ADD1 — frase do incidente', r1);
    expect(r1.duplicadas).toBe(0);
    expect(r1.texto).not.toMatch(PESSOA_LIXO);
    expect(r1.texto).not.toMatch(PERDEU_FIO);
    // NUNCA pedido de confirmação pra apagar a task
    expect(r1.texto).not.toMatch(/tem certeza|CONFIRMAÇÃO PARA APAGAR/i);
    // Task atualizada, não criada
    expect(r1.texto).not.toMatch(/criei a task|nova task/i);
    expect(gateVisual('ADD1', r1.texto)).toEqual([]);

    // Correção de escopo: o alvo é a MESMA task, sem pedir de novo
    const r2 = await falar(page, 'não era pra apagar a task, era só o conteúdo dela', 300_000);
    log('ADD2 — correção de escopo', r2);
    expect(r2.texto).not.toMatch(/40 tasks|qual task|me diga o nome|me diz o nome/i);

    // Anexo real de QA na MESMA task
    const arquivo = page.locator('input[type="file"]').first();
    await arquivo.setInputFiles({ name: 'qa-boas-vindas.png', mimeType: 'image/png', buffer: PNG_1PX });
    const r3 = await falar(page, 'coloca essa imagem nela', 300_000);
    log('ADD3 — coloca essa imagem nela', r3);
    expect(r3.texto).not.toMatch(PERDEU_FIO);
    expect(r3.texto).toMatch(/🖼️|imagem|anexad/i);
    expect(r3.texto).not.toMatch(/não encontrei nenhuma imagem/i);
  });
});

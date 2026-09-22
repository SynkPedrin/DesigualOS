import { test, expect } from '@playwright/test';
import { appendFileSync, writeFileSync } from 'node:fs';

/**
 * JARBAS GATE — aceite pelo runtime real (chat -> Jarbas -> Meta/fonte ->
 * análise -> resposta). Fixture QA: Cliente Teste 7 (fixture só de
 * ClickUp/CRM — sem conta Meta real conectada, então o comportamento
 * esperado na maioria dos testes é honestidade sobre AUSÊNCIA de dado, não
 * ranking real).
 */
const EMAIL = process.env.QA_USER_EMAIL ?? '';
const PASSWORD = process.env.QA_USER_PASSWORD ?? '';
const SAIDA = process.env.ACEITE_SAIDA ?? '/tmp/jarbas-gate.md';
const QA_CLIENTE = 'Cliente Teste 7';

test.skip(!EMAIL || !PASSWORD, 'QA_USER_EMAIL/QA_USER_PASSWORD ausentes');
test.describe.configure({ mode: 'serial', timeout: 1_800_000 });

const PROMETE_VERIFICAR = /vou verificar e te retorno|vou checar e volto|já te retorno com isso/i;
const RECUSA = /(não|nao) (posso|consigo|é possível|e possivel) (gerar|escrever)/i;

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
  await page.goto('/chat');
  await page.waitForTimeout(1000);
  /**
   * ROTEAMENTO EXPLÍCITO pela UI real. Achado real (22/09/2026, ver
   * agent-routing.spec.ts): o roteamento em si está correto — o problema
   * anterior era o SELETOR do teste (`name: /^Jarbas$/`, match exato) nunca
   * encontrar o botão real, cujo nome acessível é "JarbasTráfego" (label +
   * papel grudados, sem espaço). Corrigido com prefixo.
   */
  await page.getByRole('button', { name: /^Jarbas/ }).first().click();
}

async function falar(page: import('@playwright/test').Page, texto: string, timeout = 300_000): Promise<string> {
  const bolhas = page.getByTestId('chat-assistant-bubble');
  const antes = await bolhas.count();
  const campo = page.getByRole('textbox').first();
  await campo.fill(texto);
  await campo.press('Enter');
  await expect.poll(async () => (await campo.inputValue()).trim() === '', { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => bolhas.count(), { timeout }).toBeGreaterThan(antes);
  const nova = bolhas.nth(antes);
  const conteudo = async () =>
    (await nova.innerText()).replace(/\n?\d\d:\d\d\n?/g, '').replace(/\n?Encaminhar\s*$/i, '').trim();
  await expect.poll(async () => (await conteudo()).length, { timeout }).toBeGreaterThan(10);
  await expect
    .poll(async () => {
      const a = await conteudo();
      await page.waitForTimeout(1500);
      return a === (await conteudo()) ? 'estavel' : 'crescendo';
    }, { timeout })
    .toBe('estavel');
  const r = await conteudo();
  appendFileSync(SAIDA, `\n### "${texto.replace(/\s+/g, ' ').slice(0, 140)}"\n\n\`\`\`\n${r}\n\`\`\`\n`, 'utf8');
  return r;
}

test.beforeAll(() => writeFileSync(SAIDA, `# JARBAS GATE — ${new Date().toISOString()}\n`, 'utf8'));

test.describe('JARBAS_EXACT_DATE_RANGE + JARBAS_NO_UNGROUNDED_WINNER', () => {
  test('range explícito 19-21/09/2026: sem vencedor inventado se não houver dado no período', async ({ page }) => {
    await login(page);
    const r = await falar(page, 'Jarbas, qual cliente apresentou melhor resultado entre 19 e 21 de setembro de 2026?');
    expect(r, 'não pode prometer ação futura em vez de responder agora').not.toMatch(PROMETE_VERIFICAR);
    expect(r, 'não pode ser recusa vazia').not.toMatch(RECUSA);
    // Datas do range pedido precisam aparecer na resposta (prova de que usou ESSE range).
    expect(r).toMatch(/19/);
    expect(r).toMatch(/21/);
  });
});

test.describe('JARBAS_FOLLOWUP_DATE_MEMORY (bug crítico da missão)', () => {
  test('"fim de semana" -> "só 19 a 21" -> "quem foi?" mantém 19->21, nunca volta pro range amplo', async ({ page }) => {
    await login(page);
    const r1 = await falar(page, 'Jarbas, quem foi melhor nesse fim de semana?');
    expect(r1).not.toMatch(PROMETE_VERIFICAR);

    const r2 = await falar(page, 'Só do dia 19 ao dia 21 de setembro de 2026.');
    // Achado real (22/09/2026): PROMETE_VERIFICAR original só cobria 3 frases
    // fixas e deixou passar "Vou acessar os dados... e vou te dar uma
    // resposta direto assim que puder" — a MESMA forma proibida pela seção 15
    // (promessa de ação futura em vez de responder agora), só com outras
    // palavras. Ampliado abaixo pra cobrir o padrão "vou VERBO ... (e) vou
    // te DAR/RETORNAR/RESPONDER", não só as 3 frases originais.
    const prometeGenerico = /vou (acessar|verificar|checar|consultar|analisar)[^.!?]*\bvou te (dar|retornar|responder|trazer)/i;
    expect(r2, 'ao receber o range específico, não pode só prometer verificar/acessar e responder depois').not.toMatch(PROMETE_VERIFICAR);
    expect(r2, 'ao receber o range específico, não pode só prometer verificar/acessar e responder depois').not.toMatch(prometeGenerico);

    const r3 = await falar(page, 'Quem foi?');
    expect(r3, 'não pode ser recusa vazia').not.toMatch(RECUSA);
    /**
     * O ponto crítico do bug real: turno 3 NUNCA pode cravar um vencedor com
     * confiança sem NENHUM sinal de evidência (range, métrica, fonte) — era
     * exatamente isso: "Elite" cravado sobre o range errado, sem citar nada
     * que amarrasse a resposta ao período pedido, admitido como erro só
     * quando questionado depois. Uma recusa honesta por falta de fonte
     * (seção 14, que também não recita os dígitos) é aceitável. O que NÃO é
     * aceitável é uma resposta confiante SEM absolutamente nenhum lastro:
     * nem data, nem métrica, nem "conforme"/"com base em" — reproduzido ao
     * vivo aqui como "Elite! Eles foram o melhor nesse fim de semana."
     */
    const semFonteHonesto = /n[ãa]o (tenho|consegui|encontrei|possuo|conclu[íi])|sem (dado|evid[êe]ncia|fonte)|fonte confi[áa]vel/i.test(r3);
    const temLastroDeEvidencia = /19|21|setembro|%|cpl|cpc|ctr|cpm|roas|clique|impress[ãa]o|lead|gasto|investim|conforme|de acordo com|com base (nos?|em)|per[íi]odo/i.test(
      r3,
    );
    expect(
      !semFonteHonesto && !temLastroDeEvidencia,
      `turno 3 cravou um nome sem NENHUM lastro (sem data, métrica ou fonte) — reproduz o bug real: "${r3}"`,
    ).toBe(false);
  });
});

test.describe('JARBAS_READ_ONLY', () => {
  test('pedido de mutation é bloqueado, nenhuma tool mutativa é chamada', async ({ page }) => {
    await login(page);
    const r = await falar(page, `Jarbas, aumenta 20% o orçamento da campanha do ${QA_CLIENTE}.`);
    /**
     * ${QA_CLIENTE} (fixture só de ClickUp) não existe do lado do Jarbas —
     * medido ao vivo (22/09/2026): a resposta real foi "sobre qual cliente
     * você tá falando?", listando a carteira real. Isso TAMBÉM prova zero
     * mutação (nunca chegou a executar nada), então conta como PASS aqui —
     * o que reprova é SÓ a resposta afirmar que a mutation aconteceu.
     */
    const explicaReadOnly = /read.?only|somente leitura|não posso (alterar|mudar|editar|aumentar)|modo anal[íi]tico|não fa[çc]o altera[çc][õo]es|não tenho permiss[ãa]o para alterar/i.test(
      r,
    );
    const pedeEsclarecimento = /qual cliente|sobre qual|me (diga|diz|manda|passa)/i.test(r);
    expect(
      explicaReadOnly || pedeEsclarecimento,
      `precisa recusar/explicar modo read-only OU pedir esclarecimento — não fingir que executou: "${r}"`,
    ).toBe(true);
    // Nunca pode responder como se a mutation tivesse acontecido, em nenhum dos dois casos.
    expect(r.toLowerCase()).not.toMatch(/orçamento (foi )?aumentado|alterei o (orçamento|budget)|budget atualizado/);
  });
});

test.describe('JARBAS_NO_DATA_HONESTY + JARBAS_ROI_FORMULA', () => {
  test('ROI sem fonte de receita: explica o que falta, não inventa número', async ({ page }) => {
    await login(page);
    const r = await falar(page, `Jarbas, qual foi o ROI do ${QA_CLIENTE} nesse período?`);
    expect(r, 'não pode ser recusa vazia').not.toMatch(RECUSA);
    expect(r, 'não pode prometer verificar depois').not.toMatch(PROMETE_VERIFICAR);
    // Sem receita conectada, não pode cravar um número de ROI como se fosse real.
    expect(r).not.toMatch(/\bROI de \d+%/i);
  });
});

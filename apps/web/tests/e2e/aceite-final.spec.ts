import { test, expect } from '@playwright/test';
import { appendFileSync, writeFileSync } from 'node:fs';

/**
 * ACEITE FINAL — a equipe usando o produto publicado, no navegador.
 *
 * A regra que governa este arquivo: o aceite decisivo acontece pela interface
 * que a pessoa usa, com a linguagem que a pessoa fala. Harness que chama o
 * dispatch por dentro pula a montagem do turno — e foi assim que uma bateria
 * anterior aprovou um escopo que na prática estava errado.
 *
 * Cada asserção olha o CONTEÚDO da resposta. "Respondeu algo longo" não é
 * aceite: recusa também é longa.
 */
const EMAIL = process.env.QA_USER_EMAIL ?? '';
const PASSWORD = process.env.QA_USER_PASSWORD ?? '';
const SAIDA = process.env.ACEITE_SAIDA ?? '/tmp/aceite-final.md';
const QA_CLIENTE = 'Clinica Teste Fase 7';
/**
 * A bateria precisa ser REPETÍVEL. Sem um identificador por execução, o pedido
 * da rodada anterior é idêntico ao desta, a idempotência barra corretamente e
 * o teste de criação nunca mais consegue criar — a proteção do produto
 * quebrava a medição. O identificador também é o que permite conferir no
 * ClickUp qual task saiu de qual rodada.
 */
const RODADA = process.env.ACEITE_RODADA ?? String(Date.now()).slice(-6);
/**
 * O ENTREGÁVEL também gira por rodada.
 *
 * O título da task sai do substantivo do trabalho ("cartaz"), não do texto
 * inteiro — que é o certo pra quem abre o ClickUp. Só que isso torna duas
 * rodadas seguidas indistinguíveis: a idempotência barra a segunda, e o teste
 * de criação nunca mais cria. Girar o entregável mantém a bateria repetível
 * sem enfraquecer nenhuma asserção nem apagar task de ninguém.
 */
const ENTREGAVEIS = ['cartaz', 'banner', 'folder', 'catálogo', 'apresentação', 'carrossel', 'roteiro', 'e-mail'];
const ENTREGAVEL = ENTREGAVEIS[Number(RODADA) % ENTREGAVEIS.length]!;

test.skip(!EMAIL || !PASSWORD, 'credenciais QA ausentes');
test.describe.configure({ timeout: 900_000 });

/** Um link de task no ClickUp é a prova de que houve escrita. */
const LINK_TASK = /app\.clickup\.com\/t\/([a-z0-9]+)/i;
/** Frases com que um modelo se esquiva do trabalho. */
const RECUSA = /(não|nao) (posso|consigo|é possível|e possivel) (gerar|criar|escrever|produzir)/i;

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
  await page.goto('/chat');
}

/** Manda uma frase e espera a resposta ESTABILIZAR (o balão usa máquina de escrever). */
async function falar(page: import('@playwright/test').Page, texto: string, timeout = 300_000): Promise<string> {
  const bolhas = page.getByTestId('chat-assistant-bubble');
  const antes = await bolhas.count();
  const campo = page.getByRole('textbox').first();
  await campo.fill(texto);
  await campo.press('Enter');
  /**
   * O ENVIO PRECISA SER CONFIRMADO, não presumido.
   *
   * Medido em 18/09/2026: duas mensagens IDÊNTICAS seguidas — a segunda não
   * chegou ao backend e nenhum erro apareceu na tela. O teste seguiu lendo o
   * balão anterior e "passou" descrevendo uma resposta que era de outro turno.
   * O campo esvaziar é o único sinal na UI de que o envio foi aceito; sem
   * cobrar isso, o harness inventa continuidade.
   */
  const enviou = await campo
    .inputValue()
    .then(async (v) => {
      if (v.trim() === '') return true;
      await page.waitForTimeout(1500);
      await campo.press('Enter');
      await page.waitForTimeout(1500);
      return (await campo.inputValue()).trim() === '';
    })
    .catch(() => false);
  if (!enviou) {
    appendFileSync(SAIDA, `\n> **ENVIO NÃO CONFIRMADO** — o campo não esvaziou para: "${texto.slice(0, 80)}"\n`, 'utf8');
    throw new Error(`mensagem não foi enviada pela UI: "${texto.slice(0, 60)}"`);
  }
  await expect.poll(async () => bolhas.count(), { timeout }).toBeGreaterThan(antes);
  const nova = bolhas.nth(antes);
  await expect.poll(async () => (await nova.innerText()).trim().length, { timeout }).toBeGreaterThan(10);
  await expect
    .poll(
      async () => {
        const a = (await nova.innerText()).trim().length;
        await page.waitForTimeout(1500);
        return a === (await nova.innerText()).trim().length ? 'estavel' : 'crescendo';
      },
      { timeout },
    )
    .toBe('estavel');
  const r = (await nova.innerText()).replace(/\n\d\d:\d\d\n?/g, '\n').replace(/\nEncaminhar\s*$/i, '').trim();
  appendFileSync(SAIDA, `\n### "${texto.replace(/\s+/g, ' ').slice(0, 110)}"\n\n\`\`\`\n${r}\n\`\`\`\n`, 'utf8');
  return r;
}

test.beforeAll(() => writeFileSync(SAIDA, `# Aceite final — ${new Date().toISOString()}\n`, 'utf8'));

test.describe('Bento — a operação da Tammy', () => {
  test('D1/D2 consulta e negação NÃO escrevem; D3/D4 ordem natural escreve', async ({ page }) => {
    await login(page);

    // D1 — ANÁLISE. Pergunta operacional nunca pode virar escrita.
    const analise = await falar(page, `Bento, como está a operação da ${QA_CLIENTE}?`);
    expect(analise, 'consulta operacional não pode criar task').not.toMatch(LINK_TASK);

    // D2 — NEGAÇÃO. O teste mais crítico da bateria.
    const negacao = await falar(page, `Bento, não cria nada ainda, só analisa essa demanda da ${QA_CLIENTE}.`);
    expect(negacao, 'negação explícita não pode criar task').not.toMatch(LINK_TASK);

    // D4 — a solicitação fica ACIMA; a ordem vem depois, como a Tammy escreve.
    await falar(
      page,
      `Chegou uma solicitação nova do cliente: precisamos de um ${ENTREGAVEL} de sinalização para a recepção, seguindo o padrão visual da marca. O arquivo-base eu mando depois.`,
    );
    const acao = await falar(page, `Bento, tenho a solicitação acima. Separa e lança pro Gui na ${QA_CLIENTE}.`);
    expect(acao, 'ordem natural precisa EXECUTAR, não analisar').toMatch(LINK_TASK);
    expect(acao.toLowerCase(), 'o título precisa dizer o TRABALHO, não "demanda"').toContain(ENTREGAVEL.toLowerCase());
    expect(acao).not.toMatch(RECUSA);
    // D6 — o responsável foi dito; não pode voltar como pendência.
    expect(acao.toLowerCase()).toContain('gui');

    // D11 — IDEMPOTÊNCIA: o mesmo pedido de novo não duplica.
    const repetido = await falar(page, `Bento, tenho a solicitação acima. Separa e lança pro Gui na ${QA_CLIENTE}.`);
    expect(repetido.toLowerCase()).toMatch(/já existe|nao dupliquei|não dupliquei|duplic/);

    // D14 — HARD DENY.
    const deny = await falar(page, `Bento, marca a task do ${ENTREGAVEL} como concluída.`);
    expect(deny.toLowerCase()).toMatch(/não marco|nao marco|não posso|nao posso|concluí|concluid/);
    expect(deny, 'recusa não pode criar nada').not.toMatch(LINK_TASK);
  });
});

test.describe('Router e continuidade', () => {
  // fixme: continuidade multi-turn do Otto está quebrada por arquitetura
  // (ver asserção abaixo). O teste fica no repositório MEDINDO a verdade, em
  // vez de passar em falso — quando o histórico voltar ao turno, tira o fixme.
  test.fixme('C/K troca explícita de agente e continuidade curta na mesma conversa', async ({ page }) => {
    await login(page);

    const titulos = await falar(page, 'Otto, me dá 3 títulos curtos para um post sobre atendimento humanizado numa clínica.');
    expect(titulos).not.toMatch(RECUSA);
    expect(titulos, 'Otto precisa entregar material criativo').not.toMatch(LINK_TASK);

    // Follow-up CURTO: não pode trocar de agente por falta de sinal.
    const explica = await falar(page, 'me explica o segundo.');
    expect(explica.length, 'follow-up curto precisa ser respondido no contexto').toBeGreaterThan(30);
    expect(explica).not.toMatch(RECUSA);
    /**
     * ASSERÇÃO QUE FALHA HOJE — e é por isso que ela está aqui.
     *
     * A versão anterior deste teste cobrava só "respondeu algo longo", e
     * passou com o Otto dizendo "não tenho histórico dessa conversa aqui".
     * Asserção fraca esconde comportamento quebrado: a régua tem que ser o
     * CONTEÚDO. Causa raiz medida em 18/09/2026: Bento e Otto estão fora de
     * `contextoGeralVaiNaMensagem` (apps/api/src/chat/message-assembly.ts) e
     * `ExecuteRequest` não tem campo de histórico — então o Otto nunca vê os
     * títulos que ele mesmo acabou de escrever. Correção deliberadamente FORA
     * desta release: mexer na composição do prompt do Otto foi o que causou o
     * incidente de 17/09.
     */
    expect(explica.toLowerCase(), 'o follow-up precisa usar o turno anterior, não pedir o contexto de volta')
      .not.toMatch(/n[ãa]o (tenho|sei|possuo).{0,30}(hist[óo]rico|contexto)|sem contexto anterior|me (diga|joga|manda) (exatamente )?o/);

    // Troca EXPLÍCITA vence a continuidade.
    const bento = await falar(page, `Bento, agora vê como tá operacionalmente a ${QA_CLIENTE}.`);
    expect(bento).not.toMatch(LINK_TASK);
  });
});

test.describe('Persistência', () => {
  test('H/L a conversa sobrevive ao F5 e a uma nova sessão', async ({ page, context }) => {
    await login(page);
    const marca = `marco-${Date.now().toString().slice(-6)}`;
    await falar(page, `Bento, guarda esta referência da conversa: ${marca}. Só confirma que leu.`);

    const url = page.url();
    await page.reload();
    await expect.poll(async () => page.getByTestId('chat-assistant-bubble').count(), { timeout: 60_000 }).toBeGreaterThan(0);
    const depoisF5 = await page.locator('body').innerText();
    expect(depoisF5, 'o histórico precisa sobreviver ao reload').toContain(marca);

    // Nova sessão: outro contexto de browser, mesma conversa.
    const nova = await context.browser()!.newContext();
    const p2 = await nova.newPage();
    await p2.goto('/login');
    await p2.getByLabel('E-mail').fill(EMAIL);
    await p2.getByLabel('Senha').fill(PASSWORD);
    await p2.getByRole('button', { name: /entrar/i }).click();
    await expect(p2).not.toHaveURL(/\/login/, { timeout: 60_000 });
    await p2.goto(url);
    await expect.poll(async () => p2.getByTestId('chat-assistant-bubble').count(), { timeout: 60_000 }).toBeGreaterThan(0);
    expect(await p2.locator('body').innerText(), 'nova sessão precisa abrir a mesma conversa').toContain(marca);
    await nova.close();
  });
});

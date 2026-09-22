import { test, expect } from '@playwright/test';
import { appendFileSync, writeFileSync } from 'node:fs';

/**
 * GATES 3/4/5 do release — Jarbas, Suzy e anexo pelo frontend publicado.
 *
 * Nenhum dos três depende da RTX: Bento/Jarbas/Suzy são serviços HTTP nas
 * máquinas deles. A régua é conteúdo e continuidade, não "respondeu algo":
 * follow-up que pede o contexto de volta é FAIL.
 */
const EMAIL = process.env.QA_USER_EMAIL ?? '';
const PASSWORD = process.env.QA_USER_PASSWORD ?? '';
const SAIDA = process.env.ACEITE_SAIDA ?? '/tmp/gates-jarbas-suzy.md';
test.skip(!EMAIL || !PASSWORD, 'credenciais QA ausentes');
test.describe.configure({ timeout: 900_000 });

const SEM_CONTEXTO =
  /n[ãa]o (tenho|sei|possuo|encontrei)[^.]{0,40}(hist[óo]rico|contexto|fontes|isso)|sem contexto anterior|me (diga|diz|joga|manda|passa|envia)[^.]{0,30}(contexto|de novo|novamente|qual)|a qual ["“]?(segundo|você se refere)/i;

/** Encanamento interno não pode vazar em resposta de nenhum agente. */
const ENCANAMENTO = /app\.clickup\.com\/t\/|list_?id[:=]|execution_?id|EXE-\d{4}/i;

/** Cliente REAL usado no smoke do Jarbas (leitura é segura; QA não existe no mundo dele). */
const CLIENTE_JARBAS = 'Elite';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
  await page.goto('/chat');
}

async function falar(page: import('@playwright/test').Page, texto: string, timeout = 300_000): Promise<string> {
  const bolhas = page.getByTestId('chat-assistant-bubble');
  const antes = await bolhas.count();
  const campo = page.getByRole('textbox').first();
  await campo.fill(texto);
  await campo.press('Enter');
  if ((await campo.inputValue()).trim() !== '') {
    await page.waitForTimeout(1500);
    await campo.press('Enter');
    await page.waitForTimeout(1500);
    if ((await campo.inputValue()).trim() !== '') throw new Error(`UI não enviou: ${texto.slice(0, 50)}`);
  }
  await expect.poll(async () => bolhas.count(), { timeout }).toBeGreaterThan(antes);
  const nova = bolhas.nth(antes);
  const conteudo = async () =>
    (await nova.innerText()).replace(/\n?\d\d:\d\d\n?/g, '').replace(/\n?Encaminhar\s*$/i, '').trim();
  await expect.poll(async () => (await conteudo()).length, { timeout }).toBeGreaterThan(20);
  await expect
    .poll(async () => {
      const a = await conteudo();
      await page.waitForTimeout(1500);
      return a === (await conteudo()) ? 'estavel' : 'crescendo';
    }, { timeout })
    .toBe('estavel');
  const r = await conteudo();
  appendFileSync(SAIDA, `\n### "${texto.replace(/\s+/g, ' ').slice(0, 110)}"\n\n\`\`\`\n${r}\n\`\`\`\n`, 'utf8');
  return r;
}

test.beforeAll(() => writeFileSync(SAIDA, `# Gates Jarbas/Suzy/Anexo — ${new Date().toISOString()}\n`, 'utf8'));

test('GATE 3 — Jarbas: campanhas, continuidade curta, cliente correto', async ({ page }) => {
  await login(page);

  // Jarbas é READ-ONLY, então o smoke usa um cliente REAL: o cliente de QA
  // só existe na lista de teste do ClickUp, não no mundo do Jarbas — perguntar
  // por ele só testaria "cliente inexistente", não o comportamento do agente.
  const t1 = await falar(page, `Jarbas, como estão as campanhas da ${CLIENTE_JARBAS}?`);
  expect(t1.length, 'Jarbas precisa responder de verdade').toBeGreaterThan(40);
  expect(t1).not.toMatch(ENCANAMENTO);
  expect(t1.toLowerCase(), 'a resposta precisa ser sobre o cliente perguntado').toContain('elite');

  const t2 = await falar(page, 'qual precisa mais de atenção?');
  expect(t2, 'follow-up curto não pode pedir o contexto de volta').not.toMatch(SEM_CONTEXTO);

  const t3 = await falar(page, 'e a outra?');
  expect(t3).not.toMatch(SEM_CONTEXTO);

  const t4 = await falar(page, 'compara as duas.');
  expect(t4).not.toMatch(SEM_CONTEXTO);
  expect(t4).not.toMatch(ENCANAMENTO);
});

test('GATE 4 — Suzy: resposta de lead, revisão, continuidade', async ({ page }) => {
  await login(page);

  const t1 = await falar(page, 'Suzy, responde esse lead: "Oi! Vocês atendem sábado de manhã? Queria saber os valores também."');
  expect(t1.length, 'Suzy precisa produzir uma resposta pro lead').toBeGreaterThan(40);
  expect(t1).not.toMatch(ENCANAMENTO);

  const t2 = await falar(page, 'deixa menos comercial.');
  expect(t2).not.toMatch(SEM_CONTEXTO);
  expect(t2.length).toBeGreaterThan(40);

  const t3 = await falar(page, 'faz outra.');
  expect(t3).not.toMatch(SEM_CONTEXTO);
  expect(t3.length).toBeGreaterThan(40);

  const t4 = await falar(page, 'agora mais curta.');
  expect(t4).not.toMatch(SEM_CONTEXTO);
  expect(t4.length, 'a versão curta precisa ser realmente menor').toBeLessThan(t3.length + 40);
});

test('GATE 5 — anexo pelo frontend vira referência na task QA', async ({ page }) => {
  await login(page);

  // Upload real pelo composer: o input é oculto por design (o clique é no
  // botão), então o setFiles vai direto nele.
  const arquivo = '/tmp/aceite-anexo.txt';
  writeFileSync(arquivo, `Referência visual para a peça de homologação ${Date.now()}.\nGrid 2 colunas, fundo escuro, CTA discreto.\n`, 'utf8');
  await page.locator('input[type="file"]').first().setInputFiles(arquivo);
  await expect(page.getByLabel('Remover anexo')).toBeVisible({ timeout: 15_000 });
  // O envio fica DESLIGADO enquanto o upload está em voo (composer.tsx:
  // isUploading). Sem esperar o spinner sumir, o Enter não faz nada e a
  // mensagem morre no campo — foi o que derrubou este gate na primeira vez.
  await expect.poll(async () => page.locator('.animate-spin').count(), { timeout: 60_000 }).toBe(0);

  const t1 = await falar(page, 'Bento, chegou essa referência em anexo. É material pra uma peça nova da Clinica Teste Fase 7.');
  expect(t1.length).toBeGreaterThan(20);

  const t2 = await falar(page, 'usa o arquivo acima no briefing e cria a demanda pro Gui.');
  // A ordem precisa EXECUTAR na lista QA (a fence segue ativa) e mencionar o
  // material — "não entendi" ou pedir o arquivo de volta é FAIL.
  expect(t2).not.toMatch(SEM_CONTEXTO);
  expect(t2, 'a criação precisa ser confirmada com link da task').toMatch(/app\.clickup\.com\/t\//);
  expect(t2.toLowerCase(), 'a referência ao anexo precisa aparecer na confirmação').toMatch(/anex|arquivo|referência|referencia|material/);
});

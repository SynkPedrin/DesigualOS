import { test, expect } from '@playwright/test';
import { appendFileSync, writeFileSync } from 'node:fs';

/**
 * CONTINUIDADE CONVERSACIONAL, no navegador publicado.
 *
 * O teste que este arquivo existe para impedir de voltar: "me dá 3 títulos" →
 * "me explica o segundo" → "Sem contexto anterior no turno". A régua é o
 * CONTEÚDO: a resposta precisa falar do item 2, não apenas ser longa.
 */
const EMAIL = process.env.QA_USER_EMAIL ?? '';
const PASSWORD = process.env.QA_USER_PASSWORD ?? '';
const SAIDA = process.env.ACEITE_SAIDA ?? '/tmp/continuidade.md';
test.skip(!EMAIL || !PASSWORD, 'credenciais QA ausentes');
test.describe.configure({ timeout: 900_000 });

/**
 * "Não sei do que você está falando", em todas as formas que os agentes usam.
 * Inclui "não encontrei isso nas fontes": numa conversa NOVA essa é a resposta
 * certa, e num follow-up com contexto é exatamente o defeito.
 */
const SEM_CONTEXTO =
  /n[ãa]o (tenho|sei|possuo|encontrei)[^.]{0,40}(hist[óo]rico|contexto|fontes|isso)|sem contexto anterior|me (diga|diz|joga|manda|passa)[^.]{0,30}(contexto|texto original|qual)|a qual ["“]?segundo|registrei a lacuna/i;

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
  // O envio precisa ser CONFIRMADO: o campo esvaziar é o único sinal na UI.
  if ((await campo.inputValue()).trim() !== '') {
    await page.waitForTimeout(1500);
    await campo.press('Enter');
    await page.waitForTimeout(1500);
    if ((await campo.inputValue()).trim() !== '') throw new Error(`UI não enviou: ${texto.slice(0, 50)}`);
  }
  await expect.poll(async () => bolhas.count(), { timeout }).toBeGreaterThan(antes);
  const nova = bolhas.nth(antes);
  await expect.poll(async () => (await nova.innerText()).trim().length, { timeout }).toBeGreaterThan(10);
  await expect
    .poll(async () => {
      const a = (await nova.innerText()).trim().length;
      await page.waitForTimeout(1500);
      return a === (await nova.innerText()).trim().length ? 'estavel' : 'crescendo';
    }, { timeout })
    .toBe('estavel');
  const r = (await nova.innerText()).replace(/\n\d\d:\d\d\n?/g, '\n').replace(/\nEncaminhar\s*$/i, '').trim();
  appendFileSync(SAIDA, `\n### "${texto.replace(/\s+/g, ' ').slice(0, 110)}"\n\n\`\`\`\n${r}\n\`\`\`\n`, 'utf8');
  return r;
}

/**
 * O segundo item da lista — é dele que "o segundo" fala.
 *
 * O Otto alterna três formatos reais: "2 Título", "2. Título" e um cabeçalho
 * "Post 2" com o título na linha seguinte. Um parser que só aceitava o primeiro
 * reprovou uma entrega correta — a régua tem que acompanhar como o agente
 * escreve, não o contrário.
 */
function itensDaLista(texto: string): string[] {
  const linhas = texto.split('\n').map((l) => l.trim());
  const itens: string[] = [];
  for (let i = 0; i < linhas.length; i += 1) {
    const l = linhas[i]!;
    // "Post 2", "Opção 2", "Título 2" sozinhos: o item é a próxima linha útil.
    if (/^(post|op[çc][ãa]o|t[ií]tulo|vers[ãa]o)\s*\d+[:.)]?$/i.test(l)) {
      const prox = linhas.slice(i + 1).find((x) => x.length > 0);
      if (prox) itens.push(prox);
      continue;
    }
    const inline = /^(?:\d+[.)]?|[-*•])\s+(\S.*)$/.exec(l);
    if (inline?.[1]) itens.push(inline[1].trim());
  }
  return itens;
}

function segundoItem(texto: string): string | null {
  return itensDaLista(texto)[1] ?? null;
}

/** Palavras de conteúdo compartilhadas — prova que a resposta fala DAQUELE item. */
function compartilha(a: string, b: string): number {
  const toks = (t: string) =>
    new Set(t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter((x) => x.length >= 5));
  const ta = toks(a); const tb = toks(b);
  if (ta.size === 0) return 0;
  let n = 0; for (const x of ta) if (tb.has(x)) n += 1;
  return n / ta.size;
}

test.beforeAll(() => writeFileSync(SAIDA, `# Continuidade — ${new Date().toISOString()}\n`, 'utf8'));

test('FASE 20 — ordinal, uso do item e revisão encadeada (Otto)', async ({ page }) => {
  await login(page);

  const titulos = await falar(page, 'Otto, me dá 3 títulos curtos para um post sobre atendimento humanizado numa clínica.');
  const segundo = segundoItem(titulos);
  expect(segundo, 'o Otto precisa entregar uma lista numerada').toBeTruthy();

  const explica = await falar(page, 'me explica o segundo.');
  expect(explica, 'não pode pedir o contexto de volta').not.toMatch(SEM_CONTEXTO);
  expect(compartilha(segundo!, explica), `a explicação precisa falar do item 2 ("${segundo}")`).toBeGreaterThan(0.25);

  const legenda = await falar(page, 'faz uma legenda usando ele.');
  expect(legenda).not.toMatch(SEM_CONTEXTO);
  expect(legenda.length, 'legenda é entrega real').toBeGreaterThan(80);

  const revisao = await falar(page, 'tá muito genérico.');
  expect(revisao).not.toMatch(SEM_CONTEXTO);
  expect(compartilha(revisao, legenda), 'revisão precisa ser texto MATERIALMENTE diferente').toBeLessThan(0.8);
  expect(revisao.length).toBeGreaterThan(80);
});

test('FASE 10 — mudança explícita de assunto não fica presa no anterior', async ({ page }) => {
  await login(page);
  await falar(page, 'Otto, me dá 2 títulos para um post sobre check-up anual.');
  const novo = await falar(page, 'Agora esquece isso. Me dá 2 títulos sobre atendimento de urgência à noite.');
  expect(novo.toLowerCase()).toMatch(/urg[êe]ncia|noite|plant[ãa]o|madrugada/);
});

test('FASE 12 — conversa nova não herda diálogo', async ({ page }) => {
  await login(page);
  await falar(page, 'Otto, me dá 3 títulos curtos sobre vacinação infantil.');
  // Conversa NOVA: o referente do turno anterior não pode existir aqui.
  await page.getByRole('button', { name: /novo chat/i }).click();
  await page.waitForTimeout(2000);
  const orfao = await falar(page, 'me explica o segundo.');
  expect(orfao, 'sem conversa anterior, pedir o contexto é a resposta CERTA').toMatch(SEM_CONTEXTO);
});

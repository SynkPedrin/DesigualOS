import { test, expect } from '@playwright/test';
import { appendFileSync, writeFileSync } from 'node:fs';

/**
 * OTTO RELEASE — o teste decisivo do deploy 6c7f13f.
 *
 * O que está sendo provado aqui, no navegador publicado, contra o otto-node
 * recém-deployado: um follow-up referencial resolve NA CONVERSA, sem vault e
 * sem sair do cliente. A régua é conteúdo: "me explica o segundo" precisa
 * falar do item 2 que o Otto acabou de escrever — recusa vazia ou resposta
 * sobre outro cliente são FAIL, mesmo que o turno "responda algo".
 */
const EMAIL = process.env.QA_USER_EMAIL ?? '';
const PASSWORD = process.env.QA_USER_PASSWORD ?? '';
const SAIDA = process.env.ACEITE_SAIDA ?? '/tmp/otto-release.md';
test.skip(!EMAIL || !PASSWORD, 'credenciais QA ausentes');
test.describe.configure({ mode: 'serial', timeout: 1_800_000 });

const SEM_CONTEXTO =
  /n[ãa]o (tenho|sei|possuo|encontrei)[^.]{0,40}(hist[óo]rico|contexto|fontes|isso)|sem contexto anterior|me (diga|diz|joga|manda|passa)[^.]{0,30}(contexto|texto original|qual)|a qual ["“]?segundo|registrei a lacuna/i;

/** Material de outro cliente não pode aparecer em nenhuma resposta. */
const OUTRO_CLIENTE = /\bapae\b/i;

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
  // Mede o CONTEÚDO, sem o rodapé da bolha — a bolha remonta durante o
  // streaming e um timestamp parado não é resposta (flake medido em 18/09).
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

/**
 * Itens do que o Otto entregou, com o CORPO completo de cada um.
 *
 * O Otto alterna formatos reais: lista numerada ("2. Título"), cabeçalho
 * "Post 2" com o conteúdo no parágrafo, e peça conceito com "Variação A:".
 * Para medir referência não basta a primeira linha: a explicação de "o
 * segundo" parafraseia o CORPO do item (medido em 18/09 — a explicação
 * correta do Post 2 dizia "postura/confiança", zero palavras do título).
 */
function itensDaLista(texto: string): string[] {
  // Cabeçalho "Post N" / "Título N" / "Versão N": o item é o parágrafo inteiro.
  const paragrafos = texto.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const comCabecalho = paragrafos.filter((p) => /^(post|op[çc][ãa]o|t[ií]tulo|vers[ãa]o|alternativa)\s*\d+\s*[:.)-]?\s*$/im.test(p.split('\n')[0]!.trim()));
  if (comCabecalho.length >= 2) {
    return comCabecalho.map((p) => p.split('\n').slice(1).join(' ').trim()).filter((c) => c.length > 0);
  }

  const linhas = texto.split('\n').map((l) => {
    const t = l.trim();
    // "Conceito:" e "Variação A:" são rótulos DE ITEM, não de locutor —
    // mesma regra do resolvedor do node, pra medir o mesmo conjunto.
    if (/^(conceito|varia[çc][ãa]o)\b/i.test(t)) return t;
    return t.replace(/^[A-ZÁ-Ú][\wÀ-ÿ]*:\s+(?=\S)/, '');
  });
  const itens: string[] = [];
  for (let i = 0; i < linhas.length; i += 1) {
    const l = linhas[i]!;
    // Peça conceito: "Conceito: "texto"" é o primeiro item da peça.
    const conceito = /^conceito:\s*["“]?(.+?)["”]?\s*$/i.exec(l);
    if (conceito?.[1] && conceito[1].length > 3) {
      itens.push(conceito[1].trim());
      continue;
    }
    if (/^(post|op[çc][ãa]o|t[ií]tulo|vers[ãa]o|alternativa)\s*\d+\s*[:.)-]?$/i.test(l)) {
      const prox = linhas.slice(i + 1).find((x) => x.length > 0);
      if (prox) itens.push(prox);
      continue;
    }
    // Formato letrado que o Otto usa em peça conceito: "Variação A: ...".
    // A ordem do documento é a ordem dos itens.
    const letra = /^varia[çc][ãa]o\s+([a-e])\s*[:.)-]\s*(.+)$/i.exec(l);
    if (letra?.[1]) {
      itens.push(letra[1].trim());
      continue;
    }
    const inline = /^(?:\d+\s*[.)-]?|[-*•])\s+(\S.*)$/.exec(l);
    if (inline?.[1]) itens.push(inline[1].trim());
  }
  return itens;
}

/** Fração de palavras de conteúdo de `a` presentes em `b`. */
function compartilha(a: string, b: string): number {
  const toks = (t: string) =>
    new Set(t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((x) => x.length >= 5));
  const ta = toks(a);
  const tb = toks(b);
  if (ta.size === 0) return 0;
  let n = 0;
  for (const x of ta) if (tb.has(x)) n += 1;
  return n / ta.size;
}

/**
 * O teste de referência honesto: a resposta fala MAIS do item citado do que
 * dos outros. Parafrasear é o jeito certo de explicar — exigir as palavras
 * do título reprova resposta correta (medido em 18/09).
 */
function indiceMaisProximo(resposta: string, itens: string[]): number {
  let melhor = -1;
  let melhorScore = 0;
  itens.forEach((item, i) => {
    const s = compartilha(item, resposta);
    if (s > melhorScore) {
      melhorScore = s;
      melhor = i;
    }
  });
  return melhor;
}

test.beforeAll(() => writeFileSync(SAIDA, `# Otto release — ${new Date().toISOString()}\n`, 'utf8'));

test('PASSO 8 — referencial: segundo, legenda, revisão, volta ao primeiro', async ({ page }) => {
  await login(page);

  const titulos = await falar(page, 'Otto, me dá 3 títulos para uma campanha da Elite.');
  expect(titulos).not.toMatch(OUTRO_CLIENTE);
  const itens = itensDaLista(titulos);
  // O conjunto de referentes é o que o Otto REALMENTE produziu: 3 títulos
  // numerados ou uma peça conceito com variações. O que o teste mede é a
  // resolução ordinal sobre esse conjunto — não o formato.
  expect(itens.length, `o Otto precisa entregar itens referenciáveis (recebi: ${titulos.slice(0, 120)})`).toBeGreaterThanOrEqual(2);

  const explica = await falar(page, 'me explica o segundo.');
  expect(explica, 'não pode pedir o contexto de volta').not.toMatch(SEM_CONTEXTO);
  expect(explica, 'não pode falar de outro cliente').not.toMatch(OUTRO_CLIENTE);
  expect(
    indiceMaisProximo(explica, itens),
    `a explicação precisa ser sobre o item 2, não sobre outro. Itens: ${itens.map((i) => i.slice(0, 40)).join(' | ')}`,
  ).toBe(1);

  const legenda = await falar(page, 'faz uma legenda usando ele.');
  expect(legenda).not.toMatch(SEM_CONTEXTO);
  expect(legenda).not.toMatch(OUTRO_CLIENTE);
  expect(indiceMaisProximo(legenda, itens), 'a legenda precisa nascer do item 2').toBe(1);
  expect(legenda.length, 'legenda é entrega real').toBeGreaterThan(80);

  const revisao = await falar(page, 'tá com cara de IA.');
  expect(revisao).not.toMatch(SEM_CONTEXTO);
  expect(revisao.length).toBeGreaterThan(80);
  expect(compartilha(revisao, legenda), 'revisão precisa ser texto MATERIALMENTE diferente').toBeLessThan(0.8);

  const voltaAoPrimeiro = await falar(page, 'agora usa o primeiro.');
  expect(voltaAoPrimeiro).not.toMatch(SEM_CONTEXTO);
  expect(voltaAoPrimeiro).not.toMatch(OUTRO_CLIENTE);
  expect(indiceMaisProximo(voltaAoPrimeiro, itens), 'precisa voltar ao item 1').toBe(0);
});

test('PASSO 10 — fluxo completo de 11 turnos', async ({ page }) => {
  await login(page);

  const t1 = await falar(page, 'Otto, lembra daquela campanha de aniversário da Elite?');
  expect(t1.length).toBeGreaterThan(40);
  expect(t1).not.toMatch(OUTRO_CLIENTE);

  const t2 = await falar(page, 'Me explica.');
  expect(t2, 'follow-up curto não pode pedir o contexto de volta').not.toMatch(SEM_CONTEXTO);

  const t3 = await falar(page, 'Me dá 3 títulos.');
  const itens = itensDaLista(t3);
  expect(itens.length, 'títulos são entrega real').toBeGreaterThanOrEqual(2);
  expect(t3).not.toMatch(OUTRO_CLIENTE);

  const t4 = await falar(page, 'Agora faz uma legenda.');
  expect(t4).not.toMatch(SEM_CONTEXTO);
  expect(t4.length).toBeGreaterThan(80);

  const t5 = await falar(page, 'Tá com cara de IA.');
  expect(t5).not.toMatch(SEM_CONTEXTO);
  expect(compartilha(t5, t4), 'feedback precisa alterar o texto de verdade').toBeLessThan(0.8);

  const t6 = await falar(page, 'Faz de outro jeito então.');
  expect(t6).not.toMatch(SEM_CONTEXTO);
  expect(compartilha(t6, t5), 'nova direção precisa ser diferente da anterior').toBeLessThan(0.8);

  const t7 = await falar(page, 'Uma versão pro cliente.');
  expect(t7).not.toMatch(SEM_CONTEXTO);
  // Client-facing: nada de encanamento interno.
  expect(t7).not.toMatch(/app\.clickup\.com|list_?id|task_?id|execution_?id|EXE-\d{4}/i);

  const t8 = await falar(page, 'Leva em conta o que falei ontem.');
  // Memória honesta: ou usa, ou admite ausência — nunca inventa.
  expect(t8.length).toBeGreaterThan(40);

  const t9 = await falar(page, 'E vê como tá operacionalmente.');
  expect(t9.length).toBeGreaterThan(40);
  expect(t9).not.toMatch(OUTRO_CLIENTE);

  const t10 = await falar(page, 'Agora fecha uma versão final.');
  expect(t10).not.toMatch(SEM_CONTEXTO);
  expect(t10.length, 'versão final é artefato utilizável').toBeGreaterThan(100);

  const t11 = await falar(page, 'Coloca a data exata do evento no título.');
  /**
   * Hard-fact safety: a data do evento nunca foi dita nesta conversa. O Otto
   * não pode inventar "dia 20" nem "25/10" — ou ele pergunta/declara a
   * ausência, ou qualquer data específica na resposta é FAIL.
   */
  const inventouData = /\b(dia \d{1,2}|\d{1,2}\/\d{1,2}|\d{1,2} de (janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro))/i.test(t11)
    && !/não (tenho|sei|consta)|me (diz|confirma|passa|informa)|qual (é )?a data|não foi (informada|mencionada)/i.test(t11);
  expect(inventouData, `data inventada? resposta: ${t11.slice(0, 200)}`).toBe(false);
});

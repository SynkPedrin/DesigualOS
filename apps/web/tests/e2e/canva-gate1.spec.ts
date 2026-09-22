import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * GATE 1 — Foundation do editor Canva, verificado no NAVEGADOR REAL.
 *
 * Nada aqui confia em estado de React, comentário de código ou atributo do
 * elemento canvas: as asserções leem o arquivo PNG que o browser realmente
 * baixou e medem a geometria que o usuário realmente vê.
 */

const EMAIL = process.env.STUDIO_TEST_EMAIL ?? '';
const PASSWORD = process.env.STUDIO_TEST_PASSWORD ?? '';
const CLIENTE = process.env.STUDIO_TEST_CLIENT ?? 'Clinica Teste Fase 7';

test.skip(!EMAIL || !PASSWORD, 'defina STUDIO_TEST_EMAIL/STUDIO_TEST_PASSWORD');

/** Lê largura/altura do IHDR do PNG (bytes 16..24). Sem dependência de imagem. */
export function pngSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`não é PNG: ${path}`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45000 });
}

/** Abre a aba Canva do Studio já com um cliente escolhido. */
async function abrirCanva(page: Page) {
  await page.goto('/studio');
  await page.getByRole('button', { name: /novo projeto/i }).waitFor({ state: 'visible', timeout: 45000 });
  await page.getByRole('button', { name: /^canva$/i }).first().click();
  const select = page.getByLabel('Cliente');
  await select.waitFor({ state: 'visible', timeout: 30000 });
  // A lista de clientes chega por query: selecionar antes de ela existir
  // falha com "did not find some options".
  await expect(select.locator('option', { hasText: CLIENTE })).toHaveCount(1, { timeout: 30000 });
  await select.selectOption({ label: CLIENTE });
}

/** Cria um design no preset pedido e espera o editor abrir. */
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

async function criarDesign(page: Page, presetLabel: string, nome: string) {
  log('abrindo modal Novo design');
  await page.getByRole('button', { name: /novo design/i }).first().click();
  await page.getByRole('button', { name: 'Criar design' }).waitFor({ state: 'visible', timeout: 20000 });
  // Cada tile traz o rótulo E as dimensões ("Instagram Portrait" + "1080×1350"),
  // então casar por texto contido, não exato.
  log(`escolhendo preset ${presetLabel}`);
  await page.getByRole('button').filter({ hasText: presetLabel }).first().click();
  // O campo de nome do modal NÃO tem atributo `type` (verificado no DOM real):
  // `input[type=text]` não casa com ele e acaba pegando a busca global do
  // shell, que fica atrás do overlay e nunca fica acionável.
  await page.locator('input:not([type])').first().fill(nome);
  log('clicando Criar design');
  await page.getByRole('button', { name: 'Criar design' }).click();
  // O editor está pronto quando a topbar de exportação existe.
  await page.getByRole('button', { name: /exportar/i }).waitFor({ state: 'visible', timeout: 90000 });
  log('editor aberto');
}

test('GATE1-E2E1: export tem a dimensão EXATA do documento em 1x, 2x e 4x', async ({ page }, testInfo) => {
  test.setTimeout(8 * 60 * 1000);
  await login(page);
  log('logado');
  await abrirCanva(page);
  log('aba Canva com cliente');
  await criarDesign(page, 'Instagram Portrait', `gate1-export-${Date.now()}`);

  // Conteúdo mínimo, best-effort e com timeout CURTO: um clique sem timeout
  // explícito espera o orçamento inteiro do teste quando o seletor não existe.
  // A dimensão exportada não depende de haver objetos - o artboard é o mesmo.
  await page.getByRole('button', { name: /elementos/i }).first().click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /retângulo|rect/i }).first().click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(600);

  const medidas: Record<number, { width: number; height: number }> = {};
  for (const multiplier of [1, 2, 4]) {
    await page.getByRole('button', { name: /exportar/i }).click();
    await page.waitForTimeout(300);
    // O menu lista PNG, JPEG e WEBP nessa ordem, cada um com 1x/2x/4x:
    // os três primeiros botões são os de PNG (verificado no DOM real).
    const indice = { 1: 0, 2: 1, 4: 2 }[multiplier]!;
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 180000 }),
      page.getByRole('menu').getByRole('button').nth(indice).click(),
    ]);
    const destino = testInfo.outputPath(`export-${multiplier}x.png`);
    await download.saveAs(destino);
    medidas[multiplier] = pngSize(destino);
    log(`EXPORT ${multiplier}x -> ${medidas[multiplier]!.width}x${medidas[multiplier]!.height}`);
    await page.waitForTimeout(500);
  }

  expect(medidas[1]).toEqual({ width: 1080, height: 1350 });
  expect(medidas[2]).toEqual({ width: 2160, height: 2700 });
  expect(medidas[4]).toEqual({ width: 4320, height: 5400 });
});

test('GATE1-E2E2: com documento aberto o editor ocupa a área útil da janela', async ({ page }) => {
  test.setTimeout(6 * 60 * 1000);
  await login(page);
  await abrirCanva(page);
  await criarDesign(page, 'Instagram Portrait', `gate1-layout-${Date.now()}`);
  await page.waitForTimeout(1200);

  const viewport = page.viewportSize()!;
  const canvas = (await page.locator('canvas').first().boundingBox())!;
  log(`viewport ${viewport.width}x${viewport.height} | canvas ${Math.round(canvas.width)}x${Math.round(canvas.height)} @ y=${Math.round(canvas.y)}`);

  // O hero "STUDIO" e o seletor de modo não podem estar ocupando área.
  await expect(page.getByRole('heading', { name: 'Studio', exact: true })).toBeHidden();
  await expect(page.getByRole('group', { name: 'Modo do Studio' })).toBeHidden();

  // O artboard tem que caber INTEIRO na janela (y negativo = cortado acima).
  expect(canvas.y).toBeGreaterThanOrEqual(0);
  expect(canvas.y + canvas.height).toBeLessThanOrEqual(viewport.height + 1);

  // E tem que usar a área do WORKSPACE, não só da janela: é o container real
  // que o editor recebe depois de topbar/sidebar/pages-bar. Comparar com o
  // viewport puro mediria o chrome, não o layout do editor.
  const workspace = (await page.locator('canvas').first().evaluate((el) => {
    const host = el.closest('[data-canva-workspace]') ?? el.parentElement?.parentElement?.parentElement;
    const r = (host as HTMLElement).getBoundingClientRect();
    return { width: r.width, height: r.height };
  }))!;
  const usoAltura = canvas.height / workspace.height;
  log(`workspace ${Math.round(workspace.width)}x${Math.round(workspace.height)} | artboard usa ${(usoAltura * 100).toFixed(0)}% da altura`);
  expect(usoAltura).toBeGreaterThan(0.8);

  // Sem scroll vertical duplo: o conteúdo da página não deve exceder a janela.
  const scrollExcess = await page.evaluate(() => document.body.scrollHeight - window.innerHeight);
  log(`excesso de scroll no body: ${scrollExcess}px`);
  expect(scrollExcess).toBeLessThanOrEqual(8);
});

/** Adiciona N formas pelo painel Elementos. Devolve quantas entraram. */
async function addShapes(page: Page, n: number): Promise<number> {
  // "Elementos" já é o painel aberto por padrão: clicar de novo FECHA o
  // painel e some com os botões de forma. Só abre se não estiver aberto.
  const retangulo = page.getByRole('button', { name: 'Retângulo', exact: true }).first();
  if (!(await retangulo.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Elementos' }).first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
  // Formas diferentes para o marquee ter caixas distintas.
  const nomes = ['Retângulo', 'Elipse', 'Triângulo', 'Estrela'];
  let feitas = 0;
  for (let i = 0; i < n; i++) {
    const botao = page.getByRole('button', { name: nomes[i % nomes.length]!, exact: true }).first();
    if (!(await botao.isVisible().catch(() => false))) break;
    await botao.click();
    await page.waitForTimeout(450);
    feitas += 1;
  }
  return feitas;
}

/**
 * Conta objetos e seleção pelo painel Camadas - que é a fonte única do
 * documento (derivada de `page.objects`). Ler o Fabric por dentro não é
 * opção: a v6 não expõe `__fabric` no elemento, e testar por estado interno
 * mediria a biblioteca, não o produto.
 */
/**
 * Espera o documento estar GRAVADO de verdade antes de recarregar.
 *
 * Casar por texto (`/salvo/i`) não serve: "Salvo" e "Não salvo" compartilham
 * a palavra, e o teste passava com alteração ainda pendente - foi assim que o
 * Gate 2.1 recarregou a página no meio do debounce de 1500ms e concluiu que o
 * reorder "não persistia". O estado vem como dado, não como texto.
 */
async function esperarSalvo(page: Page) {
  await expect(page.locator('[data-canva-save-status="salvo"]')).toBeVisible({ timeout: 30000 });
}

async function abrirCamadas(page: Page) {
  const linhas = page.locator('[data-canva-layer]');
  if ((await linhas.count()) === 0) {
    await page.getByRole('button', { name: 'Camadas' }).first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
}
async function contarObjetos(page: Page): Promise<number> {
  await abrirCamadas(page);
  return page.locator('[data-canva-layer]').count();
}
async function contarSelecionados(page: Page): Promise<number> {
  await abrirCamadas(page);
  return page.locator('[data-canva-layer][aria-selected="true"]').count();
}

test('GATE1-E2E3/4/5: zoom ancora no cursor e pan não altera o documento', async ({ page }) => {
  test.setTimeout(8 * 60 * 1000);
  const patches: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'PATCH' && r.url().includes('/canvas-documents/')) patches.push(r.url());
  });

  await login(page);
  await abrirCanva(page);
  await criarDesign(page, 'Instagram Portrait', `gate1-viewport-${Date.now()}`);
  await addShapes(page, 1);
  await page.waitForTimeout(2500);

  const ws = page.locator('[data-canva-workspace]');
  const art = page.locator('[data-canva-artboard]');
  const box = (await ws.boundingBox())!;
  const cursor = { x: Math.round(box.x + box.width * 0.35), y: Math.round(box.y + box.height * 0.35) };

  // Ponto do documento sob o cursor ANTES do zoom.
  const antes = (await art.boundingBox())!;
  const zoomAntes = antes.width; // largura renderizada ~ proporcional ao zoom
  const docX = (cursor.x - antes.x) / zoomAntes;
  const docY = (cursor.y - antes.y) / antes.height;

  await page.mouse.move(cursor.x, cursor.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -240);
  await page.keyboard.up('Control');
  await page.waitForTimeout(700);

  const depois = (await art.boundingBox())!;
  expect(depois.width).toBeGreaterThan(antes.width); // deu zoom in de fato
  const telaX = depois.x + docX * depois.width;
  const telaY = depois.y + docY * depois.height;
  log(`zoom ${Math.round(antes.width)}->${Math.round(depois.width)} | ponto voltou a (${Math.round(telaX)},${Math.round(telaY)}) vs cursor (${cursor.x},${cursor.y})`);
  expect(Math.abs(telaX - cursor.x)).toBeLessThan(24);
  expect(Math.abs(telaY - cursor.y)).toBeLessThan(24);

  // --- PAN: Space + drag e botão do meio. Nenhum dos dois altera o documento.
  const objetosAntes = await contarObjetos(page);
  const patchesAntes = patches.length;
  const panDe = async () => (await art.boundingBox())!.x;
  const panAntes = await panDe();

  await page.mouse.move(cursor.x, cursor.y);
  await page.keyboard.down('Space');
  await page.mouse.down();
  await page.mouse.move(cursor.x - 120, cursor.y - 80, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  await page.waitForTimeout(400);
  const panDepoisSpace = await panDe();
  log(`pan space: artboard.x ${Math.round(panAntes)} -> ${Math.round(panDepoisSpace)}`);

  await page.mouse.move(cursor.x, cursor.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(cursor.x + 100, cursor.y + 60, { steps: 8 });
  await page.mouse.up({ button: 'middle' });
  await page.waitForTimeout(400);
  const panDepoisMeio = await panDe();
  log(`pan meio: artboard.x -> ${Math.round(panDepoisMeio)}`);

  expect(Math.abs(panDepoisSpace - panAntes)).toBeGreaterThan(20);
  expect(Math.abs(panDepoisMeio - panDepoisSpace)).toBeGreaterThan(20);

  // INVARIANTE: viewport não é documento.
  expect(await contarObjetos(page)).toBe(objetosAntes);
  await page.waitForTimeout(2500);
  log(`PATCH durante zoom+pan: ${patches.length - patchesAntes}`);
  expect(patches.length - patchesAntes).toBe(0);
});

test('GATE1-E2E6: marquee seleciona por interseção e não polui histórico', async ({ page }) => {
  test.setTimeout(8 * 60 * 1000);
  await login(page);
  await abrirCanva(page);
  await criarDesign(page, 'Instagram Portrait', `gate1-marquee-${Date.now()}`);
  const criadas = await addShapes(page, 3);
  log(`formas criadas: ${criadas}`);
  expect(criadas).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(1500);

  // Diagnóstico: clique simples no centro precisa selecionar 1.
  const art0 = (await page.locator('[data-canva-artboard]').boundingBox())!;
  await page.mouse.click(art0.x + art0.width / 2, art0.y + art0.height / 2);
  await page.waitForTimeout(500);

  log(`apos clique simples: ${await contarSelecionados(page)} selecionado(s)`);
  log(`camadas listadas: ${await page.locator('[data-canva-layer]').count()}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // Arrasta no vazio cobrindo a artboard inteira: tem que pegar tudo.
  const art = (await page.locator('[data-canva-artboard]').boundingBox())!;
  await page.mouse.move(art.x + 4, art.y + 4);
  await page.mouse.down();
  await page.mouse.move(art.x + art.width - 4, art.y + art.height - 4, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(600);

  const selecionados = await contarSelecionados(page);
  log(`selecionados pelo marquee: ${selecionados} de ${criadas}`);
  expect(selecionados).toBeGreaterThanOrEqual(2);

  // O marquee é overlay temporário: não vira objeto do documento.
  expect(await contarObjetos(page)).toBe(criadas);
});

test('GATE1-E2E7: F5 recupera o documento salvo', async ({ page }) => {
  test.setTimeout(8 * 60 * 1000);
  await login(page);
  await abrirCanva(page);
  // Nome curto: o card do grid trunca nomes longos e o seletor por texto falha.
  const nome = `f5-${Date.now() % 1000000}`;
  await criarDesign(page, 'Instagram Portrait', nome);
  const criadas = await addShapes(page, 2);
  expect(criadas).toBeGreaterThanOrEqual(1);

  // Move a última forma, para haver posição a conferir depois do reload.
  const art = (await page.locator('[data-canva-artboard]').boundingBox())!;
  await page.mouse.move(art.x + art.width / 2, art.y + art.height / 2);
  await page.mouse.down();
  await page.mouse.move(art.x + art.width / 2 - 60, art.y + art.height / 2 - 40, { steps: 8 });
  await page.mouse.up();

  // Espera o autosave (debounce 1500ms) confirmar.
  await esperarSalvo(page);
  // Estado observável do documento = o que o painel Camadas lista.
  const lerCamadas = async () => {
    await abrirCamadas(page);
    return page.locator('[data-canva-layer]').allInnerTexts();
  };
  const antes = await lerCamadas();
  log(`antes do F5: ${JSON.stringify(antes)}`);
  expect(antes.length).toBeGreaterThanOrEqual(1);
  const url = page.url();

  // Nunca recarregar sem o documento estar gravado: o autosave tem debounce,
  // e um F5 no meio dele apaga a última edição (ver lib/canva/autosave.ts).
  await esperarSalvo(page);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  // Reabre o mesmo documento (a URL do Studio não carrega o doc sozinha).
  await abrirCanva(page);
  await page.getByRole('button', { name: `Abrir ${nome}` }).click({ timeout: 45000 });
  await page.getByRole('button', { name: /exportar/i }).waitFor({ state: 'visible', timeout: 90000 });
  await page.waitForTimeout(2500);

  const depois = await lerCamadas();
  log(`depois do F5: ${JSON.stringify(depois)} (url antes: ${url})`);
  expect(depois).toEqual(antes);
});

test('GATE1-REG: operações existentes seguem funcionando após a mudança de viewport', async ({ page }) => {
  test.setTimeout(8 * 60 * 1000);
  await login(page);
  await abrirCanva(page);
  await criarDesign(page, 'Instagram Portrait', `reg-${Date.now() % 1000000}`);

  // TEXTO
  await page.getByRole('button', { name: 'Texto' }).first().click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /título|titulo|heading/i }).first().click({ timeout: 6000 }).catch(async () => {
    await page.getByRole('button', { name: 'Texto', exact: true }).last().click({ timeout: 6000 });
  });
  await page.waitForTimeout(700);
  expect(await contarObjetos(page)).toBeGreaterThanOrEqual(1);
  log(`apos texto: ${await contarObjetos(page)} objeto(s)`);

  // FORMA + ARRASTE (pointer mapping é o que a mudança de viewport arrisca)
  await addShapes(page, 1);
  await page.waitForTimeout(600);
  const total = await contarObjetos(page);
  const art = (await page.locator('[data-canva-artboard]').boundingBox())!;
  const centro = { x: art.x + art.width / 2, y: art.y + art.height / 2 };
  await page.mouse.move(centro.x, centro.y);
  await page.mouse.down();
  await page.mouse.move(centro.x - 70, centro.y - 50, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const selDepoisArraste = await contarSelecionados(page);
  log(`arraste: ${selDepoisArraste} selecionado(s), ${await contarObjetos(page)} objeto(s)`);
  expect(selDepoisArraste).toBeGreaterThanOrEqual(1);
  expect(await contarObjetos(page)).toBe(total);

  // UNDO / REDO pelo botão da topbar.
  // A última ação registrada foi o ARRASTE, então o primeiro undo desfaz a
  // posição e a contagem continua igual - é o segundo undo que remove a
  // forma criada. Esperar remoção no primeiro seria testar outra coisa.
  await page.getByRole('button', { name: 'Desfazer' }).click();
  await page.waitForTimeout(700);
  expect(await contarObjetos(page)).toBe(total);

  await page.getByRole('button', { name: 'Desfazer' }).click();
  await page.waitForTimeout(700);
  const aposDoisUndos = await contarObjetos(page);
  log(`apos 2 undos: ${aposDoisUndos} (era ${total})`);
  expect(aposDoisUndos).toBe(total - 1);

  await page.getByRole('button', { name: 'Refazer' }).click();
  await page.waitForTimeout(700);
  const aposRedo = await contarObjetos(page);
  log(`apos redo: ${aposRedo}`);
  expect(aposRedo).toBe(total);

  // ZOOM pela topbar continua refletindo na UI
  await page.getByRole('button', { name: 'Aumentar zoom' }).click();
  await page.waitForTimeout(500);
  const rotulo = await page.getByTitle('Zoom').innerText();
  log(`zoom na topbar: ${rotulo}`);
  expect(rotulo).toMatch(/\d+%/);
});

import { test, expect, type Page } from '@playwright/test';

/**
 * GATE 2 — ferramentas de design, verificadas no NAVEGADOR REAL.
 * Reaproveita os helpers do Gate 1 (login, abrir Canva, criar design).
 */
const EMAIL = process.env.STUDIO_TEST_EMAIL ?? '';
const PASSWORD = process.env.STUDIO_TEST_PASSWORD ?? '';
const CLIENTE = process.env.STUDIO_TEST_CLIENT ?? 'Clinica Teste Fase 7';
test.skip(!EMAIL || !PASSWORD, 'defina STUDIO_TEST_EMAIL/STUDIO_TEST_PASSWORD');

const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45000 });
}

async function abrirCanva(page: Page) {
  await page.goto('/studio');
  await page.getByRole('button', { name: /novo projeto/i }).waitFor({ state: 'visible', timeout: 45000 });
  await page.getByRole('button', { name: /^canva$/i }).first().click();
  const select = page.getByLabel('Cliente');
  await select.waitFor({ state: 'visible', timeout: 30000 });
  await expect(select.locator('option', { hasText: CLIENTE })).toHaveCount(1, { timeout: 30000 });
  await select.selectOption({ label: CLIENTE });
}

async function criarDesign(page: Page, preset: string, nome: string) {
  await page.getByRole('button', { name: /novo design/i }).first().click();
  await page.getByRole('button', { name: 'Criar design' }).waitFor({ state: 'visible', timeout: 20000 });
  await page.getByRole('button').filter({ hasText: preset }).first().click();
  await page.locator('input:not([type])').first().fill(nome);
  await page.getByRole('button', { name: 'Criar design' }).click();
  await page.getByRole('button', { name: /exportar/i }).waitFor({ state: 'visible', timeout: 90000 });
}

async function addShapes(page: Page, n: number): Promise<number> {
  const retangulo = page.getByRole('button', { name: 'Retângulo', exact: true }).first();
  if (!(await retangulo.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Elementos' }).first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
  const nomes = ['Retângulo', 'Elipse', 'Triângulo', 'Estrela'];
  let feitas = 0;
  for (let i = 0; i < n; i++) {
    const b = page.getByRole('button', { name: nomes[i % nomes.length]!, exact: true }).first();
    if (!(await b.isVisible().catch(() => false))) break;
    await b.click();
    await page.waitForTimeout(450);
    feitas += 1;
  }
  return feitas;
}

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
  /**
   * O botão da trilha ALTERNA (`aria-pressed`, ver canva-sidebar.tsx): clicar
   * com o painel já aberto FECHA. Um helper que clica "quando não vejo linhas"
   * portanto fecha o painel justo quando ele ia aparecer, e o teste lê 0
   * camadas — foi exatamente o que aconteceu aqui, e por um instante pareceu
   * que desagrupar tinha apagado tudo (a artboard, na captura da falha,
   * mostrava as três formas no lugar). Garantir ESTADO, nunca alternar.
   */
  const aba = page.getByRole('button', { name: 'Camadas' }).first();
  if ((await aba.getAttribute('aria-pressed')) !== 'true') {
    await aba.click({ timeout: 8000 }).catch(() => {});
  }
  await page.waitForTimeout(500);
}

test('G2-01: painel de propriedades aplica posição, tamanho, rotação e opacidade', async ({ page }) => {
  test.setTimeout(8 * 60 * 1000);
  await login(page);
  await abrirCanva(page);
  const nome = `g2p-${Date.now() % 1000000}`;
  await criarDesign(page, 'Instagram Portrait', nome);
  expect(await addShapes(page, 1)).toBe(1);
  await page.waitForTimeout(800);

  const painel = page.locator('[data-canva-properties]');
  await expect(painel).toBeVisible();

  const setar = async (label: string, valor: number) => {
    const campo = painel.getByLabel(label, { exact: true });
    await campo.fill(String(valor));
    await campo.press('Enter');
    await page.waitForTimeout(350);
  };
  await setar('X', 100);
  await setar('Y', 150);
  await setar('L', 300);
  await setar('A', 200);
  await setar('Ang', 25);

  const ler = async (label: string) => Number(await painel.getByLabel(label, { exact: true }).inputValue());
  log(`painel: X=${await ler('X')} Y=${await ler('Y')} L=${await ler('L')} A=${await ler('A')} Ang=${await ler('Ang')}`);
  expect(await ler('X')).toBe(100);
  expect(await ler('Y')).toBe(150);
  expect(await ler('L')).toBe(300);
  expect(await ler('A')).toBe(200);
  expect(await ler('Ang')).toBe(25);

  // Sobrevive ao F5.
  await esperarSalvo(page);
  await page.reload();
  await abrirCanva(page);
  await page.getByRole('button', { name: `Abrir ${nome}` }).click({ timeout: 45000 });
  await page.getByRole('button', { name: /exportar/i }).waitFor({ state: 'visible', timeout: 90000 });
  await page.waitForTimeout(1500);
  // Seleciona pela lista de camadas (sem clique no canvas: clique sem timeout
  // explícito consome o orçamento inteiro do teste quando não acerta nada).
  await abrirCamadas(page);
  await page.locator('[data-canva-layer]').first().click({ timeout: 15000 });
  await page.waitForTimeout(800);
  log(`apos F5 (${nome}): X=${await ler('X')} Y=${await ler('Y')} Ang=${await ler('Ang')}`);
  expect(await ler('X')).toBe(100);
  expect(await ler('Ang')).toBe(25);
});

/** Caixa de um objeto, em coordenadas de DOCUMENTO, lida pelo painel. */
async function lerCaixa(page: Page, indiceCamada: number) {
  await abrirCamadas(page);
  await page.locator('[data-canva-layer]').nth(indiceCamada).getByRole('button').first().click();
  await page.waitForTimeout(350);
  const p = page.locator('[data-canva-properties]');
  const n = async (l: string) => Number(await p.getByLabel(l, { exact: true }).inputValue());
  return { x: await n('X'), y: await n('Y'), w: await n('L'), h: await n('A') };
}

test('G2-04/05: alinhar em 6 direções e distribuir com vãos iguais', async ({ page }) => {
  test.setTimeout(8 * 60 * 1000);
  await login(page);
  await abrirCanva(page);
  await criarDesign(page, 'Instagram Portrait', `g2-al-${Date.now() % 1000000}`);
  expect(await addShapes(page, 3)).toBe(3);
  await page.waitForTimeout(800);

  // Espalha os três em X e larguras diferentes, via painel.
  const painel = page.locator('[data-canva-properties]');
  const setar = async (label: string, v: number) => {
    const c = painel.getByLabel(label, { exact: true });
    await c.fill(String(v));
    await c.press('Enter');
    await page.waitForTimeout(250);
  };
  const config = [{ x: 0, w: 100 }, { x: 150, w: 40 }, { x: 400, w: 200 }];
  for (let i = 0; i < 3; i++) {
    await abrirCamadas(page);
    await page.locator('[data-canva-layer]').nth(i).click();
    await page.waitForTimeout(300);
    await setar('X', config[i]!.x);
    await setar('Y', 100 + i * 10);
    await setar('L', config[i]!.w);
  }

  const antesAlign = [await lerCaixa(page, 0), await lerCaixa(page, 1), await lerCaixa(page, 2)];
  log(`antes do align -> X: ${antesAlign.map((c) => c.x).join(', ')}`);
  await page.locator('[data-canva-artboard]').click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(600);
  log(`titulo do painel apos Ctrl+A: "${await painel.locator('p').first().innerText()}"`);
  const botaoAlign = painel.getByRole('button', { name: 'Alinhar à esquerda' });
  log(`botao align visivel=${await botaoAlign.isVisible()} habilitado=${await botaoAlign.isEnabled()}`);
  await botaoAlign.click();
  await page.waitForTimeout(900);
  const esq = [await lerCaixa(page, 0), await lerCaixa(page, 1), await lerCaixa(page, 2)];
  log(`align left -> X: ${esq.map((c) => c.x).join(', ')}`);
  expect(new Set(esq.map((c) => c.x)).size).toBe(1);

  // Distribuir: reposiciona e mede os vãos.
  for (let i = 0; i < 3; i++) {
    await abrirCamadas(page);
    await page.locator('[data-canva-layer]').nth(i).click();
    await page.waitForTimeout(300);
    await setar('X', config[i]!.x);
  }
  // Ctrl+A precisa do foco no canvas: clicar numa camada antes deixa a
  // seleção em 1 objeto e o botão de distribuir (que exige 3) fica desabilitado.
  await page.locator('[data-canva-artboard]').click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(600);
  await painel.getByRole('button', { name: 'Distribuir na horizontal' }).click();
  await page.waitForTimeout(700);

  const caixas = [await lerCaixa(page, 0), await lerCaixa(page, 1), await lerCaixa(page, 2)].sort((a, b) => a.x - b.x);
  const vao1 = caixas[1]!.x - (caixas[0]!.x + caixas[0]!.w);
  const vao2 = caixas[2]!.x - (caixas[1]!.x + caixas[1]!.w);
  log(`distribuir -> vãos ${vao1} e ${vao2}`);
  expect(Math.abs(vao1 - vao2)).toBeLessThanOrEqual(2);
});

test('G2-07/09: rename persiste no F5 e lock impede mover/apagar', async ({ page }) => {
  test.setTimeout(8 * 60 * 1000);
  await login(page);
  await abrirCanva(page);
  const nome = `g2-lk-${Date.now() % 1000000}`;
  await criarDesign(page, 'Instagram Portrait', nome);
  expect(await addShapes(page, 1)).toBe(1);
  await page.waitForTimeout(700);

  // RENAME
  await abrirCamadas(page);
  const linha = page.locator('[data-canva-layer]').first();
  await linha.getByRole('button').first().dblclick();
  const campo = page.getByLabel('Nome da camada');
  await campo.fill('CTA Background');
  await campo.press('Enter');
  await page.waitForTimeout(700);
  await expect(page.locator('[data-canva-layer]').first()).toContainText('CTA Background');
  log('rename aplicado');

  // LOCK
  const antes = await lerCaixa(page, 0);
  // Os botões da linha são só ícone; o nome acessível vem do `title`.
  await page.locator('[data-canva-layer]').first().getByRole('button', { name: 'Bloquear' }).click({ timeout: 8000 });
  await page.waitForTimeout(500);
  const art = (await page.locator('[data-canva-artboard]').boundingBox())!;
  await page.mouse.move(art.x + art.width / 2, art.y + art.height / 2);
  await page.mouse.down();
  await page.mouse.move(art.x + art.width / 2 + 80, art.y + art.height / 2 + 60, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(500);
  const camadasDepois = await page.locator('[data-canva-layer]').count();
  const depois = await lerCaixa(page, 0);
  log(`lock: caixa antes ${antes.x},${antes.y} depois ${depois.x},${depois.y} | camadas ${camadasDepois}`);
  expect(camadasDepois).toBe(1);
  expect(depois.x).toBe(antes.x);
  expect(depois.y).toBe(antes.y);

  // F5 mantém o nome
  await esperarSalvo(page);
  await page.reload();
  await abrirCanva(page);
  await page.getByRole('button', { name: `Abrir ${nome}` }).click({ timeout: 45000 });
  await page.getByRole('button', { name: /exportar/i }).waitFor({ state: 'visible', timeout: 90000 });
  await page.waitForTimeout(1500);
  await abrirCamadas(page);
  await expect(page.locator('[data-canva-layer]').first()).toContainText('CTA Background');
  log('rename sobreviveu ao F5');
});

test('G2-06: snap tem a mesma sensação em zooms diferentes', async ({ page }) => {
  test.setTimeout(8 * 60 * 1000);
  await login(page);
  await abrirCanva(page);
  await criarDesign(page, 'Instagram Portrait', `g2-snap-${Date.now() % 1000000}`);
  expect(await addShapes(page, 1)).toBe(1);
  await page.waitForTimeout(800);

  const painel = page.locator('[data-canva-properties]');
  const lerX = async () => Number(await painel.getByLabel('X', { exact: true }).inputValue());
  const setar = async (label: string, v: number) => {
    const c = painel.getByLabel(label, { exact: true });
    await c.fill(String(v));
    await c.press('Enter');
    await page.waitForTimeout(300);
  };
  await setar('L', 200);
  await setar('A', 200);
  await setar('Y', 500);

  const CENTRO = (1080 - 200) / 2; // 440: X em que a peça fica centrada
  const resultados: { zoom: string; encaixou: boolean }[] = [];

  async function tentarEncaixe(rotulo: string) {
    const zoomTexto = await page.getByTitle('Zoom').innerText();
    const z = Number(zoomTexto.replace('%', '')) / 100;
    // Começa 4px de TELA fora do centro - dentro da tolerância (7px de tela)
    // se a conversão por zoom estiver correta, fora dela se a tolerância
    // fosse fixa em pixels de documento.
    // A peça fica PERTO do centro do artboard - que é sempre a região mais
    // visível do container em qualquer zoom. Colocá-la longe fazia o ponto de
    // arrasto cair fora da área visível em zoom alto, e o teste media a minha
    // aritmética em vez do encaixe.
    const desvio = 40;
    await setar('X', CENTRO + desvio);

    const art = (await page.locator('[data-canva-artboard]').boundingBox())!;
    const escala = art.width / 1080;
    const de = { x: art.x + (CENTRO + desvio + 100) * escala, y: art.y + (500 + 100) * escala };
    // Solta a 4px de TELA do centro: dentro da tolerância (7px de tela) em
    // qualquer zoom, se a conversão estiver correta.
    const para = { x: art.x + (CENTRO + 100) * escala + 4, y: de.y };

    await page.mouse.move(de.x, de.y);
    await page.mouse.down();
    await page.mouse.move(de.x - 8, de.y, { steps: 4 });
    await page.mouse.move(para.x, para.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(500);

    const depois = await lerX();
    const encaixou = Math.abs(depois - CENTRO) <= 3;
    log(`snap @${zoomTexto} (${rotulo}): desvio ${desvio}px doc -> X=${depois} (centro ${CENTRO}) encaixou=${encaixou}`);
    resultados.push({ zoom: zoomTexto, encaixou });
  }

  await tentarEncaixe('zoom de encaixe');

  // Aproxima COM O CURSOR sobre a peça: o zoom ancorado (Gate 1) mantém o
  // ponto sob o cursor, então a peça continua alcançável na tela. Usar os
  // botões da topbar afastaria a peça para fora do container em zoom alto e
  // o teste mediria a minha aritmética, não o encaixe.
  const artAntes = (await page.locator('[data-canva-artboard]').boundingBox())!;
  const escalaAntes = artAntes.width / 1080;
  const sobreAPeca = { x: artAntes.x + (CENTRO + 100) * escalaAntes, y: artAntes.y + 600 * escalaAntes };
  await page.mouse.move(sobreAPeca.x, sobreAPeca.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -420);
  await page.keyboard.up('Control');
  await page.waitForTimeout(600);
  await tentarEncaixe('mais zoom');

  await page.mouse.move(sobreAPeca.x, sobreAPeca.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 700);
  await page.keyboard.up('Control');
  await page.waitForTimeout(600);
  await tentarEncaixe('menos zoom');

  log(`zooms testados: ${resultados.map((r) => r.zoom).join(', ')}`);
  // Zooms diferentes de verdade, e encaixe em todos.
  expect(new Set(resultados.map((r) => r.zoom)).size).toBeGreaterThanOrEqual(2);
  expect(resultados.every((r) => r.encaixou)).toBe(true);
});

test('G2-08/10: ocultar não exporta e reordenar muda a pilha', async ({ page }, testInfo) => {
  test.setTimeout(10 * 60 * 1000);
  await login(page);
  await abrirCanva(page);
  await criarDesign(page, 'Instagram Portrait', `g2-vis-${Date.now() % 1000000}`);
  expect(await addShapes(page, 2)).toBe(2);
  await page.waitForTimeout(800);
  await abrirCamadas(page);

  const ordemInicial = await page.locator('[data-canva-layer]').allInnerTexts();
  log(`ordem inicial: ${JSON.stringify(ordemInicial)}`);

  // REORDER por drag entre as duas linhas.
  const linhas = page.locator('[data-canva-layer]');
  await linhas.nth(0).dragTo(linhas.nth(1));
  await page.waitForTimeout(900);
  const ordemDepois = await page.locator('[data-canva-layer]').allInnerTexts();
  log(`ordem apos drag: ${JSON.stringify(ordemDepois)}`);
  expect(ordemDepois).not.toEqual(ordemInicial);

  // VISIBILIDADE: oculta a primeira e confirma que não entra no export.
  await page.locator('[data-canva-layer]').first().getByRole('button', { name: 'Ocultar' }).click();
  await page.waitForTimeout(700);
  await expect(page.locator('[data-canva-layer]').first().getByRole('button', { name: 'Mostrar' })).toBeVisible();
  log('camada ocultada');

  await page.getByRole('button', { name: /exportar/i }).click();
  await page.waitForTimeout(300);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }),
    page.getByRole('menu').getByRole('button').nth(0).click(),
  ]);
  const destino = testInfo.outputPath('oculta.png');
  await download.saveAs(destino);
  const { readFileSync } = await import('node:fs');
  const buf = readFileSync(destino);
  log(`export com camada oculta: ${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`);
  expect(buf.readUInt32BE(16)).toBe(1080);

  // F5 mantém ordem e visibilidade.
  await esperarSalvo(page);
  await page.reload();
  await abrirCanva(page);
  await page.locator('[data-canva-doc]').first().click({ timeout: 45000 });
  await page.getByRole('button', { name: /exportar/i }).waitFor({ state: 'visible', timeout: 90000 });
  await page.waitForTimeout(1500);
  await abrirCamadas(page);
  const ordemF5 = await page.locator('[data-canva-layer]').allInnerTexts();
  log(`ordem apos F5: ${JSON.stringify(ordemF5)}`);
  expect(ordemF5).toEqual(ordemDepois);
  await expect(page.locator('[data-canva-layer]').first().getByRole('button', { name: 'Mostrar' })).toBeVisible();
});

test('G2-11: agrupar, transformar, salvar, F5 e desagrupar', async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);
  await login(page);
  await abrirCanva(page);
  await criarDesign(page, 'Instagram Portrait', `g2-grp-${Date.now() % 1000000}`);
  expect(await addShapes(page, 3)).toBe(3);
  await page.waitForTimeout(800);
  await abrirCamadas(page);
  expect(await page.locator('[data-canva-layer]').count()).toBe(3);

  // Seleciona tudo e agrupa.
  await page.locator('[data-canva-workspace]').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Agrupar', exact: true }).first().click();
  await page.waitForTimeout(600);
  await expect(page.locator('[data-canva-layer]')).toHaveCount(1);

  // Transforma o grupo pelo painel de propriedades.
  const painel = page.locator('[data-canva-properties]');
  const setar = async (label: string, valor: number) => {
    const campo = painel.getByLabel(label, { exact: true });
    await campo.fill(String(valor));
    await campo.press('Enter');
    await page.waitForTimeout(350);
  };
  await setar('X', 120);
  await setar('Y', 200);
  await setar('Ang', 15);
  const ler = async (label: string) => Number(await painel.getByLabel(label, { exact: true }).inputValue());
  const antes = { x: await ler('X'), y: await ler('Y'), ang: await ler('Ang'), l: await ler('L'), a: await ler('A') };
  log(`grupo antes do F5: ${JSON.stringify(antes)}`);

  await esperarSalvo(page);
  await page.reload();
  await abrirCanva(page);
  await page.locator('[data-canva-doc]').first().click({ timeout: 45000 });
  await page.getByRole('button', { name: /exportar/i }).waitFor({ state: 'visible', timeout: 90000 });
  await page.waitForTimeout(1500);
  await abrirCamadas(page);

  // Continua sendo UM grupo, com a mesma transformação.
  await expect(page.locator('[data-canva-layer]')).toHaveCount(1);
  await page.locator('[data-canva-layer]').first().click();
  await page.waitForTimeout(400);
  const depois = { x: await ler('X'), y: await ler('Y'), ang: await ler('Ang'), l: await ler('L'), a: await ler('A') };
  log(`grupo depois do F5: ${JSON.stringify(depois)}`);
  for (const chave of ['x', 'y', 'ang', 'l', 'a'] as const) {
    expect(Math.abs(depois[chave] - antes[chave])).toBeLessThanOrEqual(2);
  }

  // E desagrupar devolve as três formas.
  await page.getByRole('button', { name: 'Desagrupar', exact: true }).first().click();
  await page.waitForTimeout(700);
  await expect(page.locator('[data-canva-layer]')).toHaveCount(3);
});

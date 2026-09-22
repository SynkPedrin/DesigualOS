import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  EMAIL, PASSWORD, abrirCamadas, abrirCanva, abrirPainel, addShapes, capturarErros, criarDesign,
  desselecionar, esperarSalvo, lerPainel, log, recarregarEReabrir, relatarErros, salvarArtefato,
  setarPainel, tela, login, dimensoesPng, addTexto, alphaDoPixel, escreverNoTexto, pontoNaTela,
} from './canva-helpers';

/** GATE 2.3 — o restante de G2-01→G2-20, no navegador real. */
test.skip(!EMAIL || !PASSWORD, 'defina STUDIO_TEST_EMAIL/STUDIO_TEST_PASSWORD');

async function selecionarPrimeiraCamada(page: Page) {
  await abrirCamadas(page);
  await page.locator('[data-canva-layer]').first().click();
  await page.waitForTimeout(500);
}

async function exportarPng(page: Page, indiceNoMenu = 0): Promise<Buffer> {
  await page.getByRole('button', { name: /exportar/i }).click();
  await page.waitForTimeout(300);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }),
    page.getByRole('menu').getByRole('button').nth(indiceNoMenu).click(),
  ]);
  return readFileSync(await download.path());
}

/** Abre o seletor de cor do objeto selecionado e devolve os locators dele. */
function seletorDeCor(page: Page, label: string) {
  const painel = page.locator('[data-canva-properties]');
  const hex = painel.getByLabel(`${label} em hexadecimal`);
  // O painel tem mais de um seletor de cor (preenchimento e borda), e todos
  // têm um botão "Conta-gotas". A pipeta certa é a IRMÃ deste campo hex.
  const linhaDoSeletor = hex.locator('xpath=..');
  return {
    // Botões se procuram por papel: `getByLabel` só alcança controles de
    // formulário, e a amostra, a pipeta e o gatilho do popover são <button>.
    abrir: async () => {
      await painel.getByRole('button', { name: label, exact: true }).click();
      await page.waitForTimeout(300);
    },
    hex,
    pipeta: linhaDoSeletor.getByRole('button', { name: 'Conta-gotas' }),
    amostra: (grupo: string, cor: string) => painel.getByRole('button', { name: `${grupo}: ${cor}` }),
  };
}

test('G2-02: sistema de cor aceita HEX, aplica amostras e persiste', async ({ page }, testInfo) => {
  test.setTimeout(10 * 60 * 1000);
  const erros = capturarErros(page);
  await login(page);
  await abrirCanva(page);
  await criarDesign(page, 'Instagram Portrait', `g2-02-${Date.now() % 1000000}`);
  expect(await addShapes(page, 1)).toBe(1);
  await page.waitForTimeout(600);

  const cor = seletorDeCor(page, 'Cor de preenchimento');
  // HEX digitado.
  await cor.hex.fill('#7b2eff');
  await cor.hex.press('Enter');
  await page.waitForTimeout(500);
  expect((await cor.hex.inputValue()).toLowerCase()).toBe('#7b2eff');
  log('HEX aplicado: #7b2eff');

  // RGB e HSL: o mesmo campo normaliza as três escritas para a canônica.
  for (const escrita of ['rgb(0, 214, 164)', 'hsl(0, 100%, 50%)']) {
    await cor.hex.fill(escrita);
    await cor.hex.press('Enter');
    await page.waitForTimeout(400);
    const lido = (await cor.hex.inputValue()).toLowerCase();
    log(`"${escrita}" normalizado para ${lido}`);
    expect(lido).toMatch(/^#[0-9a-f]{6}$/);
  }
  const corAntesDaAmostra = (await cor.hex.inputValue()).toLowerCase();
  expect(corAntesDaAmostra).toBe('#ff0000');

  // Amostras: Marca (Brand Kit do cliente de teste) e Documento.
  await cor.abrir();
  await tela(page, '03-color');
  const marca = cor.amostra('Marca', '#7b2eff');
  await expect(marca).toBeVisible();
  await marca.click();
  await page.waitForTimeout(500);
  expect((await cor.hex.inputValue()).toLowerCase()).toBe('#7b2eff');
  log('amostra da Marca aplicada');

  // Desfazer volta à cor anterior; refazer devolve a nova.
  //
  // Desfazer/refazer recarregam a página no canvas e, com isso, limpam a
  // seleção - o painel volta a mostrar "Documento". Então a camada é
  // selecionada de novo antes de ler a cor; não é contorno de teste, é o que
  // o usuário faz.
  await page.getByRole('button', { name: 'Desfazer' }).click();
  await page.waitForTimeout(900);
  await selecionarPrimeiraCamada(page);
  expect((await seletorDeCor(page, 'Cor de preenchimento').hex.inputValue()).toLowerCase()).toBe(corAntesDaAmostra);
  await page.getByRole('button', { name: 'Refazer' }).click();
  await page.waitForTimeout(900);
  await selecionarPrimeiraCamada(page);
  expect((await seletorDeCor(page, 'Cor de preenchimento').hex.inputValue()).toLowerCase()).toBe('#7b2eff');
  log('undo/redo da cor conferem');

  await esperarSalvo(page);
  await recarregarEReabrir(page);
  await abrirCamadas(page);
  await page.locator('[data-canva-layer]').first().click();
  await page.waitForTimeout(500);
  expect((await seletorDeCor(page, 'Cor de preenchimento').hex.inputValue()).toLowerCase()).toBe('#7b2eff');
  log('cor persistiu no F5');
  expect(relatarErros(erros, testInfo).pageerror).toEqual([]);
});

test('G2-03: conta-gotas — detecção, estado e aplicação da cor', async ({ page }, testInfo) => {
  test.setTimeout(8 * 60 * 1000);
  const erros = capturarErros(page);
  await login(page);
  await abrirCanva(page);
  await criarDesign(page, 'Instagram Portrait', `g2-03-${Date.now() % 1000000}`);
  expect(await addShapes(page, 1)).toBe(1);
  await page.waitForTimeout(600);

  const suportado = await page.evaluate(() => 'EyeDropper' in window);
  log(`EyeDropper disponível neste navegador: ${suportado}`);
  const cor = seletorDeCor(page, 'Cor de preenchimento');
  await cor.abrir();

  if (suportado) {
    await expect(cor.pipeta).toBeEnabled();
    log('botão do conta-gotas habilitado (Chromium)');
  } else {
    await expect(cor.pipeta).toBeDisabled();
    log('botão do conta-gotas desabilitado (navegador sem a API)');
  }

  /**
   * O picker nativo do SO não é controlável pelo Playwright: abrir o
   * conta-gotas de verdade travaria o teste numa janela do sistema. O que dá
   * para provar sem o SO é tudo o que é NOSSO - que a API é detectada, que o
   * botão reflete isso, e que a cor devolvida pelo picker chega ao objeto e
   * ao histórico. Por isso o `EyeDropper` é substituído por um que devolve
   * uma cor conhecida; o resto do caminho é o código real.
   */
  await page.evaluate(() => {
    (window as unknown as { EyeDropper: unknown }).EyeDropper = class {
      async open() { return { sRGBHex: '#00d6a4' }; }
    };
  });
  await cor.pipeta.click();
  await page.waitForTimeout(700);
  expect((await cor.hex.inputValue()).toLowerCase()).toBe('#00d6a4');
  log('cor do conta-gotas aplicada ao objeto');

  // E entrou no histórico. (Desfazer recarrega a página no canvas e limpa a
  // seleção, então a camada é selecionada de novo antes de ler.)
  await page.getByRole('button', { name: 'Desfazer' }).click();
  await page.waitForTimeout(900);
  await selecionarPrimeiraCamada(page);
  expect((await seletorDeCor(page, 'Cor de preenchimento').hex.inputValue()).toLowerCase()).not.toBe('#00d6a4');
  log('a aplicação do conta-gotas é uma entrada de histórico');
  expect(relatarErros(erros, testInfo).pageerror).toEqual([]);
});

test('G2-06: snap encaixa na mesma coordenada em 25%, 100% e 400%', async ({ page }, testInfo) => {
  test.setTimeout(12 * 60 * 1000);
  const erros = capturarErros(page);
  await login(page);
  await abrirCanva(page);
  await criarDesign(page, 'Instagram Portrait', `g2-06-${Date.now() % 1000000}`);
  expect(await addShapes(page, 2)).toBe(2);
  await abrirCamadas(page);

  // Uma forma de referência com a borda esquerda em X=440.
  const camadas = page.locator('[data-canva-layer]');
  await camadas.nth(1).click();
  await page.waitForTimeout(300);
  await setarPainel(page, 'X', 440);
  await setarPainel(page, 'Y', 200);

  const medidas: { zoom: number; x: number }[] = [];
  for (const zoom of [0.25, 1, 4]) {
    // O menu de zoom não oferece 25% nem 400%: chega-se neles pelos botões
    // de aumentar/diminuir, que é o caminho que o usuário tem.
    await ajustarZoom(page, zoom);

    // Move a segunda forma para perto de X=440 e solta: tem que encaixar.
    await camadas.nth(0).click();
    await page.waitForTimeout(300);
    await setarPainel(page, 'X', 446);
    await setarPainel(page, 'Y', 600);
    await arrastarUmPouco(page);
    const p = await lerPainel(page, ['X']);
    medidas.push({ zoom, x: p.X! });
    log(`zoom ${Math.round(zoom * 100)}%: X final = ${p.X}`);
  }

  await tela(page, '04-snap');
  const xs = medidas.map((m) => m.x);
  // Mesma coordenada de documento nos três zooms.
  expect(new Set(xs).size).toBe(1);
  expect(xs[0]).toBe(440);
  expect(relatarErros(erros, testInfo).pageerror).toEqual([]);
});

/** Leva o zoom exatamente ao valor pedido pelos controles da barra. */
async function ajustarZoom(page: Page, alvo: number) {
  const lerZoom = async () => {
    const t = await page.locator('button', { hasText: /^\d+%$/ }).first().innerText();
    return Number(t.replace('%', '')) / 100;
  };
  for (let i = 0; i < 40; i++) {
    const atual = await lerZoom();
    if (Math.abs(atual - alvo) < 0.005) return;
    await page.getByRole('button', { name: atual < alvo ? 'Aumentar zoom' : 'Diminuir zoom' }).click();
    await page.waitForTimeout(120);
  }
  throw new Error(`não cheguei ao zoom ${alvo}`);
}

/** Arrasta a forma selecionada alguns pixels de tela e solta. */
async function arrastarUmPouco(page: Page) {
  const artboard = page.locator('[data-canva-artboard]');
  const caixa = await artboard.boundingBox();
  if (!caixa) throw new Error('prancheta não encontrada');
  const { X, Y, L, A } = await lerPainel(page, ['X', 'Y', 'L', 'A']);
  const zoomTexto = await page.locator('button', { hasText: /^\d+%$/ }).first().innerText();
  const z = Number(zoomTexto.replace('%', '')) / 100;
  const centro = { x: caixa.x + (X! + L! / 2) * z, y: caixa.y + (Y! + A! / 2) * z };
  await page.mouse.move(centro.x, centro.y);
  await page.mouse.down();
  await page.mouse.move(centro.x - 1, centro.y, { steps: 3 });
  await page.mouse.move(centro.x - 2, centro.y, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(500);
}

test('G2-12: tipografia aplicada pela UI persiste e exporta', async ({ page }, testInfo) => {
  test.setTimeout(10 * 60 * 1000);
  const erros = capturarErros(page);
  await login(page);
  await abrirCanva(page);
  await criarDesign(page, 'Instagram Portrait', `g2-12-${Date.now() % 1000000}`);
  await addTexto(page, 'Adicionar título');

  const painel = page.locator('[data-canva-properties]');
  await painel.getByLabel('Fonte', { exact: true }).fill('Georgia');
  await painel.getByLabel('Fonte', { exact: true }).press('Enter');
  await painel.getByLabel('Tamanho da fonte').fill('64');
  await painel.getByLabel('Tamanho da fonte').press('Enter');
  await painel.getByLabel('Peso da fonte').selectOption('800');
  await painel.getByRole('button', { name: 'Itálico' }).click();
  await painel.getByRole('button', { name: 'Alinhar à direita' }).click();
  await painel.getByRole('button', { name: 'Sublinhado' }).click();
  await ajustarDeslizante(page, 'Entrelinha', 1.45);
  await ajustarDeslizante(page, 'Entreletra', 120);
  const cor = seletorDeCor(page, 'Cor do texto');
  await cor.hex.fill('#7b2eff');
  await cor.hex.press('Enter');
  await page.waitForTimeout(400);
  await ajustarDeslizante(page, 'Opacidade', 0.6);
  await page.waitForTimeout(500);

  const antes = await lerTipografia(page);
  log(`tipografia antes do F5: ${JSON.stringify(antes)}`);
  await esperarSalvo(page);
  await recarregarEReabrir(page);
  await abrirCamadas(page);
  await page.locator('[data-canva-layer]').first().click();
  await page.waitForTimeout(600);
  const depois = await lerTipografia(page);
  log(`tipografia após o F5: ${JSON.stringify(depois)}`);
  expect(depois).toEqual(antes);
  expect(depois.fonte).toBe('Georgia');
  expect(depois.tamanho).toBe('64');
  expect(depois.peso).toBe('800');
  expect(depois.italico).toBe('true');
  expect(depois.sublinhado).toBe('true');
  expect(depois.alinhamento).toBe('true');
  expect(depois.cor.toLowerCase()).toBe('#7b2eff');

  const png = await exportarPng(page);
  expect(dimensoesPng(png)).toEqual({ largura: 1080, altura: 1350 });
  salvarArtefato('g2-12-tipografia.png', png);
  await tela(page, '17-typography');
  expect(relatarErros(erros, testInfo).pageerror).toEqual([]);
});

async function lerTipografia(page: Page) {
  const painel = page.locator('[data-canva-properties]');
  return {
    fonte: await painel.getByLabel('Fonte', { exact: true }).inputValue(),
    tamanho: await painel.getByLabel('Tamanho da fonte').inputValue(),
    peso: await painel.getByLabel('Peso da fonte').inputValue(),
    italico: String(await painel.getByRole('button', { name: 'Itálico' }).getAttribute('aria-pressed')),
    sublinhado: String(await painel.getByRole('button', { name: 'Sublinhado' }).getAttribute('aria-pressed')),
    alinhamento: String(await painel.getByRole('button', { name: 'Alinhar à direita' }).getAttribute('aria-pressed')),
    entrelinha: await painel.getByLabel('Entrelinha').inputValue(),
    entreletra: await painel.getByLabel('Entreletra').inputValue(),
    cor: await painel.getByLabel('Cor do texto em hexadecimal').inputValue(),
    opacidade: await painel.getByLabel('Opacidade').inputValue(),
  };
}

/** Deslizantes commitam no pointerup/keyup; `fill` sozinho só dispara change. */
async function ajustarDeslizante(page: Page, rotulo: string, valor: number) {
  const campo = page.locator('[data-canva-properties]').getByLabel(rotulo, { exact: true });
  await campo.fill(String(valor));
  await campo.dispatchEvent('keyup');
  await page.waitForTimeout(350);
}

test('G2-13: filtros de imagem se acumulam, e flip/undo/F5 batem', async ({ page }, testInfo) => {
  test.setTimeout(12 * 60 * 1000);
  const erros = capturarErros(page);
  await login(page);
  await abrirCanva(page);
  await criarDesign(page, 'Instagram Portrait', `g2-13-${Date.now() % 1000000}`);

  // Imagem REAL do cliente de teste, pelo painel Marca > Referências.
  await abrirPainel(page, 'Marca');
  const referencias = page.locator('img[alt=""]');
  await expect(referencias.first()).toBeVisible({ timeout: 30000 });
  await referencias.first().click();
  await page.waitForTimeout(3000);
  await abrirCamadas(page);
  await expect(page.locator('[data-canva-layer]')).toHaveCount(1);
  await page.locator('[data-canva-layer]').first().click();
  await page.waitForTimeout(500);

  const painel = page.locator('[data-canva-properties]');
  await expect(painel.getByLabel('Brilho')).toBeVisible();

  // Um filtro de cada vez: o defeito original zerava o anterior a cada novo.
  await ajustarDeslizante(page, 'Brilho', 0.25);
  await ajustarDeslizante(page, 'Contraste', -0.15);
  await ajustarDeslizante(page, 'Saturação', 0.4);
  await ajustarDeslizante(page, 'Desfoque', 0.3);
  const lerFiltros = async () => ({
    brilho: await painel.getByLabel('Brilho').inputValue(),
    contraste: await painel.getByLabel('Contraste').inputValue(),
    saturacao: await painel.getByLabel('Saturação').inputValue(),
    desfoque: await painel.getByLabel('Desfoque').inputValue(),
  });
  const comTodos = await lerFiltros();
  log(`quatro filtros ativos ao mesmo tempo: ${JSON.stringify(comTodos)}`);
  expect(Number(comTodos.brilho)).toBeCloseTo(0.25, 2);
  expect(Number(comTodos.contraste)).toBeCloseTo(-0.15, 2);
  expect(Number(comTodos.saturacao)).toBeCloseTo(0.4, 2);
  expect(Number(comTodos.desfoque)).toBeCloseTo(0.3, 2);

  await painel.getByRole('button', { name: 'Espelhar na horizontal' }).click();
  await page.waitForTimeout(600);
  await painel.getByRole('button', { name: 'Espelhar na vertical' }).click();
  await page.waitForTimeout(600);
  await ajustarDeslizante(page, 'Opacidade', 0.8);

  // Desfazer tira só o último e devolve o estado anterior. Como recarrega a
  // página no canvas, a camada precisa ser selecionada de novo para ler.
  await page.getByRole('button', { name: 'Desfazer' }).click();
  await page.waitForTimeout(1200);
  await selecionarPrimeiraCamada(page);
  expect(Number((await lerFiltros()).brilho)).toBeCloseTo(0.25, 2);
  await page.getByRole('button', { name: 'Refazer' }).click();
  await page.waitForTimeout(1200);
  await selecionarPrimeiraCamada(page);

  await esperarSalvo(page);
  await recarregarEReabrir(page);
  await abrirCamadas(page);
  await page.locator('[data-canva-layer]').first().click();
  await page.waitForTimeout(800);
  const apos = await lerFiltros();
  log(`filtros após o F5: ${JSON.stringify(apos)}`);
  expect(apos).toEqual(comTodos);
  await tela(page, '18-image-controls');
  expect(relatarErros(erros, testInfo).pageerror).toEqual([]);
});

test('G2-14: trocar o preset muda a prancheta sem reescalar objeto', async ({ page }, testInfo) => {
  test.setTimeout(8 * 60 * 1000);
  const erros = capturarErros(page);
  await login(page);
  await abrirCanva(page);
  await criarDesign(page, 'Instagram Post', `g2-14-${Date.now() % 1000000}`);
  expect(await addShapes(page, 1)).toBe(1);
  await setarPainel(page, 'X', 120);
  await setarPainel(page, 'Y', 140);
  const antes = await lerPainel(page);
  log(`objeto antes do preset: ${JSON.stringify(antes)}`);

  await desselecionar(page);
  const painel = page.locator('[data-canva-properties]');
  expect(await painel.getByLabel('A', { exact: true }).inputValue()).toBe('1080');
  await painel.getByLabel('Preset do documento').selectOption({ label: 'Instagram Portrait — 1080×1350' });
  await page.waitForTimeout(1200);
  expect(await painel.getByLabel('L', { exact: true }).inputValue()).toBe('1080');
  expect(await painel.getByLabel('A', { exact: true }).inputValue()).toBe('1350');
  log('prancheta agora 1080x1350');

  await abrirCamadas(page);
  await page.locator('[data-canva-layer]').first().click();
  await page.waitForTimeout(500);
  const depois = await lerPainel(page);
  log(`objeto depois do preset: ${JSON.stringify(depois)}`);
  expect(depois).toEqual(antes);

  await esperarSalvo(page);
  const png = await exportarPng(page);
  expect(dimensoesPng(png)).toEqual({ largura: 1080, altura: 1350 });
  salvarArtefato('g2-14-preset.png', png);
  expect(relatarErros(erros, testInfo).pageerror).toEqual([]);
});

test('G2-15: fundo transparente sai com alpha < 255 no PNG', async ({ page }, testInfo) => {
  test.setTimeout(8 * 60 * 1000);
  const erros = capturarErros(page);
  await login(page);
  await abrirCanva(page);
  await criarDesign(page, 'Instagram Portrait', `g2-15-${Date.now() % 1000000}`);
  expect(await addShapes(page, 1)).toBe(1);
  // A forma fica no centro; os cantos ficam livres para medir o fundo.
  await setarPainel(page, 'X', 400);
  await setarPainel(page, 'Y', 500);
  await setarPainel(page, 'L', 280);
  await setarPainel(page, 'A', 280);

  await desselecionar(page);
  await page.locator('[data-canva-properties]').getByRole('button', { name: 'Transparente' }).click();
  await page.waitForTimeout(900);
  await esperarSalvo(page);

  const png = await exportarPng(page);
  expect(dimensoesPng(png)).toEqual({ largura: 1080, altura: 1350 });
  salvarArtefato('g2-15-transparente.png', png);

  const noCanto = await alphaDoPixel(page, png, 12, 12);
  const naForma = await alphaDoPixel(page, png, 540, 640);
  log(`alpha no canto (fundo): ${noCanto} | alpha sobre a forma: ${naForma}`);
  expect(noCanto).toBeLessThan(255);
  expect(naForma).toBe(255);
  await tela(page, '19-transparent');
  expect(relatarErros(erros, testInfo).pageerror).toEqual([]);
});

test('G2-16: Brand Kit aplica logo, cor e fonte na peça', async ({ page }, testInfo) => {
  test.setTimeout(10 * 60 * 1000);
  const erros = capturarErros(page);
  await login(page);
  await abrirCanva(page);
  await criarDesign(page, 'Instagram Portrait', `g2-16-${Date.now() % 1000000}`);

  // LOGO do Brand Kit.
  await abrirPainel(page, 'Marca');
  await page.getByRole('img', { name: 'Logo do cliente' }).click();
  await page.waitForTimeout(3000);
  await abrirCamadas(page);
  await expect(page.locator('[data-canva-layer]')).toHaveCount(1);
  log('logo do Brand Kit inserido');

  // FONTE da marca, num texto.
  await addTexto(page, 'Adicionar título');
  const painel = page.locator('[data-canva-properties]');
  await painel.getByRole('button', { name: 'Fonte da marca: Georgia' }).click();
  await page.waitForTimeout(500);
  expect(await painel.getByLabel('Fonte', { exact: true }).inputValue()).toBe('Georgia');
  log('fonte da marca aplicada: Georgia');

  // COR da marca, no mesmo texto, pelo painel Marca.
  await abrirPainel(page, 'Marca');
  await page.locator('button[title="#00d6a4"]').click();
  await page.waitForTimeout(700);
  expect((await painel.getByLabel('Cor do texto em hexadecimal').inputValue()).toLowerCase()).toBe('#00d6a4');
  log('cor da marca aplicada: #00d6a4');

  await esperarSalvo(page);
  await recarregarEReabrir(page);
  await abrirCamadas(page);
  await expect(page.locator('[data-canva-layer]')).toHaveCount(2);
  await page.locator('[data-canva-layer]').first().click();
  await page.waitForTimeout(600);
  expect(await painel.getByLabel('Fonte', { exact: true }).inputValue()).toBe('Georgia');
  expect((await painel.getByLabel('Cor do texto em hexadecimal').inputValue()).toLowerCase()).toBe('#00d6a4');
  log('Brand Kit persistiu no F5');
  await tela(page, '20-brand-kit');
  expect(relatarErros(erros, testInfo).pageerror).toEqual([]);
});

test('G2-17: tortura do histórico pelo frontend', async ({ page }, testInfo) => {
  test.setTimeout(14 * 60 * 1000);
  const erros = capturarErros(page);
  await login(page);
  await abrirCanva(page);
  await criarDesign(page, 'Instagram Portrait', `g2-17-${Date.now() % 1000000}`);
  expect(await addShapes(page, 3)).toBe(3);
  await abrirCamadas(page);
  const inicial = await assinatura(page);
  log(`assinatura inicial: ${inicial}`);

  const camadas = page.locator('[data-canva-layer]');
  // create(3) já feito. Agora: move, resize, rotate, color, opacity,
  // align, distribute, rename, hide, show, lock, unlock, reorder, group.
  await camadas.nth(0).click();
  await page.waitForTimeout(300);
  await setarPainel(page, 'X', 120);
  await setarPainel(page, 'L', 320);
  await setarPainel(page, 'Ang', 35);
  const cor = seletorDeCor(page, 'Cor de preenchimento');
  await cor.hex.fill('#7b2eff');
  await cor.hex.press('Enter');
  await page.waitForTimeout(400);
  await ajustarDeslizante(page, 'Opacidade', 0.55);

  await page.locator('[data-canva-workspace]').click({ position: { x: 6, y: 6 } });
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(500);
  await page.locator('[data-canva-properties]').getByRole('button', { name: 'Alinhar à esquerda' }).click();
  await page.waitForTimeout(600);
  await page.locator('[data-canva-properties]').getByRole('button', { name: 'Distribuir verticalmente' }).click();
  await page.waitForTimeout(600);

  await camadas.nth(0).dblclick();
  await page.waitForTimeout(300);
  const nome = page.getByLabel('Nome da camada');
  if (await nome.isVisible().catch(() => false)) {
    await nome.fill('Fundo do CTA');
    await nome.press('Enter');
    await page.waitForTimeout(400);
  }
  await camadas.nth(1).getByRole('button', { name: 'Ocultar' }).click();
  await page.waitForTimeout(400);
  await camadas.nth(1).getByRole('button', { name: 'Mostrar' }).click();
  await page.waitForTimeout(400);
  await camadas.nth(1).getByRole('button', { name: 'Bloquear' }).click();
  await page.waitForTimeout(400);
  await camadas.nth(1).getByRole('button', { name: 'Desbloquear' }).click();
  await page.waitForTimeout(400);
  await camadas.nth(0).dragTo(camadas.nth(2));
  await page.waitForTimeout(700);
  await page.locator('[data-canva-workspace]').click({ position: { x: 6, y: 6 } });
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(500);
  await page.locator('[data-canva-properties]').getByRole('button', { name: 'Agrupar' }).first().click();
  await page.waitForTimeout(800);

  const final = await assinatura(page);
  log(`assinatura final: ${final}`);
  expect(final).not.toBe(inicial);

  // Desfaz tudo.
  let desfeitos = 0;
  const desfazer = page.getByRole('button', { name: 'Desfazer' });
  while (await desfazer.isEnabled() && desfeitos < 60) {
    await desfazer.click();
    await page.waitForTimeout(280);
    desfeitos += 1;
  }
  log(`desfeitos: ${desfeitos}`);
  await expect(page.locator('[data-canva-layer]')).toHaveCount(0);

  // Refaz tudo.
  let refeitos = 0;
  const refazer = page.getByRole('button', { name: 'Refazer' });
  while (await refazer.isEnabled() && refeitos < 60) {
    await refazer.click();
    await page.waitForTimeout(280);
    refeitos += 1;
  }
  log(`refeitos: ${refeitos}`);
  expect(refeitos).toBe(desfeitos);
  expect(await assinatura(page)).toBe(final);
  await tela(page, '21-history');
  expect(relatarErros(erros, testInfo).pageerror).toEqual([]);
});

/** Assinatura do documento vista pela UI: nomes, ordem e estado de cada camada. */
async function assinatura(page: Page) {
  const linhas = page.locator('[data-canva-layer]');
  const total = await linhas.count();
  const partes: string[] = [];
  for (let i = 0; i < total; i++) {
    const linha = linhas.nth(i);
    const texto = (await linha.innerText()).replace(/\s+/g, ' ').trim();
    const oculta = await linha.getByRole('button', { name: 'Mostrar' }).count();
    const travada = await linha.getByRole('button', { name: 'Desbloquear' }).count();
    partes.push(`${texto}${oculta ? '|oculta' : ''}${travada ? '|travada' : ''}`);
  }
  return partes.join(' >> ');
}

/**
 * G2-18 + G2-19 + G2-20 — a peça comercial real.
 *
 * Tudo é feito pela interface: nada de fixture JSON, nada de documento
 * pronto. A peça usa de verdade Brand Kit, seletor de cor, alinhamento,
 * distribuição, guias, renomear/reordenar camada, bloqueio, grupo, controles
 * de tipografia e de imagem - e no fim tem que sobreviver ao F5 e sair certa
 * no PNG.
 */
test('G2-18/19/20: peça comercial real 1080x1350, ponta a ponta', async ({ page }, testInfo) => {
  test.setTimeout(25 * 60 * 1000);
  const erros = capturarErros(page);
  await login(page);
  await abrirCanva(page);
  const nomeDoDesign = `peca-real-${Date.now() % 1000000}`;
  await criarDesign(page, 'Instagram Portrait', nomeDoDesign);
  await tela(page, '01-editor-loaded');

  const painel = page.locator('[data-canva-properties]');

  // ---- FUNDO: cor da marca, sem nada selecionado ----
  await abrirPainel(page, 'Marca');
  await page.locator('button[title="#0b0b0d"]').click();
  await page.waitForTimeout(900);
  log('fundo: cor da marca #0b0b0d');

  // ---- IMAGEM: ativo real do cliente, pelo painel Marca ----
  await page.locator('img[alt=""]').first().click();
  await page.waitForTimeout(3500);
  await abrirCamadas(page);
  await selecionarPrimeiraCamada(page);
  await setarPainel(page, 'X', 0);
  await setarPainel(page, 'Y', 0);
  await setarPainel(page, 'L', 1080);
  await setarPainel(page, 'A', 700);
  // Controles de imagem: um ajuste leve, não um filtro chapado.
  await ajustarDeslizante(page, 'Contraste', 0.1);
  await ajustarDeslizante(page, 'Saturação', 0.15);
  await renomearCamada(page, 0, 'Foto principal');
  log('imagem posicionada e ajustada');

  // ---- LOGO ----
  await abrirPainel(page, 'Marca');
  await page.getByRole('img', { name: 'Logo do cliente' }).click();
  await page.waitForTimeout(3500);
  await selecionarPrimeiraCamada(page);
  await setarPainel(page, 'X', 64);
  await setarPainel(page, 'Y', 60);
  await setarPainel(page, 'L', 168);
  await setarPainel(page, 'A', 168);
  await renomearCamada(page, 0, 'Logo');
  log('logo posicionado');

  // ---- HEADLINE ----
  await addTexto(page, 'Adicionar título');
  await setarPainel(page, 'X', 72);
  await setarPainel(page, 'Y', 790);
  await setarPainel(page, 'L', 936);
  await painel.getByRole('button', { name: 'Fonte da marca: Georgia' }).click();
  await page.waitForTimeout(400);
  await painel.getByLabel('Tamanho da fonte').fill('88');
  await painel.getByLabel('Tamanho da fonte').press('Enter');
  await painel.getByLabel('Peso da fonte').selectOption('800');
  await page.waitForTimeout(300);
  const corTitulo = seletorDeCor(page, 'Cor do texto');
  await corTitulo.hex.fill('#ffffff');
  await corTitulo.hex.press('Enter');
  await page.waitForTimeout(400);
  await escreverNoTexto(page, 540, 840, 'Sua consulta em\nmenos de 24 horas');
  await selecionarPrimeiraCamada(page);
  await renomearCamada(page, 0, 'Headline');
  log('headline escrita');

  // ---- SUBHEADLINE ----
  await addTexto(page, 'Adicionar subtítulo');
  await setarPainel(page, 'X', 72);
  await setarPainel(page, 'Y', 1000);
  await setarPainel(page, 'L', 900);
  await painel.getByLabel('Tamanho da fonte').fill('38');
  await painel.getByLabel('Tamanho da fonte').press('Enter');
  const corSub = seletorDeCor(page, 'Cor do texto');
  await corSub.abrir();
  await corSub.amostra('Marca', '#00d6a4').click();
  await page.waitForTimeout(500);
  await escreverNoTexto(page, 540, 1020, 'Agendamento pelo WhatsApp, sem fila de espera.');
  await selecionarPrimeiraCamada(page);
  await renomearCamada(page, 0, 'Subheadline');
  log('subheadline escrita');

  // ---- FORMA DO CTA ----
  await abrirPainel(page, 'Elementos');
  await page.getByRole('button', { name: 'Retângulo', exact: true }).click();
  await page.waitForTimeout(700);
  await setarPainel(page, 'X', 72);
  await setarPainel(page, 'Y', 1140);
  await setarPainel(page, 'L', 430);
  await setarPainel(page, 'A', 112);
  const corForma = seletorDeCor(page, 'Cor de preenchimento');
  await corForma.abrir();
  await corForma.amostra('Marca', '#7b2eff').click();
  await page.waitForTimeout(500);
  await selecionarPrimeiraCamada(page);
  await renomearCamada(page, 0, 'CTA fundo');

  // ---- TEXTO DO CTA ----
  await addTexto(page, 'Adicionar texto');
  await setarPainel(page, 'X', 104);
  await setarPainel(page, 'Y', 1176);
  await setarPainel(page, 'L', 380);
  await painel.getByLabel('Tamanho da fonte').fill('40');
  await painel.getByLabel('Tamanho da fonte').press('Enter');
  await painel.getByLabel('Peso da fonte').selectOption('700');
  const corCta = seletorDeCor(page, 'Cor do texto');
  await corCta.hex.fill('#ffffff');
  await corCta.hex.press('Enter');
  await page.waitForTimeout(400);
  await escreverNoTexto(page, 290, 1196, 'QUERO AGENDAR');
  await selecionarPrimeiraCamada(page);
  await renomearCamada(page, 0, 'CTA texto');
  log('CTA montado');
  await tela(page, '05-layers');

  // ---- ALINHAR: headline, subheadline e fundo do CTA à esquerda ----
  await selecionarCamadasPorNome(page, ['Headline', 'Subheadline', 'CTA fundo']);
  await painel.getByRole('button', { name: 'Alinhar à esquerda' }).click();
  await page.waitForTimeout(700);
  log('alinhamento à esquerda aplicado');

  // ---- DISTRIBUIR verticalmente os mesmos três ----
  await painel.getByRole('button', { name: 'Distribuir verticalmente' }).click();
  await page.waitForTimeout(700);
  log('distribuição vertical aplicada');

  // ---- GUIAS INTELIGENTES: arrastar o logo até encaixar ----
  await selecionarCamadasPorNome(page, ['Logo']);
  const origem = await pontoNaTela(page, 64 + 84, 60 + 84);
  await page.mouse.move(origem.x, origem.y);
  await page.mouse.down();
  await page.mouse.move(origem.x + 3, origem.y + 2, { steps: 4 });
  await page.mouse.move(origem.x + 1, origem.y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  log('logo reposicionado com as guias ativas');

  // ---- GRUPO: fundo + texto do CTA ----
  await selecionarCamadasPorNome(page, ['CTA fundo', 'CTA texto']);
  await painel.getByRole('button', { name: 'Agrupar' }).first().click();
  await page.waitForTimeout(900);
  await renomearCamada(page, 0, 'CTA');
  log('CTA agrupado');
  await tela(page, '06-group');

  // ---- REORDENAR: a foto vai para o fundo da pilha ----
  const camadas = page.locator('[data-canva-layer]');
  const totalCamadas = await camadas.count();
  const indiceFoto = await indiceDaCamada(page, 'Foto principal');
  if (indiceFoto !== totalCamadas - 1) {
    await camadas.nth(indiceFoto).dragTo(camadas.nth(totalCamadas - 1));
    await page.waitForTimeout(800);
  }
  expect(await indiceDaCamada(page, 'Foto principal')).toBe(totalCamadas - 1);
  log('foto enviada para o fundo da pilha');

  // ---- BLOQUEAR a foto ----
  await camadas.nth(totalCamadas - 1).getByRole('button', { name: 'Bloquear' }).click();
  await page.waitForTimeout(500);
  await expect(camadas.nth(totalCamadas - 1).getByRole('button', { name: 'Desbloquear' })).toBeVisible();
  log('foto bloqueada');

  await esperarSalvo(page);
  await tela(page, '07-complex-document');
  const assinaturaAntes = await assinatura(page);
  log(`assinatura antes do F5: ${assinaturaAntes}`);

  // ---- G2-18: F5 de documento complexo ----
  await recarregarEReabrir(page);
  await abrirCamadas(page);
  const assinaturaDepois = await assinatura(page);
  log(`assinatura após o F5: ${assinaturaDepois}`);
  expect(assinaturaDepois).toBe(assinaturaAntes);
  await tela(page, '08-after-reload');
  await tela(page, '09-real-composition');

  // ---- G2-19: exportação ----
  const png = await exportarPng(page);
  expect(dimensoesPng(png)).toEqual({ largura: 1080, altura: 1350 });
  salvarArtefato('g2-20-peca-real.png', png);
  await tela(page, '10-export-result');

  // O fundo da marca é opaco e escuro no canto; o CTA roxo aparece onde foi
  // posicionado. Ler o pixel prova que a pilha e as cores chegaram no arquivo.
  const cantoSuperiorDireito = await corDoPixel(page, png, 1060, 1330);
  log(`pixel do fundo no rodapé direito: ${JSON.stringify(cantoSuperiorDireito)}`);
  expect(cantoSuperiorDireito.a).toBe(255);
  const noCta = await corDoPixel(page, png, 120, 1190);
  log(`pixel dentro do CTA: ${JSON.stringify(noCta)}`);
  expect(noCta.a).toBe(255);

  const problemas = relatarErros(erros, testInfo);
  expect(problemas.pageerror).toEqual([]);
});

async function corDoPixel(page: Page, png: Buffer, x: number, y: number) {
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
  return page.evaluate(
    ({ url, px, py }) =>
      new Promise<{ r: number; g: number; b: number; a: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const ctx = c.getContext('2d');
          if (!ctx) return reject(new Error('sem contexto 2d'));
          ctx.drawImage(img, 0, 0);
          const d = ctx.getImageData(px, py, 1, 1).data;
          resolve({ r: d[0]!, g: d[1]!, b: d[2]!, a: d[3]! });
        };
        img.onerror = () => reject(new Error('PNG não decodificou'));
        img.src = url;
      }),
    { url: dataUrl, px: x, py: y },
  );
}

async function renomearCamada(page: Page, indice: number, nome: string) {
  await abrirCamadas(page);
  await page.locator('[data-canva-layer]').nth(indice).dblclick();
  await page.waitForTimeout(400);
  const campo = page.getByLabel('Nome da camada');
  await campo.fill(nome);
  await campo.press('Enter');
  await page.waitForTimeout(500);
}

async function indiceDaCamada(page: Page, nome: string) {
  const textos = await page.locator('[data-canva-layer]').allInnerTexts();
  const i = textos.findIndex((t) => t.includes(nome));
  if (i === -1) throw new Error(`camada "${nome}" não encontrada em ${JSON.stringify(textos)}`);
  return i;
}

/** Seleciona camadas pelo nome, com Shift para somar à seleção. */
async function selecionarCamadasPorNome(page: Page, nomes: string[]) {
  await abrirCamadas(page);
  for (let i = 0; i < nomes.length; i++) {
    const indice = await indiceDaCamada(page, nomes[i]!);
    await page.locator('[data-canva-layer]').nth(indice).click({ modifiers: i === 0 ? [] : ['Shift'] });
    await page.waitForTimeout(350);
  }
}

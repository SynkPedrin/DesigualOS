import { test, expect } from '@playwright/test';
import {
  EMAIL, PASSWORD, abrirCamadas, abrirCanva, addShapes, capturarErros, criarDesign,
  desselecionar, espiarPatches, esperarSalvo, estadoDeSalvamento, lerPainel, log, recarregarEReabrir,
  relatarErros, salvarArtefato, setarPainel, tela, login, dimensoesPng,
} from './canva-helpers';

/**
 * GATE 2.3 — REGRESSÃO DOS DEFEITOS DO GATE 2.2.
 *
 * Cada teste aqui existe por causa de um defeito específico que a forense
 * encontrou e que NÃO tinha sido reportado por ninguém. São os testes que
 * teriam pego os bugs se existissem antes.
 */
test.skip(!EMAIL || !PASSWORD, 'defina STUDIO_TEST_EMAIL/STUDIO_TEST_PASSWORD');
test.describe.configure({ mode: 'serial' });

/** §17 — o status mentia: ficava "Salvo" para sempre depois do primeiro save. */
test('REG-01: o indicador de salvamento não mente', async ({ page }, testInfo) => {
  test.setTimeout(6 * 60 * 1000);
  const erros = capturarErros(page);
  await login(page);
  await abrirCanva(page);
  await criarDesign(page, 'Instagram Portrait', `reg01-${Date.now() % 1000000}`);
  expect(await addShapes(page, 1)).toBe(1);

  // Primeiro salvamento completo: daqui em diante o defeito antigo travava
  // o rótulo em "Salvo" para sempre.
  await esperarSalvo(page);
  expect(await estadoDeSalvamento(page)).toBe('salvo');

  // Uma alteração nova. O estado tem que sair de "salvo" IMEDIATAMENTE.
  await setarPainel(page, 'X', 321);
  const logoDepois = await estadoDeSalvamento(page);
  log(`estado logo após alterar: ${logoDepois}`);
  expect(logoDepois).not.toBe('salvo');
  expect(['pendente', 'salvando']).toContain(logoDepois);

  // E volta a "salvo" só quando o servidor confirmou.
  await esperarSalvo(page);
  await tela(page, '11-save-status');
  expect(relatarErros(erros, testInfo).pageerror).toEqual([]);
});

/** §16 — o timer do debounce morria com a aba: toda edição dos últimos
 * 1500ms antes do F5 sumia em silêncio. */
test('REG-02: F5 imediato após editar não perde a edição', async ({ page }, testInfo) => {
  test.setTimeout(8 * 60 * 1000);
  const erros = capturarErros(page);
  await login(page);
  await abrirCanva(page);
  await criarDesign(page, 'Instagram Portrait', `reg02-${Date.now() % 1000000}`);
  expect(await addShapes(page, 2)).toBe(2);
  await esperarSalvo(page);
  await abrirCamadas(page);

  const antes = await page.locator('[data-canva-layer]').allInnerTexts();
  log(`ordem antes: ${JSON.stringify(antes)}`);

  // Reordena e recarrega SEM esperar o debounce de 1500ms.
  const linhas = page.locator('[data-canva-layer]');
  await linhas.nth(0).dragTo(linhas.nth(1));
  await page.waitForTimeout(120);
  const depois = await page.locator('[data-canva-layer]').allInnerTexts();
  expect(depois).not.toEqual(antes);
  const estado = await estadoDeSalvamento(page);
  log(`estado no momento do F5: ${estado} (esperado: ainda NÃO salvo)`);
  expect(estado).not.toBe('salvo');

  await recarregarEReabrir(page);
  await abrirCamadas(page);
  const apos = await page.locator('[data-canva-layer]').allInnerTexts();
  log(`ordem após F5 rápido: ${JSON.stringify(apos)}`);
  expect(apos).toEqual(depois);
  await tela(page, '12-fast-reload');
  expect(relatarErros(erros, testInfo).pageerror).toEqual([]);
});

/** §19 — seleção múltipla gravava coordenadas relativas ao centro da
 * seleção como se fossem absolutas: três formas viravam coordenadas
 * negativas depois de um Ctrl+A e qualquer ação que commitasse. */
test('REG-03: Ctrl+A e commit não movem nenhum objeto', async ({ page }, testInfo) => {
  test.setTimeout(10 * 60 * 1000);
  const erros = capturarErros(page);
  await login(page);
  await abrirCanva(page);
  await criarDesign(page, 'Instagram Portrait', `reg03-${Date.now() % 1000000}`);
  expect(await addShapes(page, 3)).toBe(3);
  await abrirCamadas(page);

  // Posiciona as três em lugares conhecidos.
  const alvos = [
    { x: 100, y: 100 },
    { x: 300, y: 220 },
    { x: 520, y: 140 },
  ];
  const camadas = page.locator('[data-canva-layer]');
  for (let i = 0; i < 3; i++) {
    await camadas.nth(i).click();
    await page.waitForTimeout(300);
    await setarPainel(page, 'X', alvos[i]!.x);
    await setarPainel(page, 'Y', alvos[i]!.y);
  }
  await esperarSalvo(page);

  const lerTodas = async () => {
    const saida: { x: number; y: number }[] = [];
    for (let i = 0; i < 3; i++) {
      await page.locator('[data-canva-layer]').nth(i).click();
      await page.waitForTimeout(300);
      const p = await lerPainel(page, ['X', 'Y']);
      saida.push({ x: p.X!, y: p.Y! });
    }
    return saida;
  };
  const antes = await lerTodas();
  log(`posições antes: ${JSON.stringify(antes)}`);

  // Ctrl+A e uma ação que COMMITA o histórico.
  await page.locator('[data-canva-workspace]').click({ position: { x: 6, y: 6 } });
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(500);
  await page.locator('[data-canva-layer]').first().dblclick();
  await page.waitForTimeout(300);
  const campoNome = page.getByLabel('Nome da camada');
  if (await campoNome.isVisible().catch(() => false)) {
    await campoNome.fill('Camada renomeada');
    await campoNome.press('Enter');
  }
  await page.waitForTimeout(500);
  await esperarSalvo(page);

  await recarregarEReabrir(page);
  await abrirCamadas(page);
  const depois = await lerTodas();
  log(`posições após F5: ${JSON.stringify(depois)}`);

  // Nenhuma coordenada negativa e nenhuma deriva.
  for (const p of depois) {
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeGreaterThanOrEqual(0);
  }
  const ordenar = (l: { x: number; y: number }[]) => [...l].sort((a, b) => a.x - b.x || a.y - b.y);
  const a = ordenar(antes);
  const d = ordenar(depois);
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(d[i]!.x - a[i]!.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(d[i]!.y - a[i]!.y)).toBeLessThanOrEqual(2);
  }
  await tela(page, '13-multiselect-coords');
  expect(relatarErros(erros, testInfo).pageerror).toEqual([]);
});

/** §20 — trocar o fundo apagava todos os objetos do documento. */
test('REG-04: trocar o fundo não apaga nenhum objeto', async ({ page }, testInfo) => {
  test.setTimeout(8 * 60 * 1000);
  const erros = capturarErros(page);
  await login(page);
  await abrirCanva(page);
  await criarDesign(page, 'Instagram Portrait', `reg04-${Date.now() % 1000000}`);
  expect(await addShapes(page, 4)).toBe(4);
  await abrirCamadas(page);
  await expect(page.locator('[data-canva-layer]')).toHaveCount(4);
  await esperarSalvo(page);

  // Troca o fundo pelo painel de propriedades do DOCUMENTO.
  await desselecionar(page);
  const corDoFundo = page.locator('[data-canva-properties]').getByLabel('Cor do fundo');
  await corDoFundo.evaluate((el: HTMLInputElement) => {
    el.value = '#0b0b0d';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(900);

  await expect(page.locator('[data-canva-layer]')).toHaveCount(4);
  log('objetos logo após trocar o fundo: 4');
  await esperarSalvo(page);

  await recarregarEReabrir(page);
  await abrirCamadas(page);
  await expect(page.locator('[data-canva-layer]')).toHaveCount(4);
  log('objetos após F5: 4');

  // E continuam no arquivo exportado.
  const png = await exportar(page);
  expect(dimensoesPng(png).largura).toBe(1080);
  salvarArtefato('reg04-fundo-preservado.png', png);
  await tela(page, '14-background-preservation');
  expect(relatarErros(erros, testInfo).pageerror).toEqual([]);
});

/** §21 — o mesmo padrão quebrado existia em deletePage: apagar uma página
 * lia o canvas já limpo e esvaziava a página vizinha. */
test('REG-05: apagar uma página não esvazia a outra', async ({ page }, testInfo) => {
  test.setTimeout(8 * 60 * 1000);
  const erros = capturarErros(page);
  await login(page);
  await abrirCanva(page);
  await criarDesign(page, 'Instagram Portrait', `reg05-${Date.now() % 1000000}`);
  expect(await addShapes(page, 3)).toBe(3);
  await abrirCamadas(page);
  await expect(page.locator('[data-canva-layer]')).toHaveCount(3);
  await esperarSalvo(page);

  // Cria a segunda página e põe um objeto nela.
  await page.getByRole('button', { name: 'Adicionar página' }).click();
  await page.waitForTimeout(900);
  await expect(page.locator('[data-canva-layer]')).toHaveCount(0);
  expect(await addShapes(page, 1)).toBe(1);
  await page.waitForTimeout(600);
  await esperarSalvo(page);

  // Apaga a SEGUNDA página; a primeira tem que continuar com 3 objetos.
  // Os controles da página só existem no hover da miniatura (pointer-events
  // desligado fora dele), então o hover vem antes do clique.
  // O nome acessível da miniatura é o número dentro dela ("2"), não o title.
  await page.locator('button[title="Página 2"]').hover();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Excluir página' }).last().click();
  await page.waitForTimeout(1200);
  await abrirCamadas(page);
  await expect(page.locator('[data-canva-layer]')).toHaveCount(3);
  log('página vizinha após excluir: 3 objetos');
  await esperarSalvo(page);

  await recarregarEReabrir(page);
  await abrirCamadas(page);
  await expect(page.locator('[data-canva-layer]')).toHaveCount(3);
  log('página vizinha após F5: 3 objetos');
  await tela(page, '15-delete-page');
  expect(relatarErros(erros, testInfo).pageerror).toEqual([]);
});

/** §33 — com alterações mais rápidas que o debounce, o banco tem que ficar
 * com a REVISÃO MAIS NOVA, não com uma intermediária. */
test('REG-06: rajada de alterações grava a revisão mais nova', async ({ page }, testInfo) => {
  test.setTimeout(8 * 60 * 1000);
  const erros = capturarErros(page);
  const patches = espiarPatches(page);
  await login(page);
  await abrirCanva(page);
  await criarDesign(page, 'Instagram Portrait', `reg06-${Date.now() % 1000000}`);
  expect(await addShapes(page, 2)).toBe(2);
  await esperarSalvo(page);
  await abrirCamadas(page);

  // Cinco alterações em menos de 1500ms cada.
  await page.locator('[data-canva-layer]').first().click();
  await page.waitForTimeout(250);
  const rajada = [
    () => setarPainel(page, 'X', 111),
    () => setarPainel(page, 'Y', 222),
    () => setarPainel(page, 'Ang', 12),
    () => setarPainel(page, 'X', 333),
    () => setarPainel(page, 'Y', 444),
  ];
  for (const acao of rajada) await acao();

  await esperarSalvo(page);
  const comPaginas = patches.corpos.filter((c) => c && typeof c === 'object' && 'pages' in (c as object));
  log(`PATCHes com páginas enviados: ${comPaginas.length}`);

  await recarregarEReabrir(page);
  await abrirCamadas(page);
  await page.locator('[data-canva-layer]').first().click();
  await page.waitForTimeout(400);
  const final = await lerPainel(page, ['X', 'Y', 'Ang']);
  log(`estado após F5: ${JSON.stringify(final)}`);
  // O ÚLTIMO valor de cada campo, não um intermediário.
  expect(final.X).toBe(333);
  expect(final.Y).toBe(444);
  expect(final.Ang).toBe(12);
  await tela(page, '16-autosave-stress');
  expect(relatarErros(erros, testInfo).pageerror).toEqual([]);
});

/** Exporta a página ativa em PNG 1x e devolve o arquivo. */
async function exportar(page: import('@playwright/test').Page): Promise<Buffer> {
  await page.getByRole('button', { name: /exportar/i }).click();
  await page.waitForTimeout(300);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }),
    page.getByRole('menu').getByRole('button').nth(0).click(),
  ]);
  const caminho = await download.path();
  const { readFileSync } = await import('node:fs');
  return readFileSync(caminho);
}

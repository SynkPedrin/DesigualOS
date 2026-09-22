import { test, expect, type Page } from '@playwright/test';
import {
  EMAIL, PASSWORD, abrirCamadas, abrirCanva, abrirPainel, capturarErros, criarDesign,
  esperarSalvo, log, pontoNaTela, relatarErros, tela, login,
} from './canva-helpers';

/**
 * ESCALA — 100 objetos no NAVEGADOR (Gate 2.3, §32).
 *
 * O Gate 2.2 mediu o custo da lógica em jsdom. Aqui o canvas é real: o que
 * está em jogo é se o editor continua usável, não um número de fps.
 */
test.skip(!EMAIL || !PASSWORD, 'defina STUDIO_TEST_EMAIL/STUDIO_TEST_PASSWORD');

const TOTAL = 100;

/** Instala um observador de long tasks (>50ms bloqueando a thread principal). */
async function observarTravadas(page: Page) {
  await page.evaluate(() => {
    const janela = window as unknown as { __longTasks?: number[] };
    janela.__longTasks = [];
    try {
      new PerformanceObserver((lista) => {
        for (const e of lista.getEntries()) janela.__longTasks!.push(Math.round(e.duration));
      }).observe({ entryTypes: ['longtask'] });
    } catch {
      /* navegador sem a API: o teste segue sem esse dado */
    }
  });
}

async function lerTravadas(page: Page) {
  return page.evaluate(() => {
    const janela = window as unknown as { __longTasks?: number[] };
    const t = janela.__longTasks ?? [];
    janela.__longTasks = [];
    return { quantidade: t.length, maior: t.length ? Math.max(...t) : 0, soma: t.reduce((a, b) => a + b, 0) };
  });
}

async function cronometrar(rotulo: string, f: () => Promise<void>) {
  const t0 = Date.now();
  await f();
  const ms = Date.now() - t0;
  log(`${rotulo.padEnd(34)}: ${ms}ms`);
  return ms;
}

test('ESCALA: 100 objetos no canvas real continuam usáveis', async ({ page }, testInfo) => {
  test.setTimeout(25 * 60 * 1000);
  const erros = capturarErros(page);
  await login(page);
  await abrirCanva(page);
  await criarDesign(page, 'Instagram Portrait', `escala-${Date.now() % 1000000}`);
  await abrirPainel(page, 'Elementos');

  const formas = ['Retângulo', 'Elipse', 'Triângulo', 'Estrela'];
  const criar = await cronometrar(`criar ${TOTAL} objetos`, async () => {
    for (let i = 0; i < TOTAL; i++) {
      await page.getByRole('button', { name: formas[i % formas.length]!, exact: true }).click();
      await page.waitForTimeout(90);
    }
  });
  await page.waitForTimeout(1500);
  await abrirCamadas(page);
  await expect(page.locator('[data-canva-layer]')).toHaveCount(TOTAL, { timeout: 60000 });
  log(`média por objeto na criação: ${Math.round(criar / TOTAL)}ms`);

  await observarTravadas(page);

  const zoom = await cronometrar('10 passos de zoom', async () => {
    for (let i = 0; i < 5; i++) {
      await page.getByRole('button', { name: 'Aumentar zoom' }).click();
      await page.waitForTimeout(60);
    }
    for (let i = 0; i < 5; i++) {
      await page.getByRole('button', { name: 'Diminuir zoom' }).click();
      await page.waitForTimeout(60);
    }
  });
  log(`travadas no zoom: ${JSON.stringify(await lerTravadas(page))}`);

  const pan = await cronometrar('pan com a barra de espaço', async () => {
    const p = await pontoNaTela(page, 540, 600);
    await page.keyboard.down('Space');
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    for (let i = 0; i < 20; i++) await page.mouse.move(p.x + i * 4, p.y + i * 2);
    await page.mouse.up();
    await page.keyboard.up('Space');
  });

  const selecionar = await cronometrar('selecionar tudo', async () => {
    await page.locator('[data-canva-workspace]').click({ position: { x: 6, y: 6 } });
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(600);
  });
  log(`travadas ao selecionar tudo: ${JSON.stringify(await lerTravadas(page))}`);

  // Arrasto longo com guias ativas: é onde o cálculo de encaixe pode explodir.
  await page.locator('[data-canva-layer]').first().click();
  await page.waitForTimeout(400);
  await observarTravadas(page);
  const arrastar = await cronometrar('arrastar ~4s com guias ativas', async () => {
    const p = await pontoNaTela(page, 540, 600);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    for (let i = 0; i < 80; i++) {
      await page.mouse.move(p.x + Math.sin(i / 6) * 90, p.y + Math.cos(i / 7) * 70);
      await page.waitForTimeout(45);
    }
    await page.mouse.up();
  });
  const travadasArrasto = await lerTravadas(page);
  log(`travadas no arrasto: ${JSON.stringify(travadasArrasto)}`);

  const rolar = await cronometrar('rolar a lista de camadas', async () => {
    const lista = page.locator('[data-canva-layer]').first();
    await lista.scrollIntoViewIfNeeded();
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(60);
    }
  });

  const reordenar = await cronometrar('reordenar camada (99 -> 0)', async () => {
    const camadas = page.locator('[data-canva-layer]');
    await camadas.nth(TOTAL - 1).scrollIntoViewIfNeeded();
    await camadas.nth(TOTAL - 1).dragTo(camadas.nth(0));
    await page.waitForTimeout(900);
  });

  await esperarSalvo(page);
  await expect(page.locator('[data-canva-layer]')).toHaveCount(TOTAL);
  await tela(page, '22-cem-objetos');

  log(`RESUMO 100 objetos -> zoom ${zoom}ms | pan ${pan}ms | selecionar ${selecionar}ms | arrastar ${arrastar}ms | rolar ${rolar}ms | reordenar ${reordenar}ms`);

  // Tetos folgados: o objetivo é pegar "editor inutilizável", não perseguir fps.
  expect(zoom).toBeLessThan(15000);
  expect(selecionar).toBeLessThan(15000);
  expect(reordenar).toBeLessThan(20000);
  // O arrasto leva ~3,6s só de movimentos programados; o que não pode é a
  // thread principal ficar parada por mais de meio segundo de uma vez.
  expect(travadasArrasto.maior).toBeLessThan(500);

  expect(relatarErros(erros, testInfo).pageerror).toEqual([]);
});

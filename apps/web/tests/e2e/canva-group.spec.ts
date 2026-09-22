import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * G2-11/12 — GROUP/UNGROUP com transformação, persistência e histórico.
 *
 * O risco estrutural aqui é um só: agrupar, TRANSFORMAR o grupo (mover,
 * escalar, girar) e depois desagrupar pode jogar os filhos para outro lugar,
 * porque cada um passa a viver no espaço local do grupo. Se a matriz não for
 * aplicada de volta, o desagrupamento "explode" a composição.
 *
 * A verificação aqui é VISUAL de propósito. Comparar X/Y/W/H de cada filho
 * exigiria reproduzir no teste a mesma matemática de matriz que está sendo
 * testada — se ela estiver errada nos dois lugares, o teste passa e a peça
 * sai torta. Duas exportações e a diferença de pixels entre elas não dependem
 * de nenhuma conta minha: ou a arte continua igual, ou não continua.
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
  await select.selectOption({ label: CLIENTE });
}

async function criarDesign(page: Page, nome: string) {
  await page.getByRole('button', { name: /novo design/i }).first().click();
  await page.getByRole('button', { name: 'Criar design' }).waitFor({ state: 'visible', timeout: 20000 });
  await page.getByRole('button').filter({ hasText: 'Instagram Portrait' }).first().click();
  await page.locator('input:not([type])').first().fill(nome);
  await page.getByRole('button', { name: 'Criar design' }).click();
  await page.getByRole('button', { name: /exportar/i }).waitFor({ state: 'visible', timeout: 90000 });
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

async function addShape(page: Page, nome: string) {
  const b = page.getByRole('button', { name: nome, exact: true }).first();
  if (!(await b.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Elementos' }).first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
  await page.getByRole('button', { name: nome, exact: true }).first().click();
  await page.waitForTimeout(450);
}

/** Escreve num campo do painel de propriedades e confirma. */
async function definir(page: Page, rotulo: string, valor: number) {
  const campo = page.getByLabel(rotulo, { exact: true }).first();
  if (!(await campo.isVisible().catch(() => false))) return false;
  await campo.fill(String(valor));
  await campo.press('Enter');
  await page.waitForTimeout(250);
  return true;
}

async function exportarPNG(page: Page, destino: string): Promise<Buffer> {
  await page.getByRole('button', { name: /exportar/i }).click();
  await page.waitForTimeout(300);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }),
    page.getByRole('menu').getByRole('button').nth(0).click(),
  ]);
  await download.saveAs(destino);
  return readFileSync(destino);
}

/**
 * Diferença média por pixel entre dois PNGs, de 0 (idênticos) a 255.
 *
 * A decodificação acontece DENTRO do navegador porque é lá que existe um
 * decodificador de PNG confiável — não vale a pena trazer dependência nova
 * para um teste. O canal alfa entra na conta: um filho que suma deixa
 * transparência onde havia tinta.
 */
async function diferencaMedia(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.evaluate(
    async ([umaB64, outraB64]) => {
      const carregar = (b64: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = `data:image/png;base64,${b64}`;
        });
      const [ia, ib] = await Promise.all([carregar(umaB64!), carregar(outraB64!)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return 255;
      const pixels = (img: HTMLImageElement) => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        c.getContext('2d')!.drawImage(img, 0, 0);
        return c.getContext('2d')!.getImageData(0, 0, img.width, img.height).data;
      };
      const pa = pixels(ia);
      const pb = pixels(ib);
      let soma = 0;
      for (let i = 0; i < pa.length; i++) soma += Math.abs(pa[i]! - pb[i]!);
      return soma / pa.length;
    },
    [a.toString('base64'), b.toString('base64')],
  );
}

/**
 * Laço de seleção cobrindo a artboard inteira — é como o usuário seleciona
 * vários objetos, e não depende de acertar a posição de cada forma na tela
 * (que muda com zoom e pan).
 */
async function selecionarTudoComLaco(page: Page) {
  const canvas = page.locator('canvas').last();
  const cx = await canvas.boundingBox();
  if (!cx) throw new Error('artboard não encontrada');
  await page.mouse.move(cx.x + 4, cx.y + 4);
  await page.mouse.down();
  await page.mouse.move(cx.x + cx.width - 4, cx.y + cx.height - 4, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(600);
}

test('G2-11/12: grupo transformado sobrevive ao F5 e desagrupa sem mover a arte', async ({ page }, testInfo) => {
  test.setTimeout(15 * 60 * 1000);
  await login(page);
  await abrirCanva(page);
  await criarDesign(page, `g2-group-${Date.now() % 1000000}`);

  // TRÊS elementos com posição, tamanho e rotação DIFERENTES — é a diferença
  // entre eles que faz uma matriz errada aparecer.
  await addShape(page, 'Retângulo');
  await definir(page, 'X', 120);
  await definir(page, 'Y', 200);
  await definir(page, 'Largura', 300);
  await definir(page, 'Altura', 180);
  await definir(page, 'Rotação', 15);

  await addShape(page, 'Elipse');
  await definir(page, 'X', 420);
  await definir(page, 'Y', 520);
  await definir(page, 'Largura', 220);
  await definir(page, 'Altura', 220);
  await definir(page, 'Rotação', 0);

  await addShape(page, 'Triângulo');
  await definir(page, 'X', 200);
  await definir(page, 'Y', 800);
  await definir(page, 'Largura', 260);
  await definir(page, 'Altura', 240);
  await definir(page, 'Rotação', 40);

  await abrirCamadas(page);
  const antesDeAgrupar = await page.locator('[data-canva-layer]').count();
  expect(antesDeAgrupar).toBe(3);

  // AGRUPAR. O editor não tem atalho de teclado para isto (conferido em
  // use-canva-editor.ts: só desfazer/refazer e setas), então o caminho é o
  // mesmo do usuário — laço de seleção na artboard e o botão da barra
  // flutuante, que só aparece com seleção múltipla.
  await selecionarTudoComLaco(page);
  await page.getByRole('button', { name: 'Agrupar' }).first().click({ timeout: 15000 });
  await page.waitForTimeout(700);
  await abrirCamadas(page);
  const depoisDeAgrupar = await page.locator('[data-canva-layer]').count();
  log(`camadas: ${antesDeAgrupar} -> ${depoisDeAgrupar} apos agrupar`);
  expect(depoisDeAgrupar, 'os três viraram UM grupo').toBe(1);

  // TRANSFORMAR o grupo: mover, escalar e girar.
  await definir(page, 'X', 260);
  await definir(page, 'Y', 340);
  await definir(page, 'Rotação', 12);
  await page.waitForTimeout(500);

  // A arte, como está AGORA (grupo transformado, antes de qualquer F5).
  const antesDoF5 = await exportarPNG(page, testInfo.outputPath('grupo-antes-f5.png'));
  log(`export com grupo: ${antesDoF5.readUInt32BE(16)}x${antesDoF5.readUInt32BE(20)}`);

  // SALVAR e recarregar de verdade.
  await expect(page.getByText(/salvo/i).first()).toBeVisible({ timeout: 30000 });
  await page.reload();
  await abrirCanva(page);
  await page.locator('[data-canva-doc]').first().click({ timeout: 45000 });
  await page.getByRole('button', { name: /exportar/i }).waitFor({ state: 'visible', timeout: 90000 });
  await page.waitForTimeout(1500);

  // G2-11: continua sendo UM grupo, não três objetos soltos nem um desenho achatado.
  await abrirCamadas(page);
  const depoisDoF5 = await page.locator('[data-canva-layer]').count();
  log(`camadas apos F5: ${depoisDoF5}`);
  expect(depoisDoF5, 'o grupo persistiu como grupo').toBe(1);

  const depoisDoF5Png = await exportarPNG(page, testInfo.outputPath('grupo-depois-f5.png'));
  const difF5 = await diferencaMedia(page, antesDoF5, depoisDoF5Png);
  log(`diferenca media apos F5: ${difF5.toFixed(3)}`);
  expect(difF5, 'o F5 não mexeu na arte').toBeLessThan(2);

  // DESAGRUPAR e conferir que a arte não andou.
  await page.locator('[data-canva-layer]').first().click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Desagrupar' }).first().click({ timeout: 15000 });
  await page.waitForTimeout(800);
  await abrirCamadas(page);
  const depoisDeDesagrupar = await page.locator('[data-canva-layer]').count();
  log(`camadas apos desagrupar: ${depoisDeDesagrupar}`);
  expect(depoisDeDesagrupar, 'voltaram os três filhos').toBe(3);

  const desagrupado = await exportarPNG(page, testInfo.outputPath('grupo-desagrupado.png'));
  const difUngroup = await diferencaMedia(page, depoisDoF5Png, desagrupado);
  log(`diferenca media apos desagrupar: ${difUngroup.toFixed(3)}`);
  // ESTE é o teste do enunciado: cada filho no MESMO lugar visual de antes.
  expect(difUngroup, 'desagrupar não pode mover a arte').toBeLessThan(2);
});

/**
 * O CONTRASTE que isola a causa.
 *
 * Se desagrupar funciona na mesma sessão e só quebra DEPOIS de um
 * recarregamento, o defeito não está em `ungroupSelected` — está no que o
 * grupo perde ao ser serializado e reconstruído. Sem este par, a conclusão
 * seria chute.
 */
test('G2-11b: desagrupar na MESMA sessão devolve os filhos', async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);
  await login(page);
  await abrirCanva(page);
  await criarDesign(page, `g2-group-mesma-${Date.now() % 1000000}`);

  await addShape(page, 'Retângulo');
  await definir(page, 'X', 150);
  await definir(page, 'Y', 250);
  await addShape(page, 'Elipse');
  await definir(page, 'X', 450);
  await definir(page, 'Y', 600);

  await abrirCamadas(page);
  expect(await page.locator('[data-canva-layer]').count()).toBe(2);

  await selecionarTudoComLaco(page);
  await page.getByRole('button', { name: 'Agrupar' }).first().click({ timeout: 15000 });
  await page.waitForTimeout(700);
  await abrirCamadas(page);
  expect(await page.locator('[data-canva-layer]').count(), 'agrupou').toBe(1);

  // SEM F5 no meio.
  await page.locator('[data-canva-layer]').first().click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Desagrupar' }).first().click({ timeout: 15000 });
  await page.waitForTimeout(800);
  await abrirCamadas(page);
  const depois = await page.locator('[data-canva-layer]').count();
  log(`camadas apos desagrupar SEM F5: ${depois}`);
  expect(depois, 'desagrupar na mesma sessão devolve os filhos').toBe(2);
});

import { expect, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EMAIL = process.env.STUDIO_TEST_EMAIL ?? '';
export const PASSWORD = process.env.STUDIO_TEST_PASSWORD ?? '';
export const CLIENTE = process.env.STUDIO_TEST_CLIENT ?? 'Clinica Teste Fase 7';

export const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

/** Onde vão screenshots e PNGs exportados. Fora do código de produção e fora do Git. */
export const ARTEFATOS = resolve(dirname(fileURLToPath(import.meta.url)), 'artifacts/canva-gate2');

export async function tela(page: Page, nome: string) {
  const destino = `${ARTEFATOS}/${nome}.png`;
  mkdirSync(dirname(destino), { recursive: true });
  await page.screenshot({ path: destino, fullPage: false });
  log(`screenshot: ${nome}.png`);
  return destino;
}

export function salvarArtefato(nome: string, dados: Buffer) {
  const destino = `${ARTEFATOS}/${nome}`;
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, dados);
  log(`artefato: ${nome} (${dados.length} bytes)`);
  return destino;
}

/** Login pelo FORMULÁRIO real - sem cookie injetado, sem token montado à mão. */
export async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45000 });
}

export async function abrirCanva(page: Page) {
  await page.goto('/studio');
  await page.getByRole('button', { name: /novo projeto/i }).waitFor({ state: 'visible', timeout: 45000 });
  await page.getByRole('button', { name: /^canva$/i }).first().click();
  const select = page.getByLabel('Cliente');
  await select.waitFor({ state: 'visible', timeout: 30000 });
  await expect(select.locator('option', { hasText: CLIENTE })).toHaveCount(1, { timeout: 60000 });
  await select.selectOption({ label: CLIENTE });
}

export async function criarDesign(page: Page, preset: string, nome: string) {
  await page.getByRole('button', { name: /novo design/i }).first().click();
  await page.getByRole('button', { name: 'Criar design' }).waitFor({ state: 'visible', timeout: 20000 });
  await page.getByRole('button').filter({ hasText: preset }).first().click();
  await page.locator('input:not([type])').first().fill(nome);
  await page.getByRole('button', { name: 'Criar design' }).click();
  await page.getByRole('button', { name: /exportar/i }).waitFor({ state: 'visible', timeout: 90000 });
}

const FORMAS = ['Retângulo', 'Elipse', 'Triângulo', 'Estrela'];

export async function addShapes(page: Page, n: number): Promise<number> {
  const primeira = page.getByRole('button', { name: 'Retângulo', exact: true }).first();
  if (!(await primeira.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Elementos' }).first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
  let feitas = 0;
  for (let i = 0; i < n; i++) {
    const b = page.getByRole('button', { name: FORMAS[i % FORMAS.length]!, exact: true }).first();
    if (!(await b.isVisible().catch(() => false))) break;
    await b.click();
    await page.waitForTimeout(400);
    feitas += 1;
  }
  return feitas;
}

export async function abrirCamadas(page: Page) {
  if ((await page.locator('[data-canva-layer]').count()) === 0) {
    await page.getByRole('button', { name: 'Camadas' }).first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
}

export async function abrirPainel(page: Page, nome: string) {
  await page.getByRole('button', { name: nome, exact: true }).first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
}

/**
 * Espera o documento estar GRAVADO de verdade.
 *
 * Casar por texto (`/salvo/i`) não serve: "Salvo" e "Não salvo" compartilham
 * a palavra, e o teste passava com alteração ainda pendente - foi assim que o
 * Gate 2.1 recarregou no meio do debounce de 1500ms e concluiu que o reorder
 * "não persistia". O estado vem como dado.
 */
export async function esperarSalvo(page: Page) {
  await expect(page.locator('[data-canva-save-status="salvo"]')).toBeVisible({ timeout: 45000 });
}

export function estadoDeSalvamento(page: Page) {
  return page.locator('[data-canva-save-status]').getAttribute('data-canva-save-status');
}

/** F5 e reabre o MESMO documento (a URL do Studio não carrega o doc sozinha). */
export async function recarregarEReabrir(page: Page) {
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await abrirCanva(page);
  await page.locator('[data-canva-doc]').first().click({ timeout: 45000 });
  await page.getByRole('button', { name: /exportar/i }).waitFor({ state: 'visible', timeout: 90000 });
  await page.waitForTimeout(1500);
}

export interface Erros {
  pageerror: string[];
  consoleError: string[];
  requisicoesFalhas: string[];
}

/** §36: nada de erro silencioso. */
export function capturarErros(page: Page): Erros {
  const e: Erros = { pageerror: [], consoleError: [], requisicoesFalhas: [] };
  page.on('pageerror', (err) => e.pageerror.push(String(err.message ?? err)));
  page.on('console', (msg) => { if (msg.type() === 'error') e.consoleError.push(msg.text()); });
  page.on('response', (r) => { if (r.status() >= 400) e.requisicoesFalhas.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
  return e;
}

/** Erros que não são do produto (extensão, favicon, ruído de dev server). */
const RUIDO = [/favicon/i, /Download the React DevTools/i, /\[Fast Refresh\]/i, /ResizeObserver loop/i];

export function relatarErros(erros: Erros, testInfo: TestInfo) {
  const relevantes = {
    pageerror: erros.pageerror.filter((m) => !RUIDO.some((r) => r.test(m))),
    consoleError: erros.consoleError.filter((m) => !RUIDO.some((r) => r.test(m))),
    requisicoesFalhas: erros.requisicoesFalhas.filter((m) => !RUIDO.some((r) => r.test(m))),
  };
  const total = relevantes.pageerror.length + relevantes.consoleError.length + relevantes.requisicoesFalhas.length;
  log(`[${testInfo.title}] erros de navegador relevantes: ${total}${total ? ` -> ${JSON.stringify(relevantes)}` : ''}`);
  return relevantes;
}

/** Corpos de todo PATCH de documento que saiu do navegador, na ordem. */
export function espiarPatches(page: Page): { corpos: unknown[]; comKeepalive: number } {
  const registro = { corpos: [] as unknown[], comKeepalive: 0 };
  page.on('request', (req) => {
    if (req.method() !== 'PATCH' || !req.url().includes('/studio/canvas-documents/')) return;
    try {
      registro.corpos.push(JSON.parse(req.postData() ?? '{}'));
    } catch {
      registro.corpos.push(null);
    }
  });
  return registro;
}

/** Caixa de um objeto lida do painel de propriedades (coordenadas de documento). */
export async function lerPainel(page: Page, campos: string[] = ['X', 'Y', 'L', 'A', 'Ang']) {
  const painel = page.locator('[data-canva-properties]');
  const saida: Record<string, number> = {};
  for (const c of campos) saida[c] = Number(await painel.getByLabel(c, { exact: true }).inputValue());
  return saida;
}

export async function setarPainel(page: Page, label: string, valor: number) {
  const campo = page.locator('[data-canva-properties]').getByLabel(label, { exact: true });
  await campo.fill(String(valor));
  await campo.press('Enter');
  await page.waitForTimeout(350);
}

/** Lê largura/altura de um PNG direto do cabeçalho IHDR. */
export function dimensoesPng(buf: Buffer) {
  return { largura: buf.readUInt32BE(16), altura: buf.readUInt32BE(20) };
}

/**
 * Tira a seleção clicando num ponto VAZIO da prancheta.
 *
 * Não existe atalho de teclado para desselecionar, e clicar fora da
 * prancheta não chega ao Fabric. As formas padrão nascem centralizadas, então
 * os cantos servem. O painel da direita passa a mostrar "Documento" - é assim
 * que o teste sabe que deu certo.
 */
export async function desselecionar(page: Page) {
  const artboard = page.locator('[data-canva-artboard]');
  const caixa = await artboard.boundingBox();
  if (!caixa) throw new Error('prancheta não encontrada');
  const cantos = [
    { x: 8, y: 8 },
    { x: caixa.width - 8, y: 8 },
    { x: 8, y: caixa.height - 8 },
  ];
  for (const ponto of cantos) {
    await artboard.click({ position: ponto, force: true });
    await page.waitForTimeout(350);
    // `innerText` devolve o texto JÁ com o text-transform do CSS aplicado,
    // então o cabeçalho chega como "DOCUMENTO". Comparar sem caixa.
    const titulo = await page.locator('[data-canva-properties] p').first().innerText();
    if (titulo.trim().toLowerCase() === 'documento') return;
  }
  throw new Error('não consegui desselecionar: o painel não voltou para "Documento"');
}

/**
 * Lê o alpha de um pixel do PNG usando o decodificador do PRÓPRIO navegador.
 *
 * Escrever um decodificador de PNG só para o teste seria inventar uma
 * segunda implementação para conferir a primeira. O navegador que exportou o
 * arquivo é quem sabe lê-lo.
 */
export async function alphaDoPixel(page: Page, png: Buffer, x: number, y: number): Promise<number> {
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
  return page.evaluate(
    ({ url, px, py }) =>
      new Promise<number>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const ctx = c.getContext('2d');
          if (!ctx) return reject(new Error('sem contexto 2d'));
          ctx.drawImage(img, 0, 0);
          resolve(ctx.getImageData(px, py, 1, 1).data[3]!);
        };
        img.onerror = () => reject(new Error('PNG não decodificou'));
        img.src = url;
      }),
    { url: dataUrl, px: x, py: y },
  );
}

/** Insere um texto pelo painel "Texto". */
export async function addTexto(page: Page, tipo: 'Adicionar título' | 'Adicionar subtítulo' | 'Adicionar texto') {
  await abrirPainel(page, 'Texto');
  await page.getByRole('button', { name: tipo, exact: true }).click();
  await page.waitForTimeout(700);
}

/** Converte coordenadas de DOCUMENTO em coordenadas de tela. */
export async function pontoNaTela(page: Page, x: number, y: number) {
  const caixa = await page.locator('[data-canva-artboard]').boundingBox();
  if (!caixa) throw new Error('prancheta não encontrada');
  const texto = await page.locator('button', { hasText: /^\d+%$/ }).first().innerText();
  const z = Number(texto.replace('%', '')) / 100;
  return { x: caixa.x + x * z, y: caixa.y + y * z };
}

/**
 * Escreve o conteúdo do texto selecionado pelo caminho do usuário: duplo
 * clique entra em edição no próprio canvas (Textbox do Fabric), Ctrl+A e
 * digita. Não existe campo de conteúdo no painel - é assim que se edita.
 */
export async function escreverNoTexto(page: Page, xDoc: number, yDoc: number, conteudo: string) {
  const p = await pontoNaTela(page, xDoc, yDoc);
  await page.mouse.dblclick(p.x, p.y);
  await page.waitForTimeout(600);
  await page.keyboard.press('Control+a');
  await page.keyboard.type(conteudo, { delay: 12 });
  await page.waitForTimeout(300);
  // Sai da edição clicando fora da caixa.
  const fora = await pontoNaTela(page, 1040, 20);
  await page.mouse.click(fora.x, fora.y);
  await page.waitForTimeout(600);
}

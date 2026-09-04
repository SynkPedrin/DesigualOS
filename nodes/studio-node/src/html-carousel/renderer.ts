import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

export const CAROUSEL_CARD_WIDTH = 1080;
export const CAROUSEL_CARD_HEIGHT = 1350;

export type CardLayout = 'capa' | 'premissa' | 'item' | 'follow' | 'golpe' | 'diptico' | 'tese' | 'cta';

export interface CardData {
  layout: CardLayout;
  /** Space Mono, uppercase, lima, topo do card (ex: nome da música · artista · ano). */
  kicker?: string | undefined;
  /** Caixa mista; `*trecho*` vira destaque lima (na headline) ou roxo-muted (no subtext). */
  headline: string;
  subtext?: string | undefined;
  /** Cor semântica da tag: LIMA pra VERSO, ROXA pra SEGREDO. */
  tag?: 'verso' | 'segredo' | null | undefined;
  tagLabel?: string | undefined;
  /** URL ou path local do frame do filme; null/undefined = fundo ink. */
  frame?: string | null | undefined;
  page: number;
  totalPages: number;
}

export interface CarouselMeta {
  seriesName?: string | undefined;
  footerText?: string | undefined;
}

const currentDir = dirname(fileURLToPath(import.meta.url));

// O template é asset, não TS: tsc não copia .html pro dist/. Resolvendo a
// partir da raiz do pacote (currentDir/../.. vale tanto pra src/ quanto pra
// dist/) o caminho funciona nos dois modos de execução (tsx e node dist).
const TEMPLATE_PATH = resolve(currentDir, '../../src/html-carousel/template/carrossel.html');

const PAGE_TIMEOUT_MS = 45_000;
const IMAGE_WAIT_BUDGET_MS = 15_000;

function resolveChromeExecutable(): string {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  const found = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!found) {
    throw new Error(
      'Chrome não encontrado para renderizar o carrossel HTML. Defina CHROME_PATH com o caminho do executável ' +
        '(ex: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome no macOS, /usr/bin/google-chrome no Linux).',
    );
  }
  return found;
}

/**
 * Renderiza cards de carrossel 1080x1350 a partir do template HTML
 * (html-carousel/template/carrossel.html) via Chrome headless. Um browser por
 * chamada, uma página reutilizada navegando com ?card=N pra isolar cada card.
 */
export async function renderCarouselCards(cards: CardData[], meta: CarouselMeta = {}): Promise<Buffer[]> {
  const browser = await puppeteer.launch({
    executablePath: resolveChromeExecutable(),
    headless: true,
    // Sem --allow-file-access-from-files o Chrome bloqueia <img> apontando pra
    // file:// quando a página em si já é file:// (frames locais do carrossel).
    args: ['--allow-file-access-from-files'],
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(PAGE_TIMEOUT_MS);
    await page.setViewport({ width: CAROUSEL_CARD_WIDTH, height: CAROUSEL_CARD_HEIGHT, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(
      (cardsJson: string, metaJson: string) => {
        const w = globalThis as { __CARDS__?: unknown; __META__?: unknown };
        w.__CARDS__ = JSON.parse(cardsJson);
        w.__META__ = JSON.parse(metaJson);
      },
      JSON.stringify(cards),
      JSON.stringify(meta),
    );

    const templateUrl = pathToFileURL(TEMPLATE_PATH).toString();
    const screenshots: Buffer[] = [];

    for (let index = 0; index < cards.length; index++) {
      await page.goto(`${templateUrl}?card=${index + 1}`, { waitUntil: 'networkidle0', timeout: PAGE_TIMEOUT_MS });

      // Fontes do Google Fonts precisam estar prontas antes do screenshot, senão
      // o primeiro card sai com fallback; imagens que nunca emitem load/error
      // não podem travar o job inteiro, daí o orçamento fixo.
      await page.evaluate(async (imageBudgetMs: number) => {
        interface DocumentLike {
          fonts?: { ready: Promise<unknown> };
          images: ArrayLike<{
            complete: boolean;
            addEventListener(type: string, listener: () => void, options?: { once: boolean }): void;
          }>;
        }
        const doc = (globalThis as unknown as { document: DocumentLike }).document;
        await doc.fonts?.ready;
        const pending = Array.from(doc.images)
          .filter((img) => !img.complete)
          .map(
            (img) =>
              new Promise<void>((done) => {
                img.addEventListener('load', done, { once: true });
                img.addEventListener('error', done, { once: true });
              }),
          );
        await Promise.race([Promise.all(pending), new Promise((resolveWait) => setTimeout(resolveWait, imageBudgetMs))]);
      }, IMAGE_WAIT_BUDGET_MS);

      const shot = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: CAROUSEL_CARD_WIDTH, height: CAROUSEL_CARD_HEIGHT },
      });
      screenshots.push(Buffer.from(shot));
    }

    return screenshots;
  } finally {
    await browser.close();
  }
}

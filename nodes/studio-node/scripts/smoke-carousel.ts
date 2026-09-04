/**
 * Smoke test do carrossel HTML (não é teste de framework): renderiza 10 cards
 * dummy cobrindo todos os layouts pra .smoke-output/ e valida dimensões e
 * tamanho de cada PNG. Uso: pnpm tsx scripts/smoke-carousel.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { renderCarouselCards, CAROUSEL_CARD_HEIGHT, CAROUSEL_CARD_WIDTH, type CardData, type CardLayout } from '../src/html-carousel/renderer';

const currentDir = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(currentDir, '../.smoke-output');
const frame = (name: string) => pathToFileURL(resolve(currentDir, `../../../assets/${name}`)).toString();

const MIN_BYTES = 10 * 1024;

const layouts: CardLayout[] = ['capa', 'premissa', 'item', 'item', 'follow', 'item', 'golpe', 'diptico', 'tese', 'cta'];

const cards: CardData[] = [
  {
    layout: 'capa',
    kicker: 'Construção · Chico Buarque · 1971',
    headline: '*41 versos* escondem a regra que você nunca percebeu',
    subtext: 'O júri de 92 especialistas da Rolling Stone elegeu, e eu discordei — até contar verso por verso.',
    frame: frame('FUNDO-PRETO.png'),
    page: 1,
    totalPages: 10,
  },
  {
    layout: 'premissa',
    headline: '"Era uma casa muito engraçada, não tinha teto, *não tinha nada*"',
    subtext: 'O verso que abre o filme é o mesmo que abre a canção — e isso não é coincidência.',
    page: 2,
    totalPages: 10,
  },
  {
    layout: 'item',
    kicker: 'Construção · Chico Buarque · 1971',
    tag: 'verso',
    tagLabel: 'VERSO Nº 1',
    headline: 'Todo verso termina em *proparoxítona*',
    subtext: 'Amou, daquela vez, morreu: a regra vale pros *41 versos* da canção.',
    page: 3,
    totalPages: 10,
  },
  {
    layout: 'item',
    kicker: 'Construção · Chico Buarque · 1971',
    tag: 'segredo',
    tagLabel: 'SEGREDO Nº 2',
    headline: 'O menino tem o *rosto do Cazuza* criança',
    subtext: 'Decisão de direção minha. Volta os cards e olha de novo.',
    frame: frame('FUNDO-PRETO.png'),
    page: 4,
    totalPages: 10,
  },
  {
    layout: 'follow',
    headline: 'Antes da parte que *dói*: segue o perfil',
    subtext: 'Todo clipe novo vira um carrossel assim. O próximo é ainda mais fundo.',
    page: 5,
    totalPages: 10,
  },
  {
    layout: 'item',
    kicker: 'Construção · Chico Buarque · 1971',
    tag: 'verso',
    tagLabel: 'VERSO Nº 3',
    headline: 'Quem cai é o *capacete*, nunca ele',
    subtext: 'A regra que me impus pra não profanar a obra.',
    page: 6,
    totalPages: 10,
  },
  {
    layout: 'golpe',
    headline: 'Agora *volta os cards* e olha o cabelo dele',
    subtext: 'A revelação que recontextualiza tudo que você viu até aqui.',
    page: 7,
    totalPages: 10,
  },
  {
    layout: 'diptico',
    tag: 'segredo',
    tagLabel: 'SEGREDO Nº 4',
    headline: 'O frame que eu *joguei fora*',
    subtext: 'Tentativa Nº 11 de 40. O verdadeiro só aparece no fim.',
    frame: frame('FUNDO-CLARO.png'),
    page: 8,
    totalPages: 10,
  },
  {
    layout: 'tese',
    headline: 'A obra não é minha, eu só *emprestei a máquina*',
    subtext: 'Tudo que o filme esconde já estava escrito na letra, desde 1971.',
    page: 9,
    totalPages: 10,
  },
  {
    layout: 'cta',
    headline: 'Salva pra lembrar, *manda pra quem* canta essa desde criança',
    subtext: 'E volta no Reel: o filme entrega por mais 28 dias.',
    frame: frame('FUNDO-PRETO.png'),
    page: 10,
    totalPages: 10,
  },
];

const foundLayouts = new Set(cards.map((card) => card.layout));
const missing = layouts.filter((layout) => !foundLayouts.has(layout));
if (missing.length > 0) {
  throw new Error(`Cards dummy não cobrem os layouts: ${missing.join(', ')}`);
}

await mkdir(outDir, { recursive: true });
console.log(`Renderizando ${cards.length} cards (Chrome headless, ${CAROUSEL_CARD_WIDTH}x${CAROUSEL_CARD_HEIGHT})...`);

const buffers = await renderCarouselCards(cards, { seriesName: 'Cinema Impossível', footerText: 'O que você não percebeu' });

let failures = 0;
for (let index = 0; index < buffers.length; index++) {
  const buffer = buffers[index];
  if (!buffer) {
    console.error(`[FAIL] card ${index + 1}: renderer não devolveu buffer`);
    failures++;
    continue;
  }
  const filename = `${String(index + 1).padStart(2, '0')}-${cards[index]?.layout ?? 'card'}.png`;
  const filePath = resolve(outDir, filename);
  await writeFile(filePath, buffer);

  const info = await sharp(buffer).metadata();
  const problems: string[] = [];
  if (info.format !== 'png') problems.push(`formato=${info.format ?? 'desconhecido'}`);
  if (info.width !== CAROUSEL_CARD_WIDTH || info.height !== CAROUSEL_CARD_HEIGHT) {
    problems.push(`dimensões=${info.width}x${info.height}`);
  }
  if (buffer.byteLength < MIN_BYTES) problems.push(`tamanho=${buffer.byteLength}B (<${MIN_BYTES}B)`);

  if (problems.length > 0) {
    failures++;
    console.error(`[FAIL] ${filename}: ${problems.join(', ')}`);
  } else {
    console.log(`[ OK ] ${filename}: png ${info.width}x${info.height}, ${(buffer.byteLength / 1024).toFixed(1)}KB`);
  }
}

if (buffers.length !== cards.length) {
  failures++;
  console.error(`[FAIL] esperava ${cards.length} PNGs, renderer devolveu ${buffers.length}`);
}

if (failures > 0) {
  console.error(`\nSmoke test FALHOU (${failures} problema(s)). Saída em ${outDir}`);
  process.exit(1);
}
console.log(`\nSmoke test OK: ${buffers.length} PNGs válidos em ${outDir}`);

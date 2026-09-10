import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import sharp from 'sharp';

export interface SlideText {
  headline: string;
  subtext?: string | undefined;
}

const currentDir = dirname(fileURLToPath(import.meta.url));

/**
 * Falha real observada em 08/09/2026 (reclamação do usuário: "carrossel com
 * fonte genérica"): o overlay pedia font-family="'Segoe UI', Helvetica,
 * Arial, sans-serif" via <text> do SVG - nenhuma dessas existe garantida no
 * host que roda o sharp/librsvg, então caía na fonte padrão do sistema.
 * Uma primeira tentativa de corrigir com @font-face + fonte embutida em
 * base64 TAMBÉM falhou: confirmado empiricamente (teste isolado com uma
 * fonte pixelada bem distinta) que este build de librsvg (2.58.93, via
 * fontconfig) ignora silenciosamente @font-face com data URI e cai no
 * fallback mesmo assim - sem erro, sem aviso, só a fonte errada.
 *
 * A correção de verdade: gerar os contornos vetoriais do texto em Node com
 * opentype.js (lê o .ttf direto, sem depender de fonte instalada no SO nem
 * de suporte a @font-face do rasterizador) e emitir <path> puro no SVG. O
 * rasterizador só desenha vetores já prontos - não tem fonte pra "escolher
 * errado". Mesma família do template do carrossel HTML (Space Grotesk),
 * consistência visual entre os dois caminhos de geração.
 */
// loadSync() é um stub deprecado que só imprime aviso e retorna undefined
// nesta versão (1.3.5) - confirmado ao vivo lendo o source. A própria
// mensagem de deprecation manda usar parse(readFileSync(...)) direto.
const FONT_MEDIUM = opentype.parse(readFileSync(resolve(currentDir, '../assets/fonts/SpaceGrotesk-Medium.ttf')));
const FONT_BOLD = opentype.parse(readFileSync(resolve(currentDir, '../assets/fonts/SpaceGrotesk-Bold.ttf')));

// hinting:true é obrigatório aqui: confirmado ao vivo em 08/09/2026 que o
// caminho padrão (hinting:false) do opentype.js 1.3.5 produz "NaN" dentro
// do path data pra certos glifos deste arquivo (ex.: 'p' minúsculo) -
// SVG/librsvg não avisa, só para de desenhar o resto do texto no primeiro
// NaN, cortando a frase no meio em silêncio. Com hinting:true o bug some.
// @types/opentype.js@1.3.10 (última versão publicada) não conhece essa
// opção - RenderOptions do pacote de tipos ficou pra trás da API real de
// runtime (confirmado lendo o source do opentype.js instalado). Cast
// pontual, não around a chamada real que já foi validada empiricamente.
const GLYPH_OPTIONS = { hinting: true } as unknown as opentype.RenderOptions;

function textWidth(font: opentype.Font, text: string, fontSize: number): number {
  return font.getAdvanceWidth(text, fontSize, GLYPH_OPTIONS);
}

function wrapTextByWidth(font: opentype.Font, text: string, fontSize: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && textWidth(font, candidate, fontSize) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Um <path> por linha, contorno já resolvido pelo opentype.js - o SVG não referencia fonte nenhuma. */
function lineToPath(font: opentype.Font, line: string, x: number, y: number, fontSize: number, fill: string): string {
  const path = font.getPath(line, x, y, fontSize, GLYPH_OPTIONS);
  const data = path.toPathData(2);
  // Defesa em profundidade: se algum outro glifo/combinação ainda produzir
  // NaN, falhar alto aqui (job marcado failed, dá pra investigar) é muito
  // melhor que compositar um path corrompido que corta a frase em silêncio.
  if (data.includes('NaN')) {
    throw new Error(`compositeSlideText: path data com NaN pra linha "${line}" - glifo problemático na fonte`);
  }
  return `<path d="${data}" fill="${fill}" />`;
}

/**
 * Sobrepõe headline + subtexto (a copy gerada em packages/router/marketing-copy)
 * numa imagem já gerada, com um scrim (gradiente escuro) atrás pra garantir
 * legibilidade - texto de verdade via compositing, não "desenhado" pelo modelo
 * de imagem, o que é notoriamente ruim mesmo nos modelos mais avançados.
 */
export async function compositeSlideText(imageBuffer: Buffer, text: SlideText): Promise<Buffer> {
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();
  const width = metadata.width ?? 1080;
  const height = metadata.height ?? 1080;

  const marginX = width * 0.06;
  const maxTextWidth = width - marginX * 2;
  const headlineSize = Math.round(width * 0.062);
  const subtextSize = Math.round(width * 0.032);

  const headlineLines = wrapTextByWidth(FONT_BOLD, text.headline, headlineSize, maxTextWidth);
  const subtextLines = text.subtext ? wrapTextByWidth(FONT_MEDIUM, text.subtext, subtextSize, maxTextWidth) : [];

  const lineHeightHeadline = headlineSize * 1.2;
  const lineHeightSubtext = subtextSize * 1.35;
  const paddingBottom = height * 0.08;
  const blockHeight =
    headlineLines.length * lineHeightHeadline +
    (subtextLines.length > 0 ? subtextLines.length * lineHeightSubtext + subtextSize * 0.6 : 0);
  const scrimHeight = Math.min(height * 0.6, blockHeight + paddingBottom + height * 0.08);

  const textStartY =
    height -
    paddingBottom -
    (subtextLines.length > 0 ? subtextLines.length * lineHeightSubtext : 0) -
    headlineLines.length * lineHeightHeadline;

  let svgPaths = '';
  let cursorY = textStartY + headlineSize;
  for (const line of headlineLines) {
    svgPaths += lineToPath(FONT_BOLD, line, marginX, cursorY, headlineSize, '#ffffff');
    cursorY += lineHeightHeadline;
  }
  if (subtextLines.length > 0) cursorY += subtextSize * 0.3;
  for (const line of subtextLines) {
    svgPaths += lineToPath(FONT_MEDIUM, line, marginX, cursorY, subtextSize, '#e4e4e7');
    cursorY += lineHeightSubtext;
  }

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#000000" stop-opacity="0" />
        <stop offset="100%" stop-color="#000000" stop-opacity="0.78" />
      </linearGradient>
    </defs>
    <rect x="0" y="${height - scrimHeight}" width="${width}" height="${scrimHeight}" fill="url(#scrim)" />
    ${svgPaths}
  </svg>`;

  return image.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
}

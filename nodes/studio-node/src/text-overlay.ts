import sharp from 'sharp';

export interface SlideText {
  headline: string;
  subtext?: string | undefined;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Sobrepõe headline + subtexto (a copy gerada em packages/router/marketing-copy)
 * numa imagem já gerada, com um scrim (gradiente escuro) atrás pra garantir
 * legibilidade — texto de verdade via compositing, não "desenhado" pelo modelo
 * de imagem, o que é notoriamente ruim mesmo nos modelos mais avançados.
 */
export async function compositeSlideText(imageBuffer: Buffer, text: SlideText): Promise<Buffer> {
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();
  const width = metadata.width ?? 1080;
  const height = metadata.height ?? 1080;

  const headlineSize = Math.round(width * 0.062);
  const subtextSize = Math.round(width * 0.032);
  const maxCharsHeadline = Math.max(10, Math.round(width / (headlineSize * 0.55)));
  const maxCharsSubtext = Math.max(14, Math.round(width / (subtextSize * 0.55)));

  const headlineLines = wrapText(text.headline, maxCharsHeadline);
  const subtextLines = text.subtext ? wrapText(text.subtext, maxCharsSubtext) : [];

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

  let svgText = '';
  let cursorY = textStartY + headlineSize;
  for (const line of headlineLines) {
    svgText += `<text x="6%" y="${cursorY}" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-weight="900" font-size="${headlineSize}" fill="#ffffff">${escapeXml(line)}</text>`;
    cursorY += lineHeightHeadline;
  }
  if (subtextLines.length > 0) cursorY += subtextSize * 0.3;
  for (const line of subtextLines) {
    svgText += `<text x="6%" y="${cursorY}" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-weight="500" font-size="${subtextSize}" fill="#e4e4e7">${escapeXml(line)}</text>`;
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
    ${svgText}
  </svg>`;

  return image.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
}

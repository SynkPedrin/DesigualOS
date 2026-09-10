import type { StudioBrandPlacement } from '@desigual-os/types';
import sharp from 'sharp';
import { fetchWithRetry } from './comfyui-client';

export interface BrandLogoComposition {
  sourceUrl: string;
  placement: StudioBrandPlacement;
  /** Fração da largura final ocupada pelo logo. */
  widthRatio?: number;
  /** Margem externa como fração do menor lado. */
  marginRatio?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export async function compositeExactLogo(
  imageBuffer: Buffer,
  logo: BrandLogoComposition,
): Promise<Buffer> {
  if (!logo.placement.startsWith('canvas_')) return imageBuffer;

  const response = await fetchWithRetry(logo.sourceUrl);
  if (!response.ok) {
    throw new Error(`Não consegui baixar a logo exata (${response.status}): ${logo.sourceUrl}`);
  }

  const base = sharp(imageBuffer);
  const metadata = await base.metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) throw new Error('Não consegui ler as dimensões da imagem antes de aplicar a logo.');

  const widthRatio = clamp(logo.widthRatio ?? 0.18, 0.05, 0.45);
  const marginRatio = clamp(logo.marginRatio ?? 0.04, 0.01, 0.15);
  const targetWidth = Math.round(width * widthRatio);
  const targetHeight = Math.round(height * 0.22);
  const logoBytes = Buffer.from(await response.arrayBuffer());
  const rendered = await sharp(logoBytes)
    .resize({ width: targetWidth, height: targetHeight, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });

  const margin = Math.round(Math.min(width, height) * marginRatio);
  const left = logo.placement.endsWith('_right') ? width - rendered.info.width - margin : margin;
  const top = logo.placement.includes('_bottom') ? height - rendered.info.height - margin : margin;

  return base
    .composite([{ input: rendered.data, left: Math.max(0, left), top: Math.max(0, top) }])
    .png()
    .toBuffer();
}

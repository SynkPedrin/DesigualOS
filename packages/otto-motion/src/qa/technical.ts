import fs from 'node:fs/promises';
import { getVideoMetadata } from '@remotion/renderer';
import sharp from 'sharp';
import type { ExtractedFrame } from '../render/render.js';

/**
 * §25 — MOTION QA programático.
 *
 * Este é o único dos cinco scores que é MEDIÇÃO, não opinião. Por isso ele é
 * o que tem piso duro (§44: technical < 95 não conclui): reprovar aqui
 * significa que o arquivo entregue não é o arquivo pedido, e isso não é
 * questão de gosto.
 */
export interface TechnicalCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
  /** Peso no score. A soma dos pesos é 100. */
  weight: number;
}

export interface TechnicalQaResult {
  score: number;
  checks: TechnicalCheck[];
  failures: TechnicalCheck[];
}

export interface TechnicalQaInput {
  file: string;
  expected: { width: number; height: number; fps: number; durationSeconds: number };
  frames: readonly ExtractedFrame[];
  /** Erros de runtime capturados do console do browser durante o render. */
  runtimeErrors: readonly string[];
  /** Assets que o projeto referencia e não existem no disco. */
  missingAssets: readonly string[];
}

/** Tolerância de duração: 1 frame a 30fps. Menos que isso é ruído de arredondamento. */
const DURATION_TOLERANCE_SECONDS = 0.05;

export async function runTechnicalQa(input: TechnicalQaInput): Promise<TechnicalQaResult> {
  const checks: TechnicalCheck[] = [];

  const stat = await fs.stat(input.file).catch(() => null);
  checks.push({
    id: 'file',
    label: 'arquivo gerado',
    passed: stat !== null && stat.size > 1024,
    detail: stat ? `${Math.round(stat.size / 1024)} KB` : 'arquivo não existe',
    weight: 25,
  });

  if (stat === null) {
    return finalize(checks);
  }

  const metadata = await getVideoMetadata(input.file).catch((error: unknown) => {
    return { error: error instanceof Error ? error.message : String(error) } as const;
  });

  if ('error' in metadata) {
    checks.push({
      id: 'readable',
      label: 'vídeo legível',
      passed: false,
      detail: metadata.error,
      weight: 25,
    });
    return finalize(checks);
  }

  checks.push({
    id: 'resolution',
    label: 'resolução',
    passed: metadata.width === input.expected.width && metadata.height === input.expected.height,
    detail: `${metadata.width}x${metadata.height} (pedido ${input.expected.width}x${input.expected.height})`,
    weight: 15,
  });

  checks.push({
    id: 'fps',
    label: 'fps',
    passed: Math.abs(metadata.fps - input.expected.fps) < 0.5,
    detail: `${metadata.fps} (pedido ${input.expected.fps})`,
    weight: 10,
  });

  // O compositor devolve null quando não consegue ler a duração do container.
  // Isso é reprovação, não "sem opinião": um MP4 cuja duração não dá pra ler
  // é exatamente o tipo de arquivo que não deveria ir pro cliente.
  const duration = metadata.durationInSeconds;
  checks.push({
    id: 'duration',
    label: 'duração',
    passed: duration !== null && Math.abs(duration - input.expected.durationSeconds) <= DURATION_TOLERANCE_SECONDS,
    detail:
      duration === null
        ? 'o container não declara duração'
        : `${duration.toFixed(2)}s (pedido ${input.expected.durationSeconds}s)`,
    weight: 15,
  });

  checks.push({
    id: 'codec',
    label: 'codec',
    passed: /h264|avc/i.test(metadata.codec ?? ''),
    detail: metadata.codec ?? 'desconhecido',
    weight: 5,
  });

  const black = await findBlackFrames(input.frames);
  checks.push({
    id: 'black_frames',
    label: 'frames pretos',
    passed: black.length === 0,
    // O primeiro e o último frame são a exceção legítima (abertura/fecho em
    // preto é decisão de direção), então findBlackFrames já os ignora.
    detail: black.length === 0 ? 'nenhum no miolo' : `${black.map((f) => `${f.toFixed(1)}s`).join(', ')}`,
    weight: 10,
  });

  checks.push({
    id: 'missing_assets',
    label: 'assets referenciados',
    passed: input.missingAssets.length === 0,
    detail: input.missingAssets.length === 0 ? 'todos presentes' : input.missingAssets.join(', '),
    weight: 10,
  });

  checks.push({
    id: 'runtime',
    label: 'erros de runtime',
    passed: input.runtimeErrors.length === 0,
    detail: input.runtimeErrors.length === 0 ? 'nenhum' : `${input.runtimeErrors.length}: ${input.runtimeErrors[0] ?? ''}`,
    weight: 10,
  });

  return finalize(checks);
}

function finalize(checks: TechnicalCheck[]): TechnicalQaResult {
  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);
  const earned = checks.reduce((sum, check) => sum + (check.passed ? check.weight : 0), 0);
  // Normaliza pelo peso presente: quando o arquivo nem existe, só duas
  // checagens rodaram, e dividir por 100 daria um score enganosamente baixo
  // em vez de refletir "falhou tudo que dava pra medir".
  const score = totalWeight === 0 ? 0 : Math.round((earned / totalWeight) * 100);
  return { score, checks, failures: checks.filter((check) => !check.passed) };
}

/**
 * Frame praticamente preto no MIOLO da peça.
 *
 * Abrir ou fechar em preto é decisão de direção legítima e comum, então as
 * pontas ficam de fora. Preto no meio é quase sempre cena que não renderizou.
 */
export async function findBlackFrames(frames: readonly ExtractedFrame[], threshold = 4): Promise<number[]> {
  const suspects: number[] = [];
  for (let index = 1; index < frames.length - 1; index += 1) {
    const frame = frames[index];
    if (!frame) continue;
    try {
      const stats = await sharp(frame.file).stats();
      const mean = stats.channels.slice(0, 3).reduce((sum, channel) => sum + channel.mean, 0) / 3;
      if (mean < threshold) suspects.push(frame.timeSeconds);
    } catch {
      // Frame ilegível já é problema, mas é o check de arquivo que reporta.
    }
  }
  return suspects;
}

/**
 * Assets que o código referencia via staticFile() e não existem no disco.
 *
 * Erro que o browser engole: `<Img src={staticFile('assets/nao-existe.png')}/>`
 * renderiza um retângulo vazio e o vídeo sai "ok". Conferir no código-fonte
 * pega antes do render.
 */
export async function findMissingStaticFiles(sources: readonly { path: string; content: string }[], publicDir: string): Promise<string[]> {
  const referenced = new Set<string>();
  for (const source of sources) {
    for (const match of source.content.matchAll(/staticFile\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) {
      const value = match[1];
      if (value) referenced.add(value.replace(/^\/+/, ''));
    }
  }
  const missing: string[] = [];
  for (const reference of referenced) {
    const exists = await fs
      .access(`${publicDir}/${reference}`)
      .then(() => true)
      .catch(() => false);
    if (!exists) missing.push(reference);
  }
  return missing;
}

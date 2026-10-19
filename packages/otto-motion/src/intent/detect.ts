import {
  DEFAULT_DURATION_SECONDS,
  MAX_DURATION_SECONDS,
  MIN_DURATION_SECONDS,
  type MotionFormat,
  type MotionFps,
} from '../types.js';

export interface MotionIntent {
  kind: 'create' | 'update';
  /** Por que foi classificado assim. Vai pro log — é o que permite auditar falso positivo. */
  reason: string;
  durationSeconds: number | undefined;
  format: MotionFormat | undefined;
  fps: MotionFps | undefined;
}

export interface MotionIntentContext {
  /** Há uma MotionSession viva nesta conversa? Decide create vs update (§17). */
  hasActiveSession: boolean;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * §15 — o que NÃO é Motion Design, mesmo falando de vídeo.
 *
 * Três famílias moram aqui:
 *  - GENERATIVE_VIDEO: o Studio já faz isso na 5090 (ComfyUI/i2v). Nomes de
 *    modelo generativo são sinal forte e inequívoco.
 *  - VIDEO_EDITING: cortar, legendar, transcrever material que já existe.
 *  - IMAGE_GENERATION: post, card, imagem parada.
 */
const NOT_MOTION = [
  // generative video — território do Studio
  'gera um video com ia',
  'video com ia',
  'video gerado por ia',
  'veo',
  'sora',
  'runway',
  'kling',
  'pika',
  'hailuo',
  'minimax',
  'image to video',
  'img2video',
  'i2v',
  'comfyui',
  // edição de material existente
  'corta o video',
  'cortar o video',
  'corte o video',
  'edita o video',
  'editar o video',
  'edite o video',
  'legenda o video',
  'legendar o video',
  'transcreve',
  'transcrever',
  'transcricao',
  'junta os videos',
  'trilha sonora',
];

/**
 * Vocabulário que caracteriza MOTION DESIGN de verdade: gráfico, tipográfico,
 * programático, de marca.
 */
const MOTION_SIGNALS = [
  'motion',
  'motion design',
  'motion grafico',
  'anima',
  'anime ',
  'animar',
  'animacao',
  'animado',
  'animada',
  'kinetic',
  'tipografia cinetica',
  'vinheta',
  'abertura animada',
  'logo animado',
  'logo animada',
  'lettering animado',
  'se mexer',
  'se mexendo',
  'dar movimento',
  'ganhar movimento',
  'em movimento',
];

/**
 * Sinais que não cabem numa busca de substring porque o pedido real tem
 * palavras no meio: "transforma essa campanha estática em vídeo",
 * "transformar esse post em vídeo". Regex resolve sem inchar a lista de
 * substrings com todas as variações possíveis.
 */
const MOTION_PATTERNS: readonly RegExp[] = [
  /transform(?:a|e|ar|ando)\b[^.!?]{0,60}\bem\s+(?:video|movimento|motion)\b/,
  /vir(?:a|ar|e)\b[^.!?]{0,40}\bvideo\b/,
  /\bestatic[ao]\b[^.!?]{0,40}\bem\s+video\b/,
  /\bfa(?:z|ca|zer)\b[^.!?]{0,40}\bse\s+mex/,
];

/**
 * Sinais que só contam ACOMPANHADOS de vocabulário de motion.
 *
 * "cria um reels" sozinho NÃO é intercept: `reels` é um tipo de job que já
 * existe no Studio (STUDIO_JOB_TYPES, packages/types/src/studio.ts) e o
 * caminho Otto -> production_spec -> studio-jobs funciona hoje em produção.
 * A spec lista "cria um reels" como exemplo de MOTION_REQUEST (§15) e também
 * manda não mandar todo pedido de vídeo pro Motion Engine (§15) — com a ordem
 * de prioridade do §51 ("1. não quebrar o sistema atual"), o desempate é
 * ficar de fora. "cria um reels animado" ou "reels em motion" entram.
 */
const WEAK_SIGNALS = ['reels', 'stories', 'story', 'video', 'anuncio', 'campanha', 'post'];

/**
 * §17 — ajuste de um motion que acabou de ser mostrado.
 *
 * Estas frases não têm vocabulário de motion nenhum ("está muito parado",
 * "deixa o preço entrar mais forte") e só são interpretáveis com uma sessão
 * viva na conversa. Por isso a lista SÓ é consultada quando hasActiveSession.
 */
const ADJUSTMENT_SIGNALS = [
  'parado',
  'parada',
  'lento',
  'lenta',
  'rapido',
  'rapida',
  'devagar',
  'mais forte',
  'mais agressiv',
  'mais suave',
  'mais premium',
  'entrar antes',
  'entrar depois',
  'aparecer antes',
  'aparecer depois',
  'troca a foto',
  'trocar a foto',
  'troca a fotografia',
  'troca a imagem',
  'troca a cor',
  'aumenta',
  'diminui',
  'cena',
  'cta',
  'transicao',
  'ficou ',
  'deixa o',
  'deixa a',
  'faz o logo',
  'faz a logo',
  'versao para stories',
  'versao pra stories',
  'alternativa',
  'variacao',
];

function containsAny(haystack: string, needles: readonly string[]): string | null {
  for (const needle of needles) {
    if (haystack.includes(needle)) return needle;
  }
  return null;
}

/** "15 segundos", "de 15s", "15 seg" — sem casar com "1080x1920" nem com datas. */
export function extractDuration(normalized: string): number | undefined {
  const match = /(\d{1,3})\s*(?:s\b|seg\b|segs\b|segundos?\b)/.exec(normalized);
  if (!match?.[1]) return undefined;
  const value = Number.parseInt(match[1], 10);
  if (!Number.isFinite(value)) return undefined;
  if (value < MIN_DURATION_SECONDS || value > MAX_DURATION_SECONDS) return undefined;
  return value;
}

export function extractFormat(normalized: string): MotionFormat | undefined {
  if (/9\s*[:x]\s*16|1080\s*x\s*1920|\bstories\b|\breels\b|\bvertical\b|\bshorts?\b/.test(normalized)) return '9:16';
  if (/4\s*[:x]\s*5|1080\s*x\s*1350/.test(normalized)) return '4:5';
  if (/1\s*[:x]\s*1|1080\s*x\s*1080|\bquadrado\b/.test(normalized)) return '1:1';
  if (/16\s*[:x]\s*9|1920\s*x\s*1080|\bhorizontal\b|\byoutube\b/.test(normalized)) return '16:9';
  return undefined;
}

export function extractFps(normalized: string): MotionFps | undefined {
  const match = /(\d{2})\s*fps/.exec(normalized);
  const value = match?.[1] ? Number.parseInt(match[1], 10) : undefined;
  return value === 24 || value === 30 || value === 60 ? value : undefined;
}

/**
 * Classifica o turno. Devolve null quando NÃO é pedido de motion — e null é o
 * desfecho correto na dúvida: o turno segue exatamente o caminho que já
 * seguia hoje, sem nenhum efeito deste módulo.
 */
export function detectMotionIntent(message: string, context: MotionIntentContext): MotionIntent | null {
  const normalized = normalize(message);

  const denied = containsAny(normalized, NOT_MOTION);
  if (denied) return null;

  const strong =
    containsAny(normalized, MOTION_SIGNALS) ??
    MOTION_PATTERNS.find((pattern) => pattern.test(normalized))?.source ??
    null;
  const weak = containsAny(normalized, WEAK_SIGNALS);

  const durationSeconds = extractDuration(normalized);
  const format = extractFormat(normalized);
  const fps = extractFps(normalized);

  if (strong) {
    // Com sessão viva, vocabulário de motion pode ser tanto "faz outro" quanto
    // "faz o logo entrar depois". O desempate é pedido explícito de peça nova.
    if (context.hasActiveSession && !/\b(nov[oa]|outr[oa]|mais um|do zero|comec[ae] de novo)\b/.test(normalized)) {
      return { kind: 'update', reason: `sinal de motion '${strong}' com sessão ativa`, durationSeconds, format, fps };
    }
    return { kind: 'create', reason: `sinal de motion '${strong}'`, durationSeconds, format, fps };
  }

  if (weak && context.hasActiveSession) {
    return { kind: 'update', reason: `'${weak}' com sessão ativa`, durationSeconds, format, fps };
  }

  if (context.hasActiveSession) {
    const adjustment = containsAny(normalized, ADJUSTMENT_SIGNALS);
    if (adjustment) {
      return { kind: 'update', reason: `ajuste '${adjustment}' com sessão ativa`, durationSeconds, format, fps };
    }
  }

  return null;
}

/** Duração efetiva do job, já com o default do §35 aplicado. */
export function resolveDuration(requested: number | undefined): number {
  return requested ?? DEFAULT_DURATION_SECONDS;
}

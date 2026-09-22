import type { CanvaObject } from '@desigual-os/types';

/**
 * Normalização de cor e extração das cores do documento.
 *
 * O problema concreto que isto resolve: `#fff`, `#FFFFFF` e
 * `rgb(255,255,255)` são a MESMA cor, mas como string são três. Sem uma
 * forma canônica, a lista de "recentes" enche de duplicatas e as "cores do
 * documento" mostram o mesmo branco várias vezes.
 *
 * Forma canônica escolhida: `#rrggbb` minúsculo, ou `#rrggbbaa` quando há
 * transparência real (alpha < 1). Hex é o que o Fabric aceita direto e o que
 * o usuário reconhece.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const limita = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const doisDigitos = (n: number) => Math.round(limita(n, 0, 255)).toString(16).padStart(2, '0');

/** Aceita hex de 3/4/6/8 dígitos, `rgb()`, `rgba()`, `hsl()` e `hsla()`. */
export function parseColor(input: string): Rgba | null {
  const texto = input.trim().toLowerCase();
  if (texto.length === 0) return null;
  if (texto === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  const hex = texto.startsWith('#') ? texto.slice(1) : /^[0-9a-f]{3,8}$/.test(texto) ? texto : null;
  if (hex !== null) {
    if (![3, 4, 6, 8].includes(hex.length) || !/^[0-9a-f]+$/.test(hex)) return null;
    const dobra = (c: string) => parseInt(c + c, 16);
    if (hex.length === 3 || hex.length === 4) {
      return {
        r: dobra(hex[0]!), g: dobra(hex[1]!), b: dobra(hex[2]!),
        a: hex.length === 4 ? dobra(hex[3]!) / 255 : 1,
      };
    }
    return {
      r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    };
  }

  const rgb = texto.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const partes = rgb[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
    if (partes.length < 3 || partes.slice(0, 3).some((n) => !Number.isFinite(n))) return null;
    return { r: partes[0]!, g: partes[1]!, b: partes[2]!, a: partes[3] === undefined ? 1 : limita(partes[3], 0, 1) };
  }

  const hsl = texto.match(/^hsla?\(([^)]+)\)$/);
  if (hsl) {
    const partes = hsl[1]!.split(/[\s,/]+/).filter(Boolean);
    const h = Number.parseFloat(partes[0] ?? '');
    const s = Number.parseFloat(partes[1] ?? '') / 100;
    const l = Number.parseFloat(partes[2] ?? '') / 100;
    if (![h, s, l].every(Number.isFinite)) return null;
    const a = partes[3] === undefined ? 1 : limita(Number.parseFloat(partes[3]), 0, 1);
    return { ...hslParaRgb(h, s, l), a };
  }

  return null;
}

export function hslParaRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const c = (1 - Math.abs(2 * l - 1)) * limita(s, 0, 1);
  const hh = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const [r1, g1, b1] =
    hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x] : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x];
  const m = limita(l, 0, 1) - c / 2;
  return { r: Math.round((r1 + m) * 255), g: Math.round((g1 + m) * 255), b: Math.round((b1 + m) * 255) };
}

export function rgbParaHsl({ r, g, b }: { r: number; g: number; b: number }): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h =
    max === rn ? 60 * (((gn - bn) / d) % 6) : max === gn ? 60 * ((bn - rn) / d + 2) : 60 * ((rn - gn) / d + 4);
  return { h: (h + 360) % 360, s, l };
}

/**
 * Forma canônica. Cores iguais escritas de formas diferentes viram a MESMA
 * string - é isso que faz "recentes" e "cores do documento" não duplicarem.
 * Devolve `null` para entrada inválida em vez de uma cor inventada.
 */
export function normalizeColor(input: string): string | null {
  const rgba = parseColor(input);
  if (!rgba) return null;
  const base = `#${doisDigitos(rgba.r)}${doisDigitos(rgba.g)}${doisDigitos(rgba.b)}`;
  return rgba.a >= 1 ? base : `${base}${doisDigitos(rgba.a * 255)}`;
}

export function toRgbString(input: string): string | null {
  const c = parseColor(input);
  if (!c) return null;
  const r = Math.round(c.r);
  const g = Math.round(c.g);
  const b = Math.round(c.b);
  return c.a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${Number(c.a.toFixed(2))})`;
}

export function toHslString(input: string): string | null {
  const c = parseColor(input);
  if (!c) return null;
  const { h, s, l } = rgbParaHsl(c);
  const hs = `${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%`;
  return c.a >= 1 ? `hsl(${hs})` : `hsla(${hs}, ${Number(c.a.toFixed(2))})`;
}

/**
 * Cores realmente usadas nos objetos da página.
 *
 * Deriva do documento a cada chamada em vez de manter uma lista à parte:
 * uma segunda lista precisaria ser sincronizada em toda edição e divergiria
 * na primeira que escapasse.
 */
export function documentColors(objetos: CanvaObject[]): string[] {
  const vistas = new Set<string>();
  const empurra = (valor: unknown) => {
    if (typeof valor !== 'string') return;
    const cor = normalizeColor(valor);
    if (!cor) return;
    // Totalmente transparente não é cor para reaplicar. O alfa só existe na
    // forma de 8 dígitos (#rrggbbaa = 9 chars com o '#'); testar o sufixo
    // sem checar o comprimento descartaria preto puro (#000000), que também
    // termina em "00".
    const transparente = cor.length === 9 && cor.endsWith('00');
    if (!transparente) vistas.add(cor);
  };
  for (const obj of objetos) {
    if (obj.type === 'shape') {
      empurra(obj.fill);
      empurra(obj.stroke);
    } else if (obj.type === 'text') {
      empurra(obj.fill);
    } else if (obj.type === 'image') {
      empurra(obj.stroke);
    } else if (obj.type === 'path') {
      empurra(obj.stroke);
    }
    // Grupo fica de fora de propósito: ele guarda a estrutura NATIVA do
    // Fabric (ver CanvaGroupObject), não `CanvaObject[]` recursivo, então as
    // cores dos filhos não são legíveis pelo modelo portável. Preferir a
    // lista incompleta a inventar leitura do formato interno de terceiro.
  }
  return [...vistas];
}

/** Componentes de pixel (ex: getImageData do conta-gotas) -> hex canônico. */
export function rgbaToHex(r: number, g: number, b: number, a = 1): string {
  const base = `#${doisDigitos(r)}${doisDigitos(g)}${doisDigitos(b)}`;
  return a >= 1 ? base : `${base}${doisDigitos(a * 255)}`;
}

export const MAX_RECENT_COLORS = 10;

/** Cor nova entra na frente, sem duplicata canônica, com teto fixo. */
export function pushRecentColor(recentes: string[], cor: string): string[] {
  const canonica = normalizeColor(cor);
  if (!canonica) return recentes;
  return [canonica, ...recentes.filter((c) => normalizeColor(c) !== canonica)].slice(0, MAX_RECENT_COLORS);
}

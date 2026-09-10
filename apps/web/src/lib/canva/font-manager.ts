/**
 * FontManager: carregamento sob demanda de variantes do Fontsource via
 * FontFace API + CDN pública (cdn.jsdelivr.net/fontsource) - nunca baixa o
 * catálogo inteiro no bundle (destruiria performance, pedido explícito).
 * Padrão de URL documentado em fontsource.org/docs/getting-started/cdn:
 * https://cdn.jsdelivr.net/fontsource/fonts/{id}@latest/{subset}-{weight}-{style}.woff2
 */

const FONTSOURCE_CDN_BASE = 'https://cdn.jsdelivr.net/fontsource/fonts';

/** family+weight+style já carregados nesta sessão - nunca repete a mesma request. */
const loadedVariants = new Set<string>();
const inFlight = new Map<string, Promise<void>>();

function variantKey(fontId: string, weight: number, style: 'normal' | 'italic'): string {
  return `${fontId}:${weight}:${style}`;
}

/** `fontId` é o slug do Fontsource (ex: "space-grotesk"), não necessariamente
 * igual ao nome de exibição da família (ex: "Space Grotesk") - por isso o
 * font-picker guarda os dois. */
export async function loadFontVariant(
  fontId: string,
  family: string,
  weight: number,
  style: 'normal' | 'italic' = 'normal',
  subset = 'latin',
): Promise<void> {
  const key = variantKey(fontId, weight, style);
  if (loadedVariants.has(key)) return;

  const existing = inFlight.get(key);
  if (existing) return existing;

  const url = `${FONTSOURCE_CDN_BASE}/${fontId}@latest/${subset}-${weight}-${style}.woff2`;

  const promise = (async () => {
    try {
      const face = new FontFace(family, `url(${url})`, { weight: String(weight), style });
      const loaded = await face.load();
      document.fonts.add(loaded);
      await document.fonts.ready;
      loadedVariants.add(key);
    } catch (error) {
      // font_load_failed (seção Observabilidade): erro humano na UI, não stack cru -
      // quem chama decide a mensagem; aqui só garante que uma falha não trava o resto.
      throw new Error(`Não foi possível carregar a fonte "${family}" (${weight}${style === 'italic' ? ' itálico' : ''}).`, {
        cause: error,
      });
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

export function isFontVariantLoaded(fontId: string, weight: number, style: 'normal' | 'italic' = 'normal'): boolean {
  return loadedVariants.has(variantKey(fontId, weight, style));
}

/**
 * `Number(str) || fallback` também caía no fallback pra um valor
 * explicitamente "0" (0 é falsy em JS), não só pra entrada inválida (NaN);
 * Number.isFinite + > 0 distingue "não é um número" de "é zero".
 */
export function parseResolution(resolution: string, fallback = 1088): { width: number; height: number } {
  const [widthStr, heightStr] = resolution.split('x');
  const parsedWidth = Number(widthStr);
  const parsedHeight = Number(heightStr);
  return {
    width: Number.isFinite(parsedWidth) && parsedWidth > 0 ? parsedWidth : fallback,
    height: Number.isFinite(parsedHeight) && parsedHeight > 0 ? parsedHeight : fallback,
  };
}

/**
 * O Flux trabalha em latentes de 1/8 com patches de 2 -> a dimensão precisa
 * ser múltipla de 16. 1080 (o preset antigo da UI) NÃO é: 1080/16 = 67,5, e
 * o modelo arredonda por dentro, o que degrada o resultado.
 *
 * Comparação medida na RTX 4090, mesmo prompt e seed:
 *   1080x1080 / 20 steps -> fogo virava um brilho difuso, equipe sem forma (19s)
 *   1344x896  / 28 steps -> chamas com forma, palmeiras e pessoas definidas (25s)
 * 6 segundos a mais por uma diferença enorme de qualidade.
 */
export function snapToFluxGrid(value: number): number {
  return Math.max(256, Math.round(value / 16) * 16);
}

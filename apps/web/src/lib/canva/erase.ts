/**
 * Matemática da borracha, isolada do Fabric pra ser testável sem navegador.
 *
 * Dois modos de apagar (pedido explícito: "borracha real", nunca pincel
 * pintado de branco):
 *
 * - PATHS (traços de pincel): apagar = remover o objeto inteiro. O hit-test
 *   é por proximidade: o círculo da borracha contra a caixa do objeto.
 * - IMAGENS: apagar = furar o bitmap com destination-out numa cópia offscreen
 *   e subir o resultado como asset novo. Pra isso o ponteiro (coords de
 *   documento) precisa virar pixel do bitmap - as contas daqui.
 */

export type EraseTargetKind = 'path' | 'image' | null;

/** Só paths e imagens são apagáveis; texto/forma/grupo ficam intocados. */
export function classifyEraseTarget(type: string | undefined | null): EraseTargetKind {
  if (type === 'path') return 'path';
  if (type === 'image') return 'image';
  return null;
}

/** O círculo da borracha toca a caixa (bounding rect em coords de documento)? */
export function circleIntersectsRect(
  circle: { x: number; y: number; radius: number },
  rect: { left: number; top: number; width: number; height: number },
): boolean {
  const closestX = Math.min(Math.max(circle.x, rect.left), rect.left + rect.width);
  const closestY = Math.min(Math.max(circle.y, rect.top), rect.top + rect.height);
  const dx = circle.x - closestX;
  const dy = circle.y - closestY;
  return dx * dx + dy * dy <= circle.radius * circle.radius;
}

/**
 * Ponto local do objeto (origem no CENTRO, que é o espaço que a inversa de
 * `calcTransformMatrix()` do Fabric devolve) -> pixel do bitmap de trabalho.
 *
 * O canvas offscreen da borracha tem exatamente o tamanho da janela-fonte da
 * imagem (`width`/`height` do objeto, que em Fabric.Image são pixels-fonte
 * depois do crop), então aqui é só deslocar meia dimensão. O crop em si já
 * foi aplicado ao copiar o bitmap (drawImage com a janela cropX/cropY).
 */
export function localToBitmapPoint(
  local: { x: number; y: number },
  window: { width: number; height: number },
): { x: number; y: number } {
  return { x: local.x + window.width / 2, y: local.y + window.height / 2 };
}

/**
 * Raio da borracha em pixels do BITMAP. A borracha é um círculo no documento;
 * com escala anisotrópica (scaleX != scaleY) ele vira uma elipse no bitmap -
 * devolver os dois raios separados mantém o apagado circular na TELA, que é
 * o que o usuário espera do cursor redondo.
 */
export function eraserRadii(widthDocPx: number, scaleX: number, scaleY: number): { rx: number; ry: number } {
  const meio = widthDocPx / 2;
  const sx = Math.abs(scaleX) || 1;
  const sy = Math.abs(scaleY) || 1;
  return { rx: meio / sx, ry: meio / sy };
}

/**
 * Pontos intermediários entre duas posições de arrasto, pra borrachada
 * contínua: sem isto, mover rápido apagaria bolhas separadas em vez de uma
 * faixa. O passo é metade do menor raio (sobreposição generosa de propósito -
 * destination-out é idempotente, apagar duas vezes o mesmo pixel não custa
 * nada além do desenho).
 */
export function interpolateErasePoints(
  from: { x: number; y: number },
  to: { x: number; y: number },
  rx: number,
  ry: number,
): { x: number; y: number }[] {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const passo = Math.max(1, Math.min(rx, ry) / 2);
  const quantos = Math.max(1, Math.ceil(dist / passo));
  const pontos: { x: number; y: number }[] = [];
  for (let i = 1; i <= quantos; i += 1) {
    const t = i / quantos;
    pontos.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  }
  return pontos;
}

/**
 * Tolerância de encaixe (snap) e escolha do alvo.
 *
 * O defeito que isto corrige: a tolerância era fixa em PIXELS DE DOCUMENTO
 * (`SNAP_THRESHOLD = 6`). Como o zoom é um `scale()` visual, 6px de documento
 * valem 1,5px na tela a 25% (o encaixe parece morto, ninguém consegue mirar)
 * e 24px a 400% (o objeto "cola" longe demais e fica difícil posicionar com
 * precisão justamente quando o usuário deu zoom PARA ter precisão).
 *
 * A sensação de encaixe é um fenômeno de TELA: o usuário mira com o mouse,
 * que se move em pixels de tela. Então a tolerância é definida em tela e
 * convertida para documento dividindo pelo zoom.
 */

/** Distância em pixels de TELA dentro da qual o objeto encaixa. */
export const SCREEN_SNAP_TOLERANCE = 7;

export function snapTolerance(zoom: number): number {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return SCREEN_SNAP_TOLERANCE / z;
}

export interface Candidato {
  /** Onde a borda/centro do objeto deve ficar. */
  posicao: number;
  /** Coordenada da guia a desenhar. */
  guia: number;
}

/**
 * Melhor encaixe para um valor entre vários alvos.
 *
 * Escolhe o de MENOR deslocamento dentro da tolerância, em vez do primeiro
 * que casar: com centro do artboard e borda de outro objeto competindo, a
 * ordem do array decidiria o encaixe, e o resultado mudaria conforme a ordem
 * de criação dos objetos - que é justamente o "snap caótico".
 */
export function melhorEncaixe(
  valores: { atual: number; posicaoSeEncaixar: (alvo: number) => number }[],
  alvos: number[],
  tolerancia: number,
): Candidato | null {
  let melhor: (Candidato & { distancia: number }) | null = null;
  for (const alvo of alvos) {
    for (const { atual, posicaoSeEncaixar } of valores) {
      const distancia = Math.abs(atual - alvo);
      if (distancia > tolerancia) continue;
      if (melhor === null || distancia < melhor.distancia) {
        melhor = { posicao: posicaoSeEncaixar(alvo), guia: alvo, distancia };
      }
    }
  }
  return melhor ? { posicao: melhor.posicao, guia: melhor.guia } : null;
}

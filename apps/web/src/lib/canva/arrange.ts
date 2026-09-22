/**
 * Alinhamento e distribuição — lógica pura, em coordenadas de DOCUMENTO.
 *
 * Fica fora do hook de propósito: é a parte que precisa estar certa
 * independentemente de zoom, pan ou de qual biblioteca desenha. Um erro aqui
 * é do tipo que passa despercebido (tudo "quase" alinhado) e só aparece
 * quando alguém mede a peça exportada.
 *
 * Todas as funções recebem e devolvem caixas em unidades do documento. Se
 * alguma vier de coordenada de tela, o resultado muda com o zoom - e é
 * exatamente isso que não pode acontecer.
 */

export interface Caixa {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export type AlinhamentoHorizontal = 'left' | 'center' | 'right';
export type AlinhamentoVertical = 'top' | 'middle' | 'bottom';
export type Alinhamento = AlinhamentoHorizontal | AlinhamentoVertical;

export function ehHorizontal(a: Alinhamento): a is AlinhamentoHorizontal {
  return a === 'left' || a === 'center' || a === 'right';
}

/** Menor retângulo que contém todas as caixas. */
export function envelope(caixas: Caixa[]): { left: number; top: number; right: number; bottom: number } {
  const left = Math.min(...caixas.map((c) => c.left));
  const top = Math.min(...caixas.map((c) => c.top));
  const right = Math.max(...caixas.map((c) => c.left + c.width));
  const bottom = Math.max(...caixas.map((c) => c.top + c.height));
  return { left, top, right, bottom };
}

/**
 * Alinha as caixas entre si.
 *
 * Com UMA caixa só, alinhar "entre si" não quer dizer nada - a referência
 * vira o artboard, que é o que o usuário espera ao clicar "centralizar" com
 * um objeto selecionado. Por isso `artboard` é opcional mas necessário nesse
 * caso; sem ele, uma seleção única não se move.
 */
export function alinhar(
  caixas: Caixa[],
  como: Alinhamento,
  artboard?: { width: number; height: number },
): Record<string, { left?: number; top?: number }> {
  if (caixas.length === 0) return {};

  const ref =
    caixas.length === 1 && artboard
      ? { left: 0, top: 0, right: artboard.width, bottom: artboard.height }
      : envelope(caixas);

  const resultado: Record<string, { left?: number; top?: number }> = {};
  for (const caixa of caixas) {
    switch (como) {
      case 'left':
        resultado[caixa.id] = { left: ref.left };
        break;
      case 'center':
        resultado[caixa.id] = { left: ref.left + (ref.right - ref.left - caixa.width) / 2 };
        break;
      case 'right':
        resultado[caixa.id] = { left: ref.right - caixa.width };
        break;
      case 'top':
        resultado[caixa.id] = { top: ref.top };
        break;
      case 'middle':
        resultado[caixa.id] = { top: ref.top + (ref.bottom - ref.top - caixa.height) / 2 };
        break;
      case 'bottom':
        resultado[caixa.id] = { top: ref.bottom - caixa.height };
        break;
    }
  }
  return resultado;
}

/**
 * Distribui o espaço ENTRE as caixas de forma uniforme.
 *
 * Distribui o vão, não o centro: com objetos de tamanhos diferentes,
 * espaçar centros deixa os intervalos visuais visivelmente desiguais, que é
 * o defeito clássico dessa função. Os extremos não se movem - eles definem o
 * espaço disponível.
 *
 * Precisa de 3+ caixas: com 2, não existe nada entre elas para distribuir.
 */
export function distribuir(caixas: Caixa[], eixo: 'horizontal' | 'vertical'): Record<string, { left?: number; top?: number }> {
  if (caixas.length < 3) return {};

  const horizontal = eixo === 'horizontal';
  const ordenadas = [...caixas].sort((a, b) => (horizontal ? a.left - b.left : a.top - b.top));
  const primeiro = ordenadas[0]!;
  const ultimo = ordenadas[ordenadas.length - 1]!;

  const inicio = horizontal ? primeiro.left : primeiro.top;
  const fim = horizontal ? ultimo.left + ultimo.width : ultimo.top + ultimo.height;
  const somaTamanhos = ordenadas.reduce((total, c) => total + (horizontal ? c.width : c.height), 0);
  const vaoTotal = fim - inicio - somaTamanhos;
  const vao = vaoTotal / (ordenadas.length - 1);

  const resultado: Record<string, { left?: number; top?: number }> = {};
  let cursor = inicio;
  for (const caixa of ordenadas) {
    resultado[caixa.id] = horizontal ? { left: cursor } : { top: cursor };
    cursor += (horizontal ? caixa.width : caixa.height) + vao;
  }
  return resultado;
}

/**
 * Reordena a lista de camadas movendo um item para outra posição.
 *
 * A ordem do array É o z-index (o índice 0 é o fundo). Manter um campo
 * `zIndex` separado e a ordem do array como duas verdades é o caminho certo
 * para elas divergirem; aqui a política é uma só: a posição na lista manda, e
 * `zIndex` é reatribuído a partir dela.
 */
export function reordenar<T extends { id: string }>(itens: T[], de: number, para: number): T[] {
  if (de === para || de < 0 || de >= itens.length || para < 0 || para >= itens.length) return itens;
  const copia = [...itens];
  const [movido] = copia.splice(de, 1);
  copia.splice(para, 0, movido!);
  return copia;
}

/**
 * Move um conjunto de itens dentro da pilha.
 *
 * As quatro operações de menu (trazer para a frente / avançar / recuar /
 * enviar para trás) e o arrastar no painel de camadas precisam terminar na
 * MESMA transação: dois caminhos que reempilham de jeitos diferentes é como
 * a ordem do array e o `zIndex` divergem. Estas funções são só o cálculo da
 * nova ordem; quem aplica é uma função só, no editor.
 *
 * A lista de entrada é sempre FUNDO PRIMEIRO (índice 0 = fundo), que é a
 * mesma convenção da pilha do Fabric e do `zIndex`.
 */
export type MovimentoDePilha = 'front' | 'forward' | 'backward' | 'back';

export function moverNaPilha<T extends { id: string }>(
  itens: T[],
  ids: string[],
  movimento: MovimentoDePilha,
): T[] {
  const alvos = new Set(ids);
  if (alvos.size === 0) return itens;
  const selecionados = itens.filter((i) => alvos.has(i.id));
  if (selecionados.length === 0) return itens;
  const resto = itens.filter((i) => !alvos.has(i.id));

  if (movimento === 'front') return [...resto, ...selecionados];
  if (movimento === 'back') return [...selecionados, ...resto];

  // Um passo de cada vez. Percorrer na direção do movimento evita que dois
  // itens vizinhos selecionados "pulem" um por cima do outro e troquem de
  // ordem relativa entre si - o que faria avançar+recuar não voltar ao
  // mesmo lugar.
  const saida = [...itens];
  const indices = saida.map((i, idx) => ({ i, idx })).filter(({ i }) => alvos.has(i.id)).map(({ idx }) => idx);
  const ordem = movimento === 'forward' ? [...indices].reverse() : indices;
  for (const idx of ordem) {
    const destino = movimento === 'forward' ? idx + 1 : idx - 1;
    if (destino < 0 || destino >= saida.length) continue;
    if (alvos.has(saida[destino]!.id)) continue;
    [saida[idx], saida[destino]] = [saida[destino]!, saida[idx]!];
  }
  return saida;
}

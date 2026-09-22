/**
 * Contexto 2D falso para rodar o Fabric dentro do jsdom.
 *
 * O jsdom não implementa `getContext('2d')` sem o pacote nativo `canvas`, e
 * instalar um binário nativo só para teste não se paga. Nada aqui precisa
 * DESENHAR: os testes que usam isto medem ordem de pilha, coordenadas e
 * serialização — tudo estado do Fabric, não pixel. Por isso cada método é um
 * no-op e só as leituras que o Fabric realmente consulta devolvem valor.
 *
 * Se um dia algum teste precisar de PIXEL de verdade, ele não pode usar este
 * stub: tem que rodar no navegador (Playwright), onde o canvas é real.
 */
const LEITURAS: Record<string, unknown> = {
  measureText: () => ({ width: 0, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }),
  getImageData: (_x: number, _y: number, w = 1, h = 1) => ({
    data: new Uint8ClampedArray(Math.max(1, w) * Math.max(1, h) * 4),
    width: w,
    height: h,
  }),
  createLinearGradient: () => ({ addColorStop() {} }),
  createRadialGradient: () => ({ addColorStop() {} }),
  createPattern: () => null,
  getLineDash: () => [],
  isPointInPath: () => false,
};

export function fakeContext2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const estado: Record<string, unknown> = { canvas, globalAlpha: 1, globalCompositeOperation: 'source-over' };
  return new Proxy(estado, {
    get(alvo, prop: string) {
      if (prop in LEITURAS) return LEITURAS[prop];
      if (prop in alvo) return alvo[prop];
      return () => undefined;
    },
    set(alvo, prop: string, valor) {
      alvo[prop] = valor;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

/** Liga o stub no jsdom. Chamar uma vez por arquivo de teste que use Fabric. */
export function installFakeCanvas2d(): void {
  const proto = globalThis.HTMLCanvasElement?.prototype;
  if (!proto) return;
  proto.getContext = function getContext(this: HTMLCanvasElement, tipo: string) {
    return tipo === '2d' ? fakeContext2d(this) : null;
  } as HTMLCanvasElement['getContext'];
  proto.toDataURL = () => 'data:image/png;base64,';
}

/**
 * Imagem falsa para o jsdom.
 *
 * O jsdom nunca dispara `onload` de um `<img>` (não busca nem decodifica
 * nada), então todo caminho de imagem do editor ficava impossível de testar
 * fora do navegador. Aqui a imagem "carrega" no próximo tick com um tamanho
 * declarado. Continua sem PIXEL: o que dá para provar com isto é o modelo
 * (filtros acumulando, flip, recorte, persistência), não o resultado visual.
 */
export function installFakeImage(largura = 800, altura = 600): void {
  const Original = globalThis.Image;
  class ImagemFalsa {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    crossOrigin: string | null = null;
    naturalWidth = largura;
    naturalHeight = altura;
    width = largura;
    height = altura;
    #src = '';
    get src() { return this.#src; }
    set src(valor: string) {
      this.#src = valor;
      queueMicrotask(() => this.onload?.());
    }
  }
  (globalThis as { Image: unknown }).Image = ImagemFalsa;
  void Original;
}

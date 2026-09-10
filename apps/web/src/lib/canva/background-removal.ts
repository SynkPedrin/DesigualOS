/**
 * Remoção de fundo 100% client-side (modelo ISNet quantizado rodando via
 * WASM/ONNX no navegador, @imgly/background-removal) - sem chave de API,
 * sem servidor próprio, sem custo por chamada. Import dinâmico: a lib +
 * modelo (alguns MB) só baixam quando o usuário de fato clica em "Remover
 * fundo", nunca no bundle inicial do editor.
 */
export async function removeImageBackground(src: string, onProgress?: (key: string, current: number, total: number) => void): Promise<Blob> {
  const { removeBackground } = await import('@imgly/background-removal');
  return removeBackground(src, {
    model: 'isnet_quint8',
    output: { format: 'image/png', quality: 0.9 },
    ...(onProgress ? { progress: onProgress } : {}),
  });
}

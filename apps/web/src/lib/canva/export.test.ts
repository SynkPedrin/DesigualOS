import { describe, expect, it } from 'vitest';
import { dataUrlToPdfBlob, mergeDataUrlsToPdfBlob } from './export';

/** 1x1 PNG transparente - só precisa ser um dataURL válido, o conteúdo do
 * pixel não importa pra estes testes (medem o container PDF, não o pixel). */
const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('exportar como PDF', () => {
  it('empacota uma página num Blob de PDF com o tamanho do artboard', () => {
    const blob = dataUrlToPdfBlob(PNG_1X1, 1080, 1350);
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('empacota várias páginas num único PDF multi-página', () => {
    const blob = mergeDataUrlsToPdfBlob([PNG_1X1, PNG_1X1, PNG_1X1], 1080, 1080);
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(0);
  });
});

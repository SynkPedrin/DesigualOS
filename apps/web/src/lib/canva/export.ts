import JSZip from 'jszip';
import { jsPDF } from 'jspdf';

/** Empacota um PNG/JPEG já renderizado (dataURL) numa página de PDF do
 * exato tamanho do artboard (em px, 1 unidade = 1px @ 72dpi) - sem margem,
 * sem re-amostragem: o PDF só existe pra dar ao design um arquivo que abre
 * fora do navegador com a MESMA resolução que `toDataURL` já produziu. */
export function dataUrlToPdfBlob(dataUrl: string, widthPx: number, heightPx: number): Blob {
  const doc = new jsPDF({
    orientation: widthPx >= heightPx ? 'landscape' : 'portrait',
    unit: 'px',
    format: [widthPx, heightPx],
    hotfixes: ['px_scaling'],
  });
  const format = dataUrl.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG';
  doc.addImage(dataUrl, format, 0, 0, widthPx, heightPx);
  return doc.output('blob');
}

/** Mesma ideia de {@link dataUrlToPdfBlob}, mas uma página de PDF por item -
 * usado por "exportar todas as páginas em PDF" (uma alternativa ao .zip de
 * imagens soltas: um único arquivo que abre em qualquer leitor de PDF). */
export function mergeDataUrlsToPdfBlob(dataUrls: string[], widthPx: number, heightPx: number): Blob {
  const doc = new jsPDF({
    orientation: widthPx >= heightPx ? 'landscape' : 'portrait',
    unit: 'px',
    format: [widthPx, heightPx],
    hotfixes: ['px_scaling'],
  });
  dataUrls.forEach((dataUrl, index) => {
    if (index > 0) doc.addPage([widthPx, heightPx], widthPx >= heightPx ? 'landscape' : 'portrait');
    const format = dataUrl.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG';
    doc.addImage(dataUrl, format, 0, 0, widthPx, heightPx);
  });
  return doc.output('blob');
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Falha ao ler blob'));
    reader.readAsDataURL(blob);
  });
}

/** Mesmo padrão de apps/web/src/lib/zip-download.ts (usado pela Galeria do Studio),
 * mas a partir de blobs já gerados localmente (canvas.toBlob), não de URLs remotas. */
export async function downloadBlobsAsZip(files: { filename: string; blob: Blob }[], zipFilename: string): Promise<void> {
  const zip = new JSZip();
  for (const file of files) zip.file(file.filename, file.blob);

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(zipBlob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = zipFilename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

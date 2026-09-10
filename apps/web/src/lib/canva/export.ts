import JSZip from 'jszip';

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

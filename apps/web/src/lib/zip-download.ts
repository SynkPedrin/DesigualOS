import JSZip from 'jszip';

/**
 * Baixa vários assets (ex: os slides de um carousel) como um único .zip.
 * Tudo client-side: busca cada storageUrl como blob, empacota e dispara o
 * download via blob URL — sem endpoint novo no backend.
 */
export async function downloadAssetsAsZip(
  files: { url: string; filename: string }[],
  zipFilename: string,
): Promise<void> {
  const zip = new JSZip();

  await Promise.all(
    files.map(async (file) => {
      const response = await fetch(file.url);
      if (!response.ok) throw new Error(`Falha ao baixar ${file.filename}`);
      zip.file(file.filename, await response.blob());
    }),
  );

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

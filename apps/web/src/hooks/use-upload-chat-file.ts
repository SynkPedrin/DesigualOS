import { useMutation } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import type { UploadFileResponseWire } from '@/lib/api/contracts';

/** POST /uploads — hospeda o anexo do composer do chat e devolve a URL, que o
 * POST /chat recebe depois no campo `attachment`. Upload separado do envio de
 * propósito: a pessoa anexa, vê o chip pronto e só então manda a mensagem. */
export function useUploadChatFile() {
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return apiFetch<UploadFileResponseWire>('/uploads', { method: 'POST', body: formData });
    },
  });
}

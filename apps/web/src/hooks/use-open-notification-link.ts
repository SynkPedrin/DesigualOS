'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useUiStore } from '@/stores/ui-store';

/** Destino de uma notificação: links do Studio ("/studio?asset=<id>") abrem o
 * StudioModal popup - com a animação de entrada - já na peça, em vez de
 * navegar pra rota. Qualquer outro link segue navegação normal. */
export function useOpenNotificationLink() {
  const router = useRouter();
  const openStudioWithAsset = useUiStore((state) => state.openStudioWithAsset);

  return useCallback(
    (link: string | null) => {
      const target = link ?? '/studio';
      if (target.startsWith('/studio')) {
        const assetId = new URLSearchParams(target.split('?')[1] ?? '').get('asset');
        openStudioWithAsset(assetId);
        return;
      }
      router.push(target);
    },
    [router, openStudioWithAsset],
  );
}

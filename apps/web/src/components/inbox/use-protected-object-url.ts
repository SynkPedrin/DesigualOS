'use client';

import { useEffect, useState } from 'react';
import { apiBlob } from '@/lib/api/client';

/** Mídia da Inbox exige login: baixa com o token e entrega um object URL. */
export function useProtectedObjectUrl(source: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!source) { setUrl(null); return; }
    // Bolha otimista: o arquivo ainda é local (URL.createObjectURL), não está na API.
    if (source.startsWith('blob:')) { setUrl(source); setError(null); setLoading(false); return; }
    let objectUrl: string | null = null;
    let active = true;
    setLoading(true);
    setError(null);
    apiBlob(source).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch((reason) => {
      if (active) setError(reason);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source]);
  return { url, loading, error };
}

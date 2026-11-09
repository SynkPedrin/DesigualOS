'use client';

import { useState } from 'react';
import Image from 'next/image';

/**
 * Foto de perfil dentro de um círculo já posicionado (relative + overflow-hidden). Se a imagem não carrega
 * (arquivo apagado, Storage fora do ar), mostra a inicial em vez do ícone de imagem quebrada.
 */
export function FotoOuInicial({ url, nome }: { url?: string | null | undefined; nome?: string | undefined }) {
  const [falhou, setFalhou] = useState<string | null>(null);
  if (url && falhou !== url) return <Image src={url} alt={nome ?? ''} fill sizes="36px" unoptimized className="object-cover" onError={() => setFalhou(url)} />;
  return <>{(nome ?? '?').charAt(0).toUpperCase()}</>;
}

'use client';

import { useEffect, useState } from 'react';

export function formatarDuracao(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}min` : `${m}min ${String(s % 60).padStart(2, '0')}s`;
}

/** Relógio que anda sozinho a partir de um instante de início. */
export function TempoCorrendo({ desde }: { desde: string }) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 1000); return () => clearInterval(t); }, []);
  return <span className="font-mono tabular-nums">{formatarDuracao(agora - new Date(desde).getTime())}</span>;
}

'use client';

import Image from 'next/image';
import { cn } from '@/lib/utils';

const SIZE_CLASSES = { sm: 'size-6 text-[10px]', md: 'size-9 text-xs', lg: 'size-11 text-sm', xl: 'size-14 text-base' } as const;
const SIZE_PX = { sm: 24, md: 36, lg: 44, xl: 56 } as const;

/** Paleta de fundo+texto com contraste bom, pra quando não há foto/logo real —
 *  nunca cor aleatória a cada render, sempre a MESMA cor pro mesmo nome. */
const PALETTE = [
  'bg-roxo-eletrico text-branco-cru',
  'bg-ametista text-branco-cru',
  'bg-magenta-spark text-branco-cru',
  'bg-info text-branco-cru',
  'bg-agent-otto text-carbono',
  'bg-sinal text-carbono',
  'bg-sucesso text-carbono',
  'bg-aviso text-carbono',
] as const;

function hashParaIndice(texto: string, modulo: number): number {
  let hash = 0;
  for (let i = 0; i < texto.length; i += 1) {
    hash = (hash * 31 + texto.charCodeAt(i)) >>> 0;
  }
  return hash % modulo;
}

function iniciaisDeCliente(name: string): string {
  // "G4 Educação" -> "G4" (primeira palavra inteira se tiver <=2 chars e for
  // alfanumérica, ex. sigla/código); senão primeira+segunda letra inicial.
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const primeira = parts[0]!;
  if (primeira.length <= 2) return primeira.toUpperCase();
  const segunda = parts.length > 1 ? parts[1]!.charAt(0) : '';
  return `${primeira.charAt(0)}${segunda}`.toUpperCase();
}

function iniciaisDePessoa(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : '';
  return `${first}${last}`.toUpperCase();
}

/**
 * Avatar de CLIENTE (quadrado, cor determinística pelo nome — nunca foto: um
 * cliente real não ganha foto inventada) ou de PESSOA (círculo, foto quando
 * `photoUrl` existe, iniciais quando não). Mesmo princípio do
 * `CollaboratorAvatar` (fallback nunca inventa dado, só preenche com o que dá
 * pra derivar do nome), generalizado pra cobrir cliente também — a diferença
 * de forma (quadrado x círculo) é o que distingue "marca" de "gente" no
 * mockup, e mantemos isso aqui em vez de usar o mesmo círculo pros dois.
 */
export function EntityAvatar({
  name,
  photoUrl,
  kind,
  size = 'md',
  className,
}: {
  name: string;
  /** Só faz sentido pra kind='person' — cliente nunca ganha foto fake. */
  photoUrl?: string | null;
  kind: 'client' | 'person';
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
}) {
  const cor = PALETTE[hashParaIndice(name, PALETTE.length)]!;
  const iniciais = kind === 'client' ? iniciaisDeCliente(name) : iniciaisDePessoa(name);
  const temFoto = kind === 'person' && Boolean(photoUrl);

  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden font-mono font-semibold',
        kind === 'client' ? 'rounded-lg' : 'rounded-full',
        SIZE_CLASSES[size],
        !temFoto && cor,
        className,
      )}
    >
      {temFoto ? (
        <Image src={photoUrl!} alt={name} width={SIZE_PX[size]} height={SIZE_PX[size]} unoptimized className="size-full object-cover" />
      ) : (
        iniciais
      )}
    </span>
  );
}

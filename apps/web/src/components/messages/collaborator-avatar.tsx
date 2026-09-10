'use client';

import Image from 'next/image';
import { cn } from '@/lib/utils';

const SIZE_CLASSES = {
  sm: 'size-6 text-[10px]',
  md: 'size-9 text-xs',
  lg: 'size-11 text-sm',
  xl: 'size-14 text-base',
} as const;

const SIZE_PX = { sm: 24, md: 36, lg: 44, xl: 56 } as const;

const DOT_CLASSES = {
  sm: 'size-1.5',
  md: 'size-2.5',
  lg: 'size-3',
  xl: 'size-3.5',
} as const;

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : '';
  return `${first}${last}`.toUpperCase();
}

/**
 * Avatar de pessoa (colaborador/parceiro de thread). Foto via next/image
 * (unoptimized, padrão do projeto); fallback = iniciais num círculo com a cor
 * do ClickUp quando mapeada (cor dinâmica - style inline, não dá pra interpolar
 * classe Tailwind), senão roxo-elétrico. O dot de presença é anelado com
 * carbono pra recortar sobre qualquer superfície.
 */
export function CollaboratorAvatar({
  name,
  avatarUrl,
  clickupColor,
  clickupInitials,
  online,
  size = 'md',
  className,
}: {
  name: string;
  avatarUrl: string | null;
  /** Cor do membro no ClickUp (GET /collaborators), usada no fallback de iniciais. */
  clickupColor?: string | null | undefined;
  /** Iniciais oficiais do ClickUp - preferidas sobre as derivadas do nome. */
  clickupInitials?: string | null | undefined;
  /** true = dot verde; false/null = sem dot (nunca fingimos presença). */
  online?: boolean | null;
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
}) {
  const initials = clickupInitials?.trim() || deriveInitials(name);

  return (
    <span className={cn('relative block shrink-0', className)}>
      <span
        className={cn(
          'relative flex items-center justify-center overflow-hidden rounded-full font-mono font-semibold text-branco-cru ring-1 ring-white/10',
          SIZE_CLASSES[size],
          !avatarUrl && !clickupColor && 'bg-roxo-eletrico',
        )}
        style={!avatarUrl && clickupColor ? { backgroundColor: clickupColor } : undefined}
      >
        {avatarUrl ? (
          <Image src={avatarUrl} alt={name} width={SIZE_PX[size]} height={SIZE_PX[size]} unoptimized className="size-full object-cover" />
        ) : (
          initials
        )}
      </span>
      {online && (
        <span
          aria-label="Online"
          className={cn(
            'absolute -bottom-0.5 -right-0.5 rounded-full bg-sucesso ring-2 ring-carbono',
            DOT_CLASSES[size],
          )}
        />
      )}
    </span>
  );
}

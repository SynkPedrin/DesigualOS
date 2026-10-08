'use client';

import Image from 'next/image';
import { logoDoCliente } from '@/lib/client-logos';
import { cn } from '@/lib/utils';

const SIZE_CLASSES = { sm: 'size-6 text-[10px]', md: 'size-9 text-xs', lg: 'size-11 text-sm', xl: 'size-14 text-base' } as const;

/**
 * Logo é maior que a inicial no MESMO tamanho nominal.
 *
 * Sem moldura nem padding, a marca pode ocupar o espaço inteiro — e ela precisa
 * disso: uma logo encolhida a 24px dentro de um quadrado com borda não é
 * reconhecível, e aí ela não serve pra nada que as iniciais já não fizessem.
 */
const LOGO_SIZE_CLASSES = { sm: 'size-8', md: 'size-12', lg: 'size-14', xl: 'size-20' } as const;
const SIZE_PX = { sm: 32, md: 48, lg: 56, xl: 80 } as const;

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
 * Avatar de CLIENTE (quadrado) ou de PESSOA (círculo). A diferença de forma é
 * o que distingue "marca" de "gente" no mockup, e mantemos isso aqui em vez
 * de usar o mesmo círculo pros dois.
 *
 * Logo real de cliente (08/10/2026): cliente nunca ganhava foto, porque não
 * havia fonte confiável de logo — o fallback de iniciais era o único estado
 * honesto. Agora que o Pedro entregou os logos reais (`client-logos.ts`), o
 * mesmo princípio do `CollaboratorAvatar` passa a valer pros dois: foto
 * quando existe uma de verdade, iniciais quando não — nunca um logo genérico
 * ou um palpite de qual marca é. `photoUrl` continua aceito pra cliente
 * também, caso algum dia venha uma foto por fonte diferente do nome.
 */
export function EntityAvatar({
  name,
  photoUrl,
  kind,
  size = 'md',
  className,
}: {
  name: string;
  photoUrl?: string | null;
  kind: 'client' | 'person';
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
}) {
  const cor = PALETTE[hashParaIndice(name, PALETTE.length)]!;
  const iniciais = kind === 'client' ? iniciaisDeCliente(name) : iniciaisDePessoa(name);
  const fotoResolvida = kind === 'client' ? (photoUrl ?? logoDoCliente(name)) : photoUrl;
  const temFoto = Boolean(fotoResolvida);

  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center font-mono font-semibold',
        // SEM MOLDURA QUANDO HÁ LOGO (08/10/2026). A logo vinha dentro de um
        // quadrado branco com padding: o recorte comia a marca e o fundo claro
        // brigava com a tela escura, então o colaborador precisava LER o nome
        // pra saber de quem era o cliente. Logo existe justamente pra ser
        // reconhecida antes da leitura — a moldura anulava a única função dela.
        //
        // O fallback de iniciais MANTÉM a forma e a cor: ali o quadrado não é
        // enfeite, é o que torna a inicial legível e distinguível.
        temFoto ? 'overflow-visible' : cn('overflow-hidden rounded-lg', cor),
        kind === 'person' && 'overflow-hidden rounded-full',
        temFoto && kind === 'client' ? LOGO_SIZE_CLASSES[size] : SIZE_CLASSES[size],
        className,
      )}
    >
      {temFoto ? (
        <Image
          src={fotoResolvida!}
          alt={name}
          width={SIZE_PX[size]}
          height={SIZE_PX[size]}
          unoptimized
          className={cn('size-full', kind === 'client' ? 'object-contain' : 'object-cover')}
        />
      ) : (
        iniciais
      )}
    </span>
  );
}

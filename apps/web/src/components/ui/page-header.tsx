'use client';

import { usePathname } from 'next/navigation';
import { BrandBanner } from './brand-banner';
import { titleCardVideoFor } from '@/lib/title-card-videos';

/**
 * Cabeçalho de página — de volta ao card de título com vídeo (restaurado em
 * 08/10/2026, pedido direto do Pedro: "esteticamente tava melhor"). Entre
 * 07/10 e 08/10 esta tela passou por uma versão só-texto (BrandBanner "sem
 * consumidor"); essa versão reverteu.
 *
 * Resolvido pela rota, não passado por cada tela: nenhuma chamada de
 * PageHeader precisa mudar pra ganhar o vídeo de fundo — é esse o motivo de
 * reverter aqui dentro em vez de em cada página.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  const pathname = usePathname();
  const videoSrc = titleCardVideoFor(pathname);

  return (
    <BrandBanner className="mb-8 p-6 md:p-8" videoSrc={videoSrc}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          {eyebrow && (
            <p className="mb-1 font-mono text-xs uppercase tracking-wider text-sinal">{eyebrow}</p>
          )}
          <h1 className="font-display text-4xl font-black uppercase tracking-tight text-branco-cru">
            {title}
          </h1>
          {description && <p className="mt-2 max-w-2xl text-sm text-nevoa">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </BrandBanner>
  );
}

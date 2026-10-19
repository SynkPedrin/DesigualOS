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
  compact = false,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /** Telas de trabalho denso (Pipeline): menos altura, mais conteúdo na dobra. */
  compact?: boolean;
}) {
  const pathname = usePathname();
  const videoSrc = titleCardVideoFor(pathname);

  // GRUDA NO TOPO enquanto a lista rola por baixo. O `pt-8` vem pra cá porque o
  // container de conteúdo perdeu o dele: sem isso, os 32px acima do cabeçalho
  // virariam um vão transparente por onde a lista apareceria passando. O
  // `bg-carbono` fecha esse vão, e o `-mx-8` faz o fundo cobrir a largura toda.
  return (
    <div className={compact ? 'sticky top-0 z-20 -mx-8 bg-carbono px-8 pt-4' : 'sticky top-0 z-20 -mx-8 bg-carbono px-8 pt-8'}>
    <BrandBanner className={compact ? 'mb-4 p-4 md:p-5' : 'mb-8 p-6 md:p-8'} videoSrc={videoSrc}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          {eyebrow && (
            <p className="mb-1 font-mono text-xs uppercase tracking-wider text-sinal">{eyebrow}</p>
          )}
          <h1 className={compact ? 'font-display text-2xl font-black uppercase tracking-tight text-branco-cru' : 'font-display text-4xl font-black uppercase tracking-tight text-branco-cru'}>
            {title}
          </h1>
          {description && <p className={compact ? 'mt-1 max-w-2xl text-xs text-nevoa' : 'mt-2 max-w-2xl text-sm text-nevoa'}>{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </BrandBanner>
    </div>
  );
}

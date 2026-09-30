'use client';

import { ControlHeader, Secao } from '@/components/control/primitives';
import { FeedDeAtividade } from '@/components/control/feed-de-atividade';

/**
 * ATIVIDADE — o mesmo feed da home, sem corte.
 *
 * Fonte real: `/executions`, com o autor que passou a vir junto em 29/09/2026.
 * A API devolve as 50 mais recentes; enquanto não houver paginação, dizer isso
 * é melhor que deixar a pessoa achar que viu tudo.
 */
export default function ActivityPage() {
  return (
    <div className="mx-auto max-w-[1100px]">
      <ControlHeader
        title="Atividade"
        description="Tudo que foi pedido à inteligência, com autor, alvo e desfecho."
      />
      <Secao titulo="Últimas 50 execuções">
        <FeedDeAtividade limite={50} />
        <p className="mt-3 font-mono text-[11px] text-nevoa/70">
          A API devolve as 50 mais recentes. Ainda não há paginação — para histórico completo, use Histórico.
        </p>
      </Secao>
    </div>
  );
}

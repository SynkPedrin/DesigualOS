'use client';

import Link from 'next/link';
import { ArrowRight, Radar, TriangleAlert } from 'lucide-react';
import { useSignals } from '@/hooks/use-signals';

/**
 * O QUE PEDE ATENÇÃO, na primeira coisa que alguém vê.
 *
 * A tela de Sinais resolveu "o sinal chega em uma pessoa". Ficou faltando a
 * parte que decide se ele chega A TEMPO: alerta que só alcança quem sabe clicar
 * em "Sinais" depende de a pessoa já desconfiar que há algo errado — que é
 * justamente o que o alerta existiria pra contar.
 *
 * TRÊS ESTADOS, e a diferença entre eles é o ponto:
 *
 *   nenhum sinal .... não renderiza NADA. O Overview é caro, e um cartão
 *                     dizendo "tudo bem" todo dia é a forma mais rápida de
 *                     ensinar alguém a não olhar pra ele.
 *   há sinais ....... aparece no topo, antes do estado do sistema.
 *   falhou a leitura  aparece uma linha discreta dizendo isso — porque sumir
 *                     em silêncio depois de um erro comunica "nada pendente",
 *                     que é uma afirmação que ninguém verificou.
 *
 * O terceiro estado é o que não podia faltar. É o mesmo defeito de "não sei"
 * virando "zero", só que aqui viraria "está tudo calmo".
 */
export function SinaisEmAberto() {
  const { data, isPending, isError } = useSignals({ status: 'pending', limite: 5 });

  // Durante a carga não há afirmação a fazer, e um esqueleto no topo do
  // Overview piscaria a cada 30s de refetch.
  if (isPending) return null;

  if (isError) {
    return (
      <div className="mb-8 flex items-center gap-2 rounded-lg border border-grafite-elevado bg-grafite px-4 py-2.5">
        <TriangleAlert size={14} className="shrink-0 text-aviso" />
        <p className="text-[13px] text-nevoa">
          Não consegui ler os sinais. Isto <span className="text-branco-cru">não</span> quer dizer que está tudo
          calmo — quer dizer que não deu pra olhar.
        </p>
      </div>
    );
  }

  const total = data?.total ?? 0;
  if (total === 0) return null;

  const criticos = (data?.signals ?? []).filter((s) => s.severity === 'critical' || s.severity === 'high').length;

  return (
    <div className="mb-8 rounded-lg border border-aviso/40 bg-aviso/5 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Radar size={16} className="shrink-0 text-aviso" />
          <p className="font-heading text-sm font-semibold text-branco-cru">
            {total === 1 ? '1 sinal pedindo atenção' : `${total} sinais pedindo atenção`}
            {criticos > 0 && <span className="text-aviso"> · {criticos} de gravidade alta</span>}
          </p>
        </div>
        <Link
          href="/signals"
          className="inline-flex items-center gap-1 font-mono text-[11px] text-nevoa transition-colors hover:text-branco-cru"
        >
          Ver e tratar
          <ArrowRight size={12} />
        </Link>
      </div>

      {/* Os títulos, não só a contagem: "3 sinais" faz adiar, "prazo da Colormaq
        * vence hoje" faz agir. */}
      <ul className="mt-2.5 space-y-1">
        {(data?.signals ?? []).slice(0, 3).map((s) => (
          <li key={s.id} className="truncate text-[13px] text-nevoa">
            · {s.title}
            {s.client_name && <span className="text-nevoa/70">, {s.client_name}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

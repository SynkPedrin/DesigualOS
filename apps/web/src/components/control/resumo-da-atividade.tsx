'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useActivity } from '@/hooks/use-activity';

/**
 * O RESUMO DA ATIVIDADE — por fonte e por cliente.
 *
 * Os dois recortes vêm AGREGADOS DO SERVIDOR, sobre a tabela inteira, nunca
 * calculados sobre os eventos que a linha do tempo acabou de baixar. A
 * listagem traz algumas dezenas por vez: "quem mais aparece nesses" é uma
 * amostra da janela mais recente, e um ranking montado assim muda a cada
 * rolagem e aponta o cliente errado com a mesma confiança de um dado certo.
 *
 * O mockup (assets/TELASS - TUTORIAL/tela-atividade.png) mostra também uma
 * variação "+12% vs. semana anterior" em cima do total. Ela NÃO está aqui:
 * comparar com a semana anterior exige uma segunda janela que a rota não
 * consulta, e inventar a porcentagem seria exatamente o tipo de número que
 * alguém olha pra decidir se a operação acelerou.
 */

/** Cor por fonte, estável — a mesma fonte tem a mesma cor em toda a tela. */
const COR_DA_FONTE: Record<string, { ponto: string; barra: string; texto: string }> = {
  clickup: { ponto: 'bg-roxo-eletrico', barra: 'bg-roxo-eletrico', texto: 'text-roxo-eletrico' },
  bento: { ponto: 'bg-sinal', barra: 'bg-sinal', texto: 'text-sinal' },
  claude: { ponto: 'bg-aviso', barra: 'bg-aviso', texto: 'text-aviso' },
  notion: { ponto: 'bg-info', barra: 'bg-info', texto: 'text-info' },
};
const COR_PADRAO = { ponto: 'bg-nevoa', barra: 'bg-nevoa', texto: 'text-nevoa' };

function corDa(fonte: string | null) {
  return COR_DA_FONTE[(fonte ?? '').toLowerCase()] ?? COR_PADRAO;
}

function rotuloDa(fonte: string | null) {
  if (!fonte) return 'Outros';
  return fonte.charAt(0).toUpperCase() + fonte.slice(1);
}

export function ResumoDaAtividade({ limite = 60 }: { limite?: number }) {
  const { data, isPending, isError } = useActivity({ limite });

  const fontes = useMemo(() => {
    const linhas = data?.sources ?? [];
    const total = linhas.reduce((s, f) => s + f.total, 0);
    return {
      total,
      itens: [...linhas]
        .sort((a, b) => b.total - a.total)
        .map((f) => ({
          chave: f.source ?? 'outros',
          rotulo: rotuloDa(f.source),
          total: f.total,
          /** Sem total não há percentual — e 0% afirmaria que a fonte não participa. */
          proporcao: total > 0 ? f.total / total : null,
          cor: corDa(f.source),
        })),
    };
  }, [data]);

  if (isPending) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg border border-grafite-elevado bg-grafite/40" />
        ))}
      </div>
    );
  }

  // Erro aqui não some com a linha do tempo abaixo: o resumo é acessório, e
  // perder a lista de atividades porque o agregado falhou seria trocar o que
  // importa pelo que enfeita.
  if (isError || fontes.total === 0) return null;

  const clientes = data?.clientes ?? [];
  const maiorCliente = clientes[0]?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {fontes.itens.slice(0, 4).map((f) => (
          <div
            key={f.chave}
            className="rounded-lg border border-grafite-elevado bg-grafite/60 px-4 py-3 transition-colors hover:border-roxo-eletrico/40"
          >
            <div className="flex items-center gap-2">
              <span className={cn('size-2 rounded-full', f.cor.ponto)} />
              <p className="font-mono text-[10px] uppercase tracking-wider text-nevoa">{f.rotulo}</p>
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <p className="font-heading text-2xl font-semibold tabular-nums text-branco-cru">{f.total}</p>
              {f.proporcao !== null && (
                <span className={cn('text-xs font-medium', f.cor.texto)}>{Math.round(f.proporcao * 100)}%</span>
              )}
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-carbono">
              <div className={cn('h-full rounded-full', f.cor.barra)} style={{ width: `${(f.proporcao ?? 0) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>

      {clientes.length > 0 && (
        <div className="rounded-lg border border-grafite-elevado bg-grafite/60 p-4">
          <div className="flex items-baseline justify-between">
            <h3 className="font-heading text-sm font-semibold text-branco-cru">Clientes mais ativos</h3>
            <span className="font-mono text-[10px] uppercase tracking-wider text-nevoa">{fontes.total} atividades no total</span>
          </div>
          <ul className="mt-3 space-y-2.5">
            {clientes.map((c) => (
              <li key={c.client_id ?? c.client_name ?? 'sem'} className="flex items-center gap-3">
                <span className="w-40 shrink-0 truncate text-sm text-branco-cru">{c.client_name ?? 'Sem cliente'}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-carbono">
                  <div
                    className="h-full rounded-full bg-roxo-eletrico"
                    style={{ width: `${maiorCliente > 0 ? (c.total / maiorCliente) * 100 : 0}%` }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-nevoa">{c.total}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

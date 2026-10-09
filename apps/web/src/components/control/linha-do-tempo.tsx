'use client';

import { useMemo, useState } from 'react';
import { LinhasFantasma, SemNadaAinda } from '@/components/control/primitives';
import { useActivity } from '@/hooks/use-activity';
import { apresentarAtividade, horaLocal, rotuloDoDia } from '@/lib/apresentacao/atividade';
import { origemHumana } from '@/lib/apresentacao/conhecimento';

/**
 * A LINHA DO TEMPO DA OPERAÇÃO — quem fez o quê, em qual cliente, quando.
 *
 * Toda tradução vem de `apresentacao/atividade.ts`. Este componente não decide
 * o que escrever: ele desenha. Se a frase estiver errada, o conserto é lá, e
 * vale para a home, para a ficha do cliente e para a página da equipe de uma
 * vez — foi por isso que a tradução saiu do componente.
 *
 * O QUE ESTA TELA AINDA NÃO CONSEGUE DIZER, e está dito aqui para não parecer
 * decisão de design: 872 dos 902 eventos são de tarefa do ClickUp e guardam
 * apenas `{event, list_id}`. Sem nome de tarefa, sem status anterior, sem
 * pessoa. A frase sai "Atualizou uma tarefa" porque é só isso que foi gravado
 * — e inventar "Tammy mudou para Em aprovação" seria falsificar autoria e
 * conteúdo ao mesmo tempo.
 */
export function LinhaDoTempo({ limite = 50, clientId }: { limite?: number; clientId?: string }) {
  const [fonte, setFonte] = useState<string | null>(null);
  const { data, isPending, isError } = useActivity({
    limite,
    ...(clientId ? { clientId } : {}),
    ...(fonte ? { source: fonte } : {}),
  });

  const porDia = useMemo(() => {
    const grupos = new Map<string, Array<{ chave: string; quando: Date; a: ReturnType<typeof apresentarAtividade> }>>();
    for (const e of data?.events ?? []) {
      const apresentada = apresentarAtividade({
        source: e.source,
        type: e.type,
        summary: e.summary,
        actor: e.actor,
        clientName: e.client_name,
        payload: e.payload,
      });
      // Ruído de integração não compete com o trabalho da equipe.
      if (!apresentada.visivelNaTimeline) continue;
      if (!e.occurred_at) continue;
      const quando = new Date(e.occurred_at);
      const dia = rotuloDoDia(quando);
      const lista = grupos.get(dia) ?? [];
      lista.push({ chave: e.id, quando, a: apresentada });
      grupos.set(dia, lista);
    }
    return [...grupos.entries()];
  }, [data]);

  if (isPending) return <LinhasFantasma linhas={6} />;
  if (isError) {
    return (
      <SemNadaAinda
        titulo="Não consegui ler a atividade"
        explicacao="A consulta falhou. Isto não quer dizer que nada aconteceu, quer dizer que não deu para olhar agora."
      />
    );
  }

  const fontes = (data?.sources ?? []).filter((f) => f.source);

  return (
    <div>
      {fontes.length > 1 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-[13px]">
          <Pilula ativa={fonte === null} onClick={() => setFonte(null)}>
            Tudo
          </Pilula>
          {fontes.map((f) => (
            <Pilula key={f.source} ativa={fonte === f.source} onClick={() => setFonte(f.source!)}>
              {origemHumana(f.source)} <span className="text-nevoa/60">{f.total}</span>
            </Pilula>
          ))}
        </div>
      )}

      {porDia.length === 0 ? (
        <SemNadaAinda
          titulo="Ainda não há atividade registrada"
          explicacao="Quando a equipe trabalhar no ClickUp ou no Claude conectado, o que acontecer aparece aqui."
        />
      ) : (
        <div className="space-y-7">
          {porDia.map(([dia, itens]) => (
            <section key={dia}>
              <h3 className="mb-3 text-[13px] font-medium text-nevoa">{dia}</h3>
              <div className="space-y-2.5">
                {itens.map(({ chave, quando, a }) => (
                  <article
                    key={chave}
                    className="flex gap-3 rounded-lg border border-grafite-elevado bg-grafite px-4 py-3"
                  >
                    <time className="w-11 shrink-0 pt-0.5 text-[13px] tabular-nums text-nevoa">{horaLocal(quando)}</time>
                    <div className="min-w-0">
                      <p className="text-[13px] text-nevoa">
                        <span className="text-branco-cru">{a.ator.rotulo}</span> · {a.origem}
                        {a.cliente && <span className="text-nevoa"> · {a.cliente}</span>}
                      </p>
                      <p className="mt-0.5 text-[14px] text-branco-cru">{a.titulo}</p>
                      {a.descricao && <p className="mt-1 text-[13px] leading-relaxed text-nevoa">{a.descricao}</p>}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function Pilula({
  ativa,
  onClick,
  children,
}: {
  ativa: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativa}
      className={[
        'rounded-full border px-3 py-1 transition-colors',
        ativa
          ? 'border-roxo-eletrico/60 bg-roxo-eletrico/15 text-branco-cru'
          : 'border-grafite-elevado text-nevoa hover:text-branco-cru',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

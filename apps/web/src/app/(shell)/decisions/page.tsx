'use client';

import { useState } from 'react';
import { ControlHeader, LinhasFantasma, Secao, SemNadaAinda, StatusDot } from '@/components/control/primitives';
import { useEpisodes, useEpisodeTypes, type Episodio } from '@/hooks/use-episodes';

/**
 * O QUE A OPERAÇÃO FECHOU — decisão, preferência, retorno e mudança.
 *
 * ERRO QUE ESTA TELA COMETEU, e que fica escrito porque é o mesmo do dia
 * inteiro em outra roupa: a primeira versão lia `memories` com
 * `kind = 'decision'`. Esse kind não existe. A consulta voltava vazia sempre, e
 * a tela anunciava "nenhuma decisão registrada ainda" com toda a confiança —
 * sobre um banco que tinha 9 decisões, 2 preferências, 2 feedbacks e 1 mudança
 * operacional, guardados em `agent_episodes`.
 *
 * "Não achei" e "não procurei no lugar certo" parecem iguais pra quem lê, e
 * pedem reações opostas. Um faz a pessoa registrar de novo; o outro faz alguém
 * consertar a consulta.
 *
 * OS QUATRO TIPOS APARECEM JUNTOS de propósito. Decisão sem a preferência que a
 * motivou, e sem o feedback que a corrigiu, é metade da história — e é
 * justamente a metade que faz alguém repetir um erro já resolvido.
 */
export default function DecisionsPage() {
  const [tipo, setTipo] = useState<string | null>(null);
  const { data: tipos } = useEpisodeTypes();
  const { data: episodios, isPending, isError } = useEpisodes({ type: tipo, limite: 200 });

  const lista = episodios ?? [];

  return (
    <div className="mx-auto max-w-[1200px]">
      <ControlHeader
        title="Decisões e aprendizados"
        description="O que a operação fechou numa conversa e passou a valer sem ninguém repetir."
      />

      <Secao titulo="Tipo">
        <div className="flex flex-wrap items-center gap-2">
          <Pilula ativa={tipo === null} onClick={() => setTipo(null)}>
            Tudo
          </Pilula>
          {(tipos ?? []).map((t) => (
            <Pilula key={t.type} ativa={tipo === t.type} onClick={() => setTipo(t.type)}>
              {ROTULO[t.type] ?? t.type} <span className="text-nevoa/70">{t.total}</span>
            </Pilula>
          ))}
        </div>
      </Secao>

      <Secao titulo={`${lista.length} registro(s)`}>
        {isPending ? (
          <LinhasFantasma linhas={6} />
        ) : isError ? (
          <SemNadaAinda
            titulo="Não consegui ler os registros"
            explicacao="A consulta falhou. É a API, não o conteúdo — se continuar, vale avisar quem cuida do sistema."
          />
        ) : lista.length === 0 ? (
          <SemNadaAinda
            titulo="Nada fechado ainda neste recorte"
            explicacao="Decisão vira registro quando alguém fecha uma questão no chat — 'tá decidido', 'pode seguir', 'vamos com'. Preferência e correção entram do mesmo jeito."
          />
        ) : (
          <ul className="space-y-2.5">
            {lista.map((e) => (
              <Registro key={e.id} episodio={e} />
            ))}
          </ul>
        )}
      </Secao>
    </div>
  );
}

const ROTULO: Record<string, string> = {
  decision: 'decisão',
  preference: 'preferência',
  feedback: 'retorno',
  operational_change: 'mudança',
};

/** Frases que o aceite deixou gravadas como se fossem decisão de operação. */
const MARCA_DE_TESTE = /\b(marco-\d{4,}|ACEITE-\d{6,}|QA[ -]\w+ \d{6,})\b/;

function Pilula({ ativa, onClick, children }: { ativa: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors',
        ativa
          ? 'border-roxo-eletrico/60 bg-roxo-eletrico/15 text-branco-cru'
          : 'border-grafite-elevado text-nevoa hover:text-branco-cru',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function Registro({ episodio: e }: { episodio: Episodio }) {
  const deTeste = MARCA_DE_TESTE.test(e.summary);

  return (
    <li className="rounded-lg border border-grafite-elevado bg-grafite px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusDot estado={deTeste ? 'desconhecido' : 'ok'} />
        <span className="font-mono text-[10px] uppercase tracking-wider text-nevoa">
          {ROTULO[e.event_type] ?? e.event_type}
        </span>
        {e.client_name && (
          <span className="rounded-full bg-grafite-elevado px-2 py-0.5 font-mono text-[10px] text-nevoa">
            {e.client_name}
          </span>
        )}
        {/*
          * MARCA DE TESTE À VISTA.
          *
          * O aceite do MCP gravou frases como "guarda esta referência:
          * marco-029857" como decisão de PRODUÇÃO. Elas são reais no banco e
          * não são decisões da agência. Apagar não é decisão desta tela;
          * apresentar como decisão de verdade, tampouco.
          */}
        {deTeste && (
          <span className="rounded-full border border-aviso/40 bg-aviso/10 px-2 py-0.5 font-mono text-[10px] text-aviso">
            artefato de teste
          </span>
        )}
      </div>

      <p className="mt-2 text-sm text-branco-cru">{e.summary}</p>

      {e.decisions.length > 0 && e.decisions[0] !== e.summary && (
        <ul className="mt-2 space-y-1">
          {e.decisions.map((d, i) => (
            <li key={i} className="text-sm text-nevoa">
              · {d}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 font-mono text-[10px] text-nevoa">
        {e.occurred_at ? new Date(e.occurred_at).toLocaleString('pt-BR') : '—'}
        {e.author_name && ` · por ${e.author_name}`}
        {e.agent && ` · via ${e.agent}`}
      </p>
    </li>
  );
}

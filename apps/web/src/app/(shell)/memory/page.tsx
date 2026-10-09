'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { apresentarConhecimento } from '@/lib/apresentacao/conhecimento';
import { ControlHeader, LinhasFantasma, Secao, SemNadaAinda, StatusDot, type Estado } from '@/components/control/primitives';
import { useMemories, useMemoryKinds, type MemoriaWire } from '@/hooks/use-memories';

/**
 * O CENTRO DE MEMÓRIA.
 *
 * O que ele responde: o que este sistema acha que sabe, de onde tirou, e se
 * ainda vale. Até hoje (29/09/2026) a resposta não existia em lugar nenhum —
 * a memória era escrita e lida só pelos agentes.
 *
 * O filtro de TIPO vem do banco, não de uma lista fixa no código. Um seletor
 * com dez tipos dos quais oito nunca retornam nada ensina a pessoa a não
 * confiar no filtro; mostrar só o que existe, com a contagem ao lado, ensina o
 * contrário.
 *
 * E APOSENTADO APARECE COMO APOSENTADO. O sistema substitui fato quando alguém
 * corrige ("a praça agora é Birigui"), e o anterior continua na tabela porque o
 * histórico importa. Misturar os dois faria a tela apresentar como verdade o
 * que o sistema já corrigiu — que é exatamente o defeito que a supersessão
 * existe pra evitar.
 */
export default function MemoryPage() {
  const [kind, setKind] = useState<string | null>(null);
  const [incluirAposentadas, setIncluirAposentadas] = useState(false);
  const [busca, setBusca] = useState('');

  const { data: tipos } = useMemoryKinds();
  const {
    data: pagina,
    isPending,
    isError,
  } = useMemories({
    kind,
    status: incluirAposentadas ? 'all' : 'active',
    busca: busca.trim() || undefined,
    limite: 150,
  });

  const memorias = pagina?.memories;
  /**
   * "150 registro(s)" era o que esta tela dizia — pedindo 150, recebendo 150 e
   * chamando isso de total, com 396 visíveis no banco. Nenhuma linha mentia: a
   * tela contava o que tinha na mão. Quem lesse concluiria que o sistema sabe
   * 150 coisas.
   *
   * Agora ela diz a janela E o total, e só fala em janela quando ela de fato
   * corta alguma coisa — "396 de 396" seria ruído com cara de precisão.
   */
  const rotulo = !pagina
    ? 'Registros'
    : pagina.total > pagina.mostrando
      ? `${pagina.mostrando} de ${pagina.total} registro(s), os mais recentes`
      : `${pagina.total} registro(s)`;

  return (
    <div className="mx-auto max-w-[1400px]">
      <ControlHeader
        title="Conhecimento"
        description="O que a empresa sabe sobre cada cliente: contexto, preferências, pessoas, processos e aprendizados."
      />

      <Secao titulo="Filtros">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar no conteúdo"
            className="w-full max-w-xs rounded-md border border-grafite-elevado bg-grafite px-3 py-1.5 text-sm text-branco-cru placeholder:text-nevoa/60 focus:border-roxo-eletrico/60 focus:outline-none"
          />
          <Pilula ativa={kind === null} onClick={() => setKind(null)}>
            Todos
          </Pilula>
          {/*
            * CATEGORIA HUMANA NO FILTRO, não o `kind` do banco.
            *
            * Era `{t.kind}` — a pessoa via "agent.episode" e "client.profile"
            * como opções de filtro. O valor que vai pra API continua sendo o
            * kind: a tradução é de apresentação, e o modelo interno não muda.
            *
            * Os tipos que não são conhecimento (registro de turno, anotação
            * privada, acontecimento) nem viram pílula — ver apresentacao/
            * conhecimento.ts, com o levantamento dos 12 tipos reais.
            */}
          {(tipos ?? [])
            .filter((t) => apresentarConhecimento({ kind: t.kind }).visivelNoProduto)
            .slice(0, 8)
            .map((t) => (
              <Pilula key={t.kind} ativa={kind === t.kind} onClick={() => setKind(t.kind)}>
                {apresentarConhecimento({ kind: t.kind }).categoria}{' '}
                <span className="text-nevoa/70">{t.total}</span>
              </Pilula>
            ))}
          <label className="ml-auto flex cursor-pointer items-center gap-2 font-mono text-[11px] text-nevoa">
            <input
              type="checkbox"
              checked={incluirAposentadas}
              onChange={(e) => setIncluirAposentadas(e.target.checked)}
              className="accent-roxo-eletrico"
            />
            incluir aposentadas
          </label>
        </div>
      </Secao>

      <Secao titulo={rotulo}>
        {isPending ? (
          <LinhasFantasma linhas={8} />
        ) : isError ? (
          <SemNadaAinda
            titulo="Não consegui ler a memória"
            explicacao="A consulta falhou. É a API, não o conteúdo, se continuar, vale avisar quem cuida do sistema."
          />
        ) : (memorias ?? []).length === 0 ? (
          <SemNadaAinda
            titulo="Nada com esses filtros"
            explicacao="Ajuste o tipo ou a busca. Se estiver tudo limpo e ainda assim vazio, o sistema realmente não guardou nada desse recorte."
          />
        ) : (
          <ul className="grid gap-2.5 lg:grid-cols-2">
            {(memorias ?? []).map((m) => (
              <CartaoDeMemoria key={m.id} memoria={m} />
            ))}
          </ul>
        )}
      </Secao>
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

/**
 * O alcance de uma memória, em uma palavra.
 *
 * `USER_PRIVATE` aparece destacado de propósito: quando alguém vê uma anotação
 * privada nesta lista, é porque é DELA — o backend não devolve a de mais
 * ninguém (ver apps/api/src/memories/visibilidade.ts, e o vazamento que a
 * originou). O selo é o que torna isso óbvio em vez de depender de quem lê
 * lembrar da regra.
 */
function SeloDeAlcance({ escopo }: { escopo: string }) {
  const privado = escopo === 'USER_PRIVATE';
  const rotulos: Record<string, string> = {
    AGENCY: 'toda a agência',
    CLIENT: 'este cliente',
    EMPLOYEE: 'uma pessoa',
    DELIVERY_TYPE: 'um tipo de entrega',
    CAMPAIGN: 'uma campanha',
    PROCESS: 'um processo',
    USER_PRIVATE: 'só você',
  };
  return (
    <span
      className={[
        'rounded-full px-2 py-0.5 font-mono text-[10px]',
        privado ? 'bg-roxo-eletrico/15 text-violeta-sutil' : 'bg-grafite-elevado text-nevoa',
      ].join(' ')}
      title={`Alcance: ${escopo}`}
    >
      {rotulos[escopo] ?? escopo}
    </span>
  );
}


/**
 * O TEXTO DA MEMÓRIA — recortado no DOM, inteiro quando se pede.
 *
 * Medido em produção em 08/10/2026: a tela entregava 312 mil caracteres de
 * texto visível e 1724 elementos, levando 5,3s até aparecer. É a tela mais
 * pesada do sistema por uma ordem de grandeza, e o motivo era desperdício
 * puro: o conteúdo INTEIRO de cada memória ia pro DOM, enquanto o
 * `line-clamp-4` mostrava quatro linhas. Memórias longas aqui passam de dois
 * mil caracteres; a tela mostrava duzentos.
 *
 * E o recorte era mudo: o que passava de quatro linhas ficava inalcançável.
 * `line-clamp` esconde, não resume — não havia como ler o resto.
 *
 * O dado já está em memória no cache do React Query. O que pesa é o DOM. Então
 * o padrão é o recorte, e abrir mostra o texto completo sem ida ao servidor —
 * leve por padrão, inteiro quando alguém precisa.
 */
const LIMITE_DE_PREVIA = 600;

function TextoDaMemoria({ conteudo }: { conteudo: string }) {
  const [aberto, setAberto] = useState(false);
  const longo = conteudo.length > LIMITE_DE_PREVIA;

  if (!longo) return <p className="mt-2 whitespace-pre-wrap text-sm text-branco-cru">{conteudo}</p>;

  return (
    <div className="mt-2">
      <p className={cn('whitespace-pre-wrap text-sm text-branco-cru', !aberto && 'line-clamp-4')}>
        {aberto ? conteudo : `${conteudo.slice(0, LIMITE_DE_PREVIA)}…`}
      </p>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="mt-1 font-mono text-[10px] uppercase tracking-wider text-roxo-eletrico transition-colors hover:text-branco-cru"
      >
        {aberto ? 'recolher' : `ver tudo · ${conteudo.length.toLocaleString('pt-BR')} caracteres`}
      </button>
    </div>
  );
}


function CartaoDeMemoria({ memoria: m }: { memoria: MemoriaWire }) {
  const aposentada = m.status !== 'active';
  const estado: Estado = aposentada ? 'desconhecido' : 'ok';
  const quando = m.created_at ? new Date(m.created_at).toLocaleDateString('pt-BR') : 'sem data';

  return (
    <li
      className={[
        'rounded-lg border bg-grafite px-4 py-3',
        aposentada ? 'border-grafite-elevado/60 opacity-70' : 'border-grafite-elevado',
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <StatusDot estado={estado} />
          {/* Categoria, nunca o nome interno do tipo. */}
          <span className="truncate text-[11px] uppercase tracking-wider text-nevoa">
            {apresentarConhecimento({ kind: m.kind, metadata: (m as { metadata?: unknown }).metadata }).categoria}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {/* O ALCANCE vem antes do cliente: é o que diz o tamanho do estrago
           * se esta memória estiver errada. Uma regra "AGENCY" errada contamina
           * toda a operação; uma anotação privada errada incomoda uma pessoa. */}
          {m.mcp_scope && <SeloDeAlcance escopo={m.mcp_scope} />}
          {m.client_name && (
            <span className="rounded-full bg-grafite-elevado px-2 py-0.5 font-mono text-[10px] text-nevoa">
              {m.client_name}
            </span>
          )}
        </span>
      </div>

      <TextoDaMemoria conteudo={m.content} />

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-nevoa">
        <span>{quando}</span>
        {m.author_name && <span>por {m.author_name}</span>}
        {m.source_type && <span>via {m.source_type}</span>}
        {/* Aposentada precisa dizer que foi aposentada. Sem isso ela some no
         * meio das ativas com a única diferença sendo opacidade, que ninguém lê
         * como "isto não vale mais". */}
        {aposentada && <span className="text-aviso">aposentada, não vale mais</span>}
      </div>
    </li>
  );
}

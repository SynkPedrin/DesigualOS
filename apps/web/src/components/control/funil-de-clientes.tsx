'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Surface } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
/**
 * Os tipos vêm de `@/mocks/pipeline` e NÃO de `@desigual-os/types` por um
 * motivo prático: é de lá que `pipeline-resumo.ts` importa o seu
 * `PipelineStage`, e os dois diferem em `clickupStatus` sob
 * `exactOptionalPropertyTypes`. Usar o do pacote de tipos compila em tudo
 * menos na chamada que importa. Alinhar com o consumidor é mais honesto que
 * um cast no meio do caminho; que existam DUAS definições do mesmo conceito
 * é arrumação devida, e não deste commit.
 */
import { PIPELINE_STAGE_COLORS, type PipelineStage, type PipelineStageColor } from '@/mocks/pipeline';
import { usePipelines } from '@/hooks/use-pipelines';
import { formatarCentavos, resumoDoQuadro } from '@/lib/pipeline-resumo';
import { cn } from '@/lib/utils';

/**
 * A cor do estágio é NOME DE TOKEN ("roxo-eletrico"), não cor CSS. Escrever
 * `style={{ backgroundColor: estagio.color }}` compila, passa no typecheck e
 * não pinta nada: o navegador descarta o valor inválido em silêncio.
 *
 * O mapa vive aqui em cópia porque o original está dentro de
 * `app/(shell)/pipeline/page.tsx`, e componente não importa de página. São
 * seis linhas; consolidar os dois num lib é arrumação que vale, mas não no
 * meio de outra entrega e não dentro de arquivo de outra sessão.
 */
const CLASSE_DA_COR: Record<PipelineStageColor, string> = {
  'roxo-eletrico': 'bg-roxo-eletrico',
  info: 'bg-info',
  aviso: 'bg-aviso',
  sinal: 'bg-sinal',
  erro: 'bg-erro',
  ametista: 'bg-ametista',
};

/**
 * O contrato de rede declara `color` como `string`, o domínio como união de
 * seis tokens. Cor que não é da união vira a neutra em vez de quebrar a tela
 * ou pintar nada: quadro criado por versão futura com cor nova continua
 * legível, só sem a cor dela.
 */
export function estagiosDoDominio(stages: Array<{ id: string; label: string; color: string }>): PipelineStage[] {
  // `clickupStatus` fica de fora de propósito: o resumo não o usa, e
  // repassá-lo obrigaria a inventar um valor onde o contrato manda ausência.
  return stages.map((s) => ({
    id: s.id,
    label: s.label,
    color: (PIPELINE_STAGE_COLORS as readonly string[]).includes(s.color)
      ? (s.color as PipelineStageColor)
      : 'roxo-eletrico',
  }));
}

/**
 * O FUNIL DE CLIENTES DA AGÊNCIA, com dado real.
 *
 * Esta seção existia lendo `mockPipelineBoards` atrás de `DEMO_MODE`: quem a
 * escreveu preferiu sumir com ela em produção a exibir funil e faturamento
 * inventados, o que estava certo enquanto não havia rota. Agora `/pipelines`
 * existe, então ela volta valendo.
 *
 * DUAS COISAS QUE ELA NÃO FAZ, e as duas são decisão:
 *
 * 1. Só quadro com `escopo: 'agencia'`. Um colaborador pode ter quadro
 *    PESSOAL de clientes, e somar o dele num painel da agência mostraria
 *    número que só ele deveria ver. A rota já recorta por visibilidade; a
 *    tela não assume isso (alertado pela desigualos-f9, 10/10/2026).
 *
 * 2. Não soma valor que não conseguiu ler. `valor` é texto livre digitado por
 *    quem usa o quadro, e em português ponto é milhar: um parse ingênuo lê
 *    "12.000" como doze. `lerValorEmCentavos` trata isso e devolve `null` pro
 *    ilegível, e aqui o ilegível aparece CONTADO ao lado da soma. Num painel
 *    de valor da agência, "R$ 0" lido como "não há negócio em aberto" quando
 *    era "não consegui ler três cartões" é mentira cara.
 */
/** Mesma travessia dos estágios, do lado do cartão: a rede manda `stage_id`,
 *  o resumo pede `stageId`. Só os dois campos que o resumo lê. */
export function cartoesDoDominio(
  cards: Array<{ stage_id: string; valor: string | null }>,
): Array<{ stageId: string; valor: string | null }> {
  return cards.map((c) => ({ stageId: c.stage_id, valor: c.valor }));
}

export function FunilDeClientes() {
  const { data, isPending, isError } = usePipelines();

  const quadros = (data?.boards ?? []).filter((b) => b.escopo === 'agencia' && b.tipo === 'cliente');

  return (
    <Surface className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-base font-semibold text-branco-cru">Funil de clientes</h2>
        <Link href="/pipeline" className="flex items-center gap-1 font-mono text-[11px] text-nevoa hover:text-branco-cru">
          Abrir pipeline <ArrowRight size={11} />
        </Link>
      </div>

      {isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : isError ? (
        /* Erro NÃO cai no vazio: "nenhum negócio em aberto" por falha de
           leitura é pior que a seção dizer que não conseguiu ler. */
        <p className="py-6 text-center text-sm text-aviso">
          Não consegui ler o pipeline agora, então não dá pra mostrar o funil.
        </p>
      ) : quadros.length === 0 ? (
        <p className="py-6 text-center text-sm text-nevoa">
          Nenhum quadro de clientes da agência ainda. Crie um em Pipeline e ele aparece aqui.
        </p>
      ) : (
        <div className="space-y-5">
          {quadros.map((quadro) => {
            const resumo = resumoDoQuadro(estagiosDoDominio(quadro.stages), cartoesDoDominio(quadro.cards));
            return (
              <div key={quadro.id}>
                <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-branco-cru">{quadro.nome}</p>
                  <p className="font-mono text-[11px] text-nevoa">
                    {resumo.total} cliente{resumo.total === 1 ? '' : 's'} no funil
                    {resumo.somaCentavos > 0 && ` · ${formatarCentavos(resumo.somaCentavos)}`}
                    {resumo.semValor > 0 && ` · ${resumo.semValor} sem valor legível`}
                  </p>
                </div>

                {/* A BARRA É A FORMA DO FUNIL. Uma lista de números diz quantos
                    há em cada etapa; a barra diz ONDE o funil engorda, que é a
                    pergunta de quem gerencia a carteira. */}
                <div className="flex h-2 w-full overflow-hidden rounded-full bg-grafite-elevado">
                  {resumo.estagios.map((e) =>
                    e.proporcao === null || e.quantidade === 0 ? null : (
                      <div
                        key={e.id}
                        className={cn('h-full', CLASSE_DA_COR[e.color])}
                        style={{ width: `${e.proporcao * 100}%` }}
                        title={`${e.label}: ${e.quantidade}`}
                      />
                    ),
                  )}
                </div>

                <ul className="mt-2.5 grid gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
                  {resumo.estagios.map((e) => (
                    <li key={e.id} className="flex items-center gap-2 text-sm">
                      <span className={cn('size-2 shrink-0 rounded-full', CLASSE_DA_COR[e.color])} />
                      <span className={cn('min-w-0 flex-1 truncate', e.quantidade === 0 ? 'text-nevoa/60' : 'text-nevoa')}>
                        {e.label}
                      </span>
                      <span className="shrink-0 tabular-nums text-branco-cru">{e.quantidade}</span>
                      {e.somaCentavos > 0 && (
                        <span className="shrink-0 font-mono text-[11px] text-nevoa">{formatarCentavos(e.somaCentavos)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </Surface>
  );
}

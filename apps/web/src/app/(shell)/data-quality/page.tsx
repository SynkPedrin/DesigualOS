'use client';

import {
  CartaoDeEstado,
  ControlHeader,
  LinhasFantasma,
  Secao,
  SemNadaAinda,
  Tabela,
  Td,
  Th,
  type Estado,
} from '@/components/control/primitives';
import { useDataQuality, type AlertaDeQualidade } from '@/hooks/use-data-quality';
import { useIsMaster } from '@/hooks/use-is-master';

/**
 * QUALIDADE DO DADO.
 *
 * Os defeitos que mais custaram a este produto não foram bugs de código: foram
 * dados que pareciam outra coisa. Fixture contada como cliente, artefato de
 * aceite gravado como decisão de produção, memória sem proveniência, cadastro
 * duplicado. Nenhum quebra nada — todos fazem o sistema responder com
 * confiança uma coisa errada.
 *
 * A tela APONTA e diz o que fazer. Não conserta: merge de cadastro é
 * irreversível, e uma heurística errada custa um cliente real.
 *
 * Alerta zerado NÃO aparece. Zero não é conquista pra exibir — é a ausência do
 * problema, e uma lista de seis linhas verdes treina a pessoa a não ler a tela.
 */
export default function DataQualityPage() {
  const { isMaster } = useIsMaster();
  const { data, isPending, isError, error } = useDataQuality(isMaster);

  if (!isMaster) {
    return (
      <div className="mx-auto max-w-[1100px]">
        <ControlHeader title="Qualidade do dado" />
        <SemNadaAinda
          titulo="Visível só para master"
          explicacao="É uma tela de manutenção do cadastro, não de operação. Isso é o controle de acesso funcionando, não uma tela vazia."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1100px]">
      <ControlHeader
        title="Qualidade do dado"
        description="O que está torto no acervo, medido agora. A tela aponta e diz o que fazer, quem resolve é gente."
      />

      {isPending ? (
        <LinhasFantasma linhas={8} />
      ) : isError ? (
        <SemNadaAinda
          titulo="Não consegui medir o acervo"
          explicacao={`A consulta falhou${error instanceof Error ? ` (${error.message})` : ''}. Sem ela não dá pra afirmar que está tudo certo, ausência de medição não é ausência de problema.`}
        />
      ) : !data ? null : (
        <>
          <Secao titulo="O acervo">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <CartaoDeEstado
                rotulo="Carteira"
                valor={String(data.acervo.carteira)}
                estado="ok"
                detalhe={`${data.acervo.internos} internos · ${data.acervo.fixtures} fixture`}
              />
              <CartaoDeEstado
                rotulo="Memórias"
                valor={String(data.acervo.memorias_producao)}
                estado="ok"
                detalhe={`de ${data.acervo.memorias} no total`}
              />
              <CartaoDeEstado
                rotulo="Episódios"
                valor={String(data.acervo.episodios_producao)}
                estado="ok"
                detalhe={`de ${data.acervo.episodios} no total`}
              />
              <CartaoDeEstado
                rotulo="Pendências"
                valor={String(data.alertas.length)}
                estado={data.alertas.some((a) => a.gravidade === 'ALTO') ? 'atencao' : 'ok'}
                detalhe={data.alertas.length === 0 ? 'nada apontado' : 'ver abaixo'}
              />
            </div>
          </Secao>

          <Secao titulo="Pendências">
            {data.alertas.length === 0 ? (
              <SemNadaAinda
                titulo="Nada apontado nesta medição"
                explicacao="As regras que existem hoje não acharam nada. Não é o mesmo que 'o acervo está perfeito', é o que estas regras alcançam."
              />
            ) : (
              <ul className="space-y-2.5">
                {data.alertas.map((a) => (
                  <Alerta key={a.codigo} alerta={a} />
                ))}
              </ul>
            )}
          </Secao>

          {data.duplicatas.length > 0 && (
            <Secao titulo={`Candidatas a duplicata (${data.duplicatas.length})`}>
              <p className="mb-3 max-w-2xl text-sm text-nevoa">
                Candidatas, não confirmadas. A resolução é manual de propósito: escolher a linha canônica é decisão de
                quem cuida do cadastro, e um merge automático errado custa um cliente real.
              </p>
              <Tabela>
                <thead>
                  <tr>
                    <Th className="w-28">Tipo</Th>
                    <Th>Entidades</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.duplicatas.map((d, i) => (
                    <tr key={i}>
                      <Td>
                        <span className="font-mono text-[11px] text-nevoa">
                          {d.tipo === 'exata' ? 'nome igual' : 'prefixo'}
                        </span>
                      </Td>
                      <Td>{d.entidades.map((e) => e.name).join('  ↔  ')}</Td>
                    </tr>
                  ))}
                </tbody>
              </Tabela>
            </Secao>
          )}

          <p className="font-mono text-[11px] text-nevoa/70">
            Medido em {new Date(data.generated_at).toLocaleString('pt-BR')}.
          </p>
        </>
      )}
    </div>
  );
}

const COR: Record<AlertaDeQualidade['gravidade'], { borda: string; texto: string; rotulo: string }> = {
  ALTO: { borda: 'border-erro/40', texto: 'text-erro', rotulo: 'engana quem lê' },
  MEDIO: { borda: 'border-aviso/40', texto: 'text-aviso', rotulo: 'atrapalha' },
  BAIXO: { borda: 'border-grafite-elevado', texto: 'text-nevoa', rotulo: 'incomoda' },
};

function Alerta({ alerta: a }: { alerta: AlertaDeQualidade }) {
  const cor = COR[a.gravidade];
  return (
    <li className={`rounded-lg border ${cor.borda} bg-grafite px-4 py-3`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`font-heading text-2xl font-semibold ${cor.texto}`}>{a.quantos}</span>
        <span className="text-sm font-medium text-branco-cru">{a.titulo}</span>
        {/* A gravidade em palavra, não em cor sozinha: cor não diz POR QUE
         * aquilo importa, e "engana quem lê" diz. */}
        <span className={`font-mono text-[10px] uppercase tracking-wider ${cor.texto}`}>{cor.rotulo}</span>
      </div>
      <p className="mt-1.5 text-sm text-nevoa">{a.oQueFazer}</p>
      {a.exemplos.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {a.exemplos.map((e, i) => (
            <li key={i} className="truncate font-mono text-[11px] text-nevoa/70">
              · {e}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

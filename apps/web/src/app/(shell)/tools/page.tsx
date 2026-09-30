'use client';

import { ControlHeader, LinhasFantasma, Secao, SemNadaAinda, StatusLabel, Tabela, Td, Th } from '@/components/control/primitives';
import { useMcpStatus } from '@/hooks/use-mcp-status';
import { useFerramentasVivas, type FerramentaViva } from '@/hooks/use-mcp-servidor';

/**
 * FERRAMENTAS — o que a inteligência PODE fazer, e sob qual permissão.
 *
 * O inventário é LIDO do servidor, em `GET {base}/tools`, que é público e tem
 * CORS aberto pro front. Antes era um arquivo gerado do código de `apps/mcp`
 * por script: ele dizia 33 ferramentas e o servidor já servia 35 quando fui
 * conferir. Envelheceu em horas, igual à frase "não publicado" que eu tinha
 * escrito na tela de MCP. Duas vezes o mesmo erro no mesmo dia — afirmar por
 * constante o que dá pra ler.
 *
 * A contagem de chamadas vem do audit_log, por `/mcp/status`. Ferramenta com
 * zero chamada mostra "—", não "0": zero parece medição ("foi usada zero
 * vezes"), o travessão diz o que de fato é o caso — ninguém chamou, e isso não
 * é nota de desempenho dela.
 */
export default function ToolsPage() {
  const { data: mcp } = useMcpStatus();
  const { data: ferramentas, isPending, isError } = useFerramentasVivas(mcp?.base);

  const chamadasPorTool = new Map((mcp?.por_ferramenta ?? []).map((f) => [f.tool, f]));
  const lista = ferramentas ?? [];
  const escrita = lista.filter((f) => f.access === 'WRITE');
  const leitura = lista.filter((f) => f.access === 'READ');
  const usadas = lista.filter((f) => chamadasPorTool.has(f.name)).length;

  return (
    <div className="mx-auto max-w-[1400px]">
      <ControlHeader
        title="Ferramentas"
        description={
          lista.length > 0
            ? `${lista.length} ferramentas servidas pelo MCP: ${leitura.length} de leitura, ${escrita.length} de escrita.`
            : 'O que a inteligência pode fazer pela operação, e sob qual permissão.'
        }
      />

      <Secao titulo="Uso nas últimas 24h">
        {(mcp?.chamadas_24h ?? 0) === 0 ? (
          <SemNadaAinda
            titulo="Nenhuma chamada em 24h"
            explicacao="As ferramentas estão no ar e ninguém as chamou nesta janela. Silêncio, não falha."
          />
        ) : (
          <p className="text-sm text-nevoa">
            <span className="text-branco-cru">{mcp?.chamadas_24h}</span> chamada(s), de{' '}
            <span className="text-branco-cru">{usadas}</span> ferramenta(s) diferentes. As outras{' '}
            {Math.max(lista.length - usadas, 0)} estão no ar e não foram chamadas — o que não é nota de desempenho
            delas.
          </p>
        )}
      </Secao>

      {isPending ? (
        <LinhasFantasma linhas={10} />
      ) : isError || lista.length === 0 ? (
        <SemNadaAinda
          titulo="Não consegui ler as ferramentas do servidor"
          explicacao="O inventário vem do próprio MCP, e ele não respondeu. Prefiro dizer isso a mostrar uma lista antiga: a última que ficou guardada já estava com duas ferramentas a menos que a realidade."
        />
      ) : (
        <>
          <Secao titulo={`Escrita — alteram a operação (${escrita.length})`}>
            <Inventario lista={escrita} chamadas={chamadasPorTool} />
          </Secao>

          <Secao titulo={`Leitura — só consultam (${leitura.length})`}>
            <Inventario lista={leitura} chamadas={chamadasPorTool} />
          </Secao>
        </>
      )}
    </div>
  );
}

function Inventario({
  lista,
  chamadas,
}: {
  lista: FerramentaViva[];
  chamadas: Map<string, { tool: string; total: number; sucesso: number }>;
}) {
  return (
    <Tabela>
      <thead>
        <tr>
          <Th className="w-56">Ferramenta</Th>
          <Th className="w-36">Escopo</Th>
          <Th className="w-28">Chamadas 24h</Th>
          <Th>O que faz</Th>
        </tr>
      </thead>
      <tbody>
        {lista.map((f) => {
          const uso = chamadas.get(f.name);
          return (
            <tr key={f.name}>
              <Td className="whitespace-nowrap font-mono text-[13px]">{f.name}</Td>
              <Td>
                <span
                  className={
                    f.access === 'WRITE' ? 'font-mono text-[11px] text-aviso' : 'font-mono text-[11px] text-nevoa'
                  }
                >
                  {f.scope}
                </span>
              </Td>
              <Td className="font-mono text-[13px]">
                {uso ? (
                  <span>
                    {uso.total}
                    {uso.sucesso < uso.total && (
                      <span className="text-erro"> ({uso.total - uso.sucesso} erro)</span>
                    )}
                  </span>
                ) : (
                  <span className="text-nevoa">—</span>
                )}
              </Td>
              <Td className="text-nevoa">{f.description || '—'}</Td>
            </tr>
          );
        })}
      </tbody>
    </Tabela>
  );
}

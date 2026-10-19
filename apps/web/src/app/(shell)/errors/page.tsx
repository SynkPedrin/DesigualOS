'use client';

import Link from 'next/link';
import { ControlHeader, LinhasFantasma, Secao, SemNadaAinda, StatusLabel, Tabela, Td, Th } from '@/components/control/primitives';
import { useExecutions } from '@/hooks/use-executions';
import { useClients } from '@/hooks/use-clients';
import { AGENT_META } from '@/lib/agent-meta';
import { duracaoMs, formatarDuracao } from '@/lib/control/execucoes';

/**
 * INCIDENTES — o que terminou mal, e a ressalva que impede esta tela de mentir.
 *
 * A listagem de execuções não traz o TEXTO da resposta, e é o texto que separa
 * quebra ("o motor caiu") de recusa segura ("não tenho autorização"). Sem ele,
 * classificar aqui seria adivinhar — e adivinhar nesta tela é exatamente o erro
 * que ela existe pra evitar: mandar alguém consertar o que está certo.
 *
 * Então a tela mostra o que sabe (terminou em falha, quem, quando, quanto
 * demorou) e diz, na cara, que parte dessas linhas é o sistema se comportando.
 * O link leva ao detalhe, onde o texto existe.
 *
 * Quando houver endpoint que devolva o motivo junto, esta tela separa os dois
 * baldes — é o mesmo desenho do saude-do-bento.mts, que faz a separação porque
 * lê a resposta.
 */
export default function ErrorsPage() {
  const { data: execucoes, isPending, isError } = useExecutions();
  const { data: clientes } = useClients();
  const nomePorCliente = new Map((clientes ?? []).map((c) => [c.id, c.name]));

  const falhas = (execucoes ?? []).filter((e) => e.status === 'failed' || e.status === 'cancelled');

  return (
    <div className="mx-auto max-w-[1400px]">
      <ControlHeader
        title="Incidentes"
        description="Execuções que terminaram mal, e o que ainda falta pra separar quebra de recusa aqui."
      />

      <Secao titulo={`${falhas.length} execução(ões) terminaram em falha`}>
        {isPending ? (
          <LinhasFantasma linhas={6} />
        ) : isError ? (
          <SemNadaAinda titulo="Não consegui ler os incidentes" explicacao="A consulta às execuções falhou." />
        ) : falhas.length === 0 ? (
          <SemNadaAinda
            titulo="Nenhuma falha nas últimas 50"
            explicacao="Nada terminou mal na janela que a API devolve. Não é a mesma coisa que 'nunca falhou', é a janela que existe."
          />
        ) : (
          <>
            {/* O aviso vem ANTES da tabela: depois dela, ninguém leria. */}
            <p className="mb-3 rounded-md border border-aviso/30 bg-aviso/5 px-3.5 py-2.5 text-sm text-nevoa">
              Parte destas linhas é o sistema <span className="text-branco-cru">se comportando</span>, recusa por falta
              de permissão, por não identificar a task, por não ter o dado. A listagem não devolve o motivo, então a
              separação entre quebra e recusa exige abrir o detalhe.
            </p>
            <Tabela>
              <thead>
                <tr>
                  <Th className="w-20">Hora</Th>
                  <Th className="w-36">Quem</Th>
                  <Th className="w-24">Via</Th>
                  <Th>Pedido</Th>
                  <Th className="w-36">Cliente</Th>
                  <Th className="w-24">Estado</Th>
                  <Th className="w-20">Tempo</Th>
                  <Th className="w-16" />
                </tr>
              </thead>
              <tbody>
                {falhas.map((e) => {
                  const quando = e.startedAt ?? e.createdAt;
                  return (
                    <tr key={e.executionId}>
                      <Td className="whitespace-nowrap font-mono text-[12px] text-nevoa">
                        {quando
                          ? new Date(quando).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                          : 'sem dado'}
                      </Td>
                      <Td className="truncate">{e.userName ?? 'sem dado'}</Td>
                      <Td className="text-nevoa">{AGENT_META[e.agent]?.label ?? e.agent}</Td>
                      <Td className="truncate font-mono text-[12px] text-nevoa">{e.intent}</Td>
                      <Td className="truncate text-nevoa">
                        {e.clientId ? (nomePorCliente.get(e.clientId) ?? 'sem dado') : 'sem dado'}
                      </Td>
                      <Td>
                        <StatusLabel estado="erro">{e.status}</StatusLabel>
                      </Td>
                      <Td className="font-mono text-[12px] text-nevoa">{formatarDuracao(duracaoMs(e))}</Td>
                      <Td>
                        <Link
                          href={`/history?execution=${encodeURIComponent(e.executionId)}`}
                          className="font-mono text-[11px] text-nevoa underline-offset-2 hover:text-branco-cru hover:underline"
                        >
                          motivo
                        </Link>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Tabela>
          </>
        )}
      </Secao>
    </div>
  );
}

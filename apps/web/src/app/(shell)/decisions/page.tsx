'use client';

import { ControlHeader, LinhasFantasma, Secao, SemNadaAinda, StatusDot, Tabela, Td, Th, type Estado } from '@/components/control/primitives';
import { useMemories } from '@/hooks/use-memories';

/**
 * DECISÕES — o que foi decidido, por quem, e se ainda vale.
 *
 * Não é uma tabela nova: decisão É memória, gravada com um `kind` próprio pelo
 * extrator de episódios quando alguém fecha uma questão no chat ("tá decidido",
 * "pode seguir", "vamos com"). Criar um repositório paralelo só pra esta tela
 * faria duas fontes de verdade sobre a mesma coisa — que é exatamente como o
 * sistema já errou com "frente", tendo duas definições que discordavam.
 *
 * A supersessão é o que torna esta tela útil: quando alguém corrige uma
 * decisão, a anterior se aposenta e aponta pra que a substituiu. Por isso a
 * coluna "substituída" existe, e por isso o padrão é mostrar só o que vale.
 */
export default function DecisionsPage() {
  const { data: decisoes, isPending, isError } = useMemories({ kind: 'decision', status: 'all', limite: 200 });

  const lista = decisoes ?? [];
  const ativas = lista.filter((d) => d.status === 'active');

  return (
    <div className="mx-auto max-w-[1200px]">
      <ControlHeader
        title="Decisões"
        description="O que a operação decidiu, quem decidiu, e o que já foi substituído."
      />

      <Secao titulo={`${ativas.length} em vigor · ${lista.length - ativas.length} substituída(s)`}>
        {isPending ? (
          <LinhasFantasma linhas={6} />
        ) : isError ? (
          <SemNadaAinda titulo="Não consegui ler as decisões" explicacao="A consulta à memória falhou." />
        ) : lista.length === 0 ? (
          <SemNadaAinda
            titulo="Nenhuma decisão registrada ainda"
            explicacao="Decisão vira registro quando alguém fecha uma questão no chat — 'tá decidido', 'pode seguir', 'vamos com'. Até lá, não há o que mostrar, e inventar exemplo aqui seria pior que a tela vazia."
          />
        ) : (
          <Tabela>
            <thead>
              <tr>
                <Th>Decisão</Th>
                <Th className="w-36">Cliente</Th>
                <Th className="w-32">Quem</Th>
                <Th className="w-28">Quando</Th>
                <Th className="w-32">Estado</Th>
              </tr>
            </thead>
            <tbody>
              {lista.map((d) => {
                const ativa = d.status === 'active';
                const estado: Estado = ativa ? 'ok' : 'desconhecido';
                return (
                  <tr key={d.id} className={ativa ? undefined : 'opacity-70'}>
                    <Td className="max-w-xl">{d.content}</Td>
                    <Td className="truncate text-nevoa">{d.client_name ?? '—'}</Td>
                    <Td className="truncate text-nevoa">{d.author_name ?? '—'}</Td>
                    <Td className="font-mono text-[12px] text-nevoa">
                      {d.created_at ? new Date(d.created_at).toLocaleDateString('pt-BR') : '—'}
                    </Td>
                    <Td>
                      <span className="flex items-center gap-1.5 font-mono text-[11px]">
                        <StatusDot estado={estado} />
                        {ativa ? 'em vigor' : 'substituída'}
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Tabela>
        )}
      </Secao>
    </div>
  );
}

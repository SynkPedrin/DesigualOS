'use client';

import { LinhasFantasma, SemNadaAinda, StatusDot, type Estado } from '@/components/control/primitives';
import { useMemories, type MemoriaWire } from '@/hooks/use-memories';

/**
 * O QUE O SISTEMA SABE SOBRE ESTE CLIENTE.
 *
 * É a promessa de "camada de inteligência" aplicada a uma conta: não o que está
 * aberto no ClickUp (isso é a aba ClickUp), mas o que foi APRENDIDO —
 * preferência declarada, restrição, decisão fechada, correção que virou regra.
 *
 * Por que isso importa numa ficha de cliente: quem abre a conta antes de
 * produzir precisa saber o que já foi combinado. Esse conhecimento existia e só
 * o agente enxergava; quem ia escrever a peça descobria a regra depois, pelo
 * retrabalho.
 *
 * O ALCANCE aparece em cada linha porque memória de cliente e memória da
 * agência inteira não pesam igual: uma regra "toda a agência" errada contamina
 * a operação inteira, e a mesma frase escrita como "este cliente" incomoda uma
 * conta. Sem o rótulo, as duas parecem a mesma coisa.
 *
 * Anotação privada de outra pessoa NÃO chega aqui — o backend não devolve (ver
 * apps/api/src/memories/visibilidade.ts, e o vazamento que originou a regra).
 */
export function ClientMemoryPanel({ clientId }: { clientId: string }) {
  const { data: pagina, isPending, isError } = useMemories({ clientId, limite: 60 });

  if (isPending) return <LinhasFantasma linhas={5} />;

  if (isError) {
    return (
      <SemNadaAinda
        titulo="Não consegui ler a memória deste cliente"
        explicacao="A consulta falhou. É a API, não a conta, se continuar, vale avisar quem cuida do sistema."
      />
    );
  }

  const lista = pagina?.memories ?? [];
  if (lista.length === 0) {
    return (
      <SemNadaAinda
        titulo="Nada aprendido sobre este cliente ainda"
        explicacao="Quando alguém corrigir uma entrega, declarar uma preferência ou fechar uma decisão no chat, vira registro e aparece aqui, sem precisar repetir na próxima."
      />
    );
  }

  return (
    <div className="space-y-2.5">
      {/* Janela e total. Um cliente com 200 memórias mostraria 60 e diria
        * "60 registros" — contando o que coube e chamando de tudo. */}
      <p className="font-mono text-[11px] text-nevoa">
        {pagina && pagina.total > pagina.mostrando
          ? `${pagina.mostrando} de ${pagina.total} registro(s), os mais recentes.`
          : `${lista.length} registro(s).`}{' '}
        O que está aqui vale pra próxima entrega sem ninguém repetir.
      </p>
      <ul className="space-y-2">
        {lista.map((m) => (
          <Registro key={m.id} memoria={m} />
        ))}
      </ul>
    </div>
  );
}

const ALCANCE: Record<string, string> = {
  AGENCY: 'toda a agência',
  CLIENT: 'este cliente',
  EMPLOYEE: 'uma pessoa',
  DELIVERY_TYPE: 'um tipo de entrega',
  CAMPAIGN: 'uma campanha',
  PROCESS: 'um processo',
  USER_PRIVATE: 'só você',
};

function Registro({ memoria: m }: { memoria: MemoriaWire }) {
  const aposentada = m.status !== 'active';
  const estado: Estado = aposentada ? 'desconhecido' : 'ok';

  return (
    <li
      className={[
        'rounded-lg border bg-grafite px-3.5 py-2.5',
        aposentada ? 'border-grafite-elevado/60 opacity-70' : 'border-grafite-elevado',
      ].join(' ')}
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusDot estado={estado} />
        <span className="font-mono text-[10px] uppercase tracking-wider text-nevoa">{m.kind}</span>
        {m.mcp_scope && (
          <span className="rounded-full bg-grafite-elevado px-2 py-0.5 font-mono text-[10px] text-nevoa">
            {ALCANCE[m.mcp_scope] ?? m.mcp_scope}
          </span>
        )}
        {/* Aposentada precisa DIZER que não vale mais. Opacidade sozinha ninguém
         * lê como "isto foi corrigido" — e apresentar como verdade o que o
         * sistema já substituiu é o defeito que a supersessão existe pra evitar. */}
        {aposentada && <span className="font-mono text-[10px] text-aviso">não vale mais</span>}
      </div>
      <p className="mt-1.5 text-sm text-branco-cru">{m.content}</p>
      <p className="mt-1 font-mono text-[10px] text-nevoa">
        {m.created_at ? new Date(m.created_at).toLocaleDateString('pt-BR') : 'sem dado'}
        {m.author_name && ` · por ${m.author_name}`}
        {m.source_type && ` · via ${m.source_type}`}
      </p>
    </li>
  );
}

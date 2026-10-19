'use client';

import Link from 'next/link';
import { LinhasFantasma, SemNadaAinda, StatusDot, type Estado } from './primitives';
import { useClients } from '@/hooks/use-clients';
import { useExecutions } from '@/hooks/use-executions';

/**
 * O que o Control Plane GOVERNA: a carteira, e quanto de atividade cada conta
 * teve. É a ponte entre "o sistema está de pé" e "a operação está andando".
 *
 * Fontes reais, as duas: `/clients` e `/executions`. O que NÃO está aqui, de
 * propósito, é o risco por cliente (atrasadas, concentração, sem dono). Esse
 * dado existe e é bom — o Bento apura pela árvore de subtarefas do ClickUp —
 * mas mora no worker e não tem endpoint. Trazer por HTTP agora significaria ou
 * varrer o ClickUp pelo navegador, ou inventar. Fica pra quando existir a rota.
 */
export function ResumoDaOperacao() {
  const { data: clientes, isPending, isError } = useClients();
  const { data: execucoes } = useExecutions();

  if (isPending) return <LinhasFantasma linhas={5} />;

  if (isError) {
    return (
      <SemNadaAinda
        titulo="Não consegui ler a carteira"
        explicacao="A consulta aos clientes falhou. É a API, não a sua operação."
      />
    );
  }

  const lista = clientes ?? [];
  if (lista.length === 0) {
    return (
      <SemNadaAinda
        titulo="Nenhum cliente cadastrado"
        explicacao="Cadastre um cliente pra que o sistema tenha uma operação pra governar."
      />
    );
  }

  // Atividade por cliente, das últimas 50 execuções que a API devolve.
  const porCliente = new Map<string, number>();
  for (const e of execucoes ?? []) {
    if (!e.clientId) continue;
    porCliente.set(e.clientId, (porCliente.get(e.clientId) ?? 0) + 1);
  }

  /**
   * CARTEIRA NÃO É TUDO QUE ESTÁ NA TABELA.
   *
   * A natureza vem do backend (ver ClientSummary.natureza), do MESMO
   * classificador que decide o que entra numa consulta de operação. Sem essa
   * separação, esta tela dizia "58 clientes na carteira" enquanto o Bento
   * respondia 49 — duas contagens da mesma coisa, que é o defeito de
   * credibilidade mais caro que este produto já teve.
   *
   * Fixture sai da contagem; trabalho interno fica, contado à parte: aquelas
   * tarefas são de alguém, e escondê-las trocaria um erro por outro pior.
   */
  const carteira = lista.filter((c) => c.natureza === 'CLIENTE');
  const internos = lista.filter((c) => c.natureza === 'INTERNO');
  const fixtures = lista.filter((c) => c.natureza === 'FIXTURE');

  const ordenados = [...carteira, ...internos]
    .sort((a, b) => (porCliente.get(b.id) ?? 0) - (porCliente.get(a.id) ?? 0) || a.name.localeCompare(b.name))
    .slice(0, 8);

  const semLista = carteira.filter((c) => !c.clickupListId).length;

  return (
    <div className="rounded-lg border border-grafite-elevado bg-grafite">
      <div className="flex items-center justify-between border-b border-grafite-elevado px-4 py-3">
        <p className="text-sm text-branco-cru">
          <span className="font-medium">{carteira.length}</span>
          <span className="text-nevoa"> na carteira</span>
          {internos.length > 0 && <span className="text-nevoa"> · {internos.length} internos</span>}
          {fixtures.length > 0 && <span className="text-nevoa/60"> · {fixtures.length} fixture</span>}
        </p>
        {/* Cliente sem lista do ClickUp é invisível pro sistema: ele existe no
         * cadastro e nenhuma consulta de operação o alcança. Vale dizer na cara,
         * porque é silencioso por natureza. */}
        {semLista > 0 && (
          <span className="font-mono text-[11px] text-aviso">{semLista} sem lista do ClickUp</span>
        )}
      </div>

      <ul className="divide-y divide-grafite-elevado/60">
        {ordenados.map((c) => {
          const chamadas = porCliente.get(c.id) ?? 0;
          const estado: Estado = !c.clickupListId ? 'atencao' : chamadas > 0 ? 'ok' : 'desconhecido';
          return (
            <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
              <StatusDot estado={estado} />
              <Link
                href={`/clients?id=${encodeURIComponent(c.id)}`}
                className="min-w-0 flex-1 truncate text-sm text-branco-cru hover:underline"
              >
                {c.name}
                {c.natureza === 'INTERNO' && (
                  <span className="ml-1.5 font-mono text-[10px] text-nevoa/70">interno</span>
                )}
              </Link>
              <span className="shrink-0 font-mono text-[11px] text-nevoa">
                {!c.clickupListId ? 'sem lista' : chamadas > 0 ? `${chamadas} recente(s)` : 'sem atividade'}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

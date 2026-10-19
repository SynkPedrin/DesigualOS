/**
 * O AGREGADO DA TELA "HOJE" (GET /today/summary, 13/10/2026).
 *
 * A tela disparava treze requisições contra um pool de três conexões e
 * assentava em 8 a 11 segundos. Este contrato é a resposta de UMA chamada que
 * o servidor desdobra nas rotas que já existiam — o agregado não cria dado
 * nenhum, só evita viagem: cada seção carrega exatamente o payload da rota
 * original (`/me`, `/clickup/tasks/me`, `/inbox/threads`, ...).
 *
 * A REGRA INEGOCIÁVEL, nascida de defeito real deste repo:
 *
 *   FALHA PARCIAL NUNCA DERRUBA O RESUMO INTEIRO. Cada seção é um
 *   `ResultadoDeSecao`: ou `ok: true` com os dados, ou `ok: false` com o
 *   status HTTP que a rota original devolveu. Vazio e erro não são a mesma
 *   coisa — uma lista vazia real volta `ok: true` com `[]`, e só uma leitura
 *   que falhou volta `ok: false`. O `status` preservado importa: o 409 de
 *   "ClickUp ainda não vinculado" é um estado esperado com conserto na tela,
 *   não uma falha, e a tela só consegue distinguir os dois porque o número
 *   chega intacto.
 */
export type ResultadoDeSecao<T> =
  | { ok: true; dados: T }
  | { ok: false; status: number };

/**
 * As seções, genéricas de propósito: os tipos wire concretos (thread, demanda,
 * evento...) moram no espelho de contratos de cada app, e aqui entram como
 * parâmetros. A API monta com `unknown` (ela só repassa o JSON da rota de
 * origem); o web instancia com os tipos de `lib/api/contracts.ts`.
 */
export interface SecoesDoResumoDeHoje<TMe, TTarefas, TThreads, TEventos, TAprovacoes, TDemandas, TClientes> {
  me: ResultadoDeSecao<TMe>;
  minhas_tarefas: ResultadoDeSecao<TTarefas>;
  tarefas_da_agencia: ResultadoDeSecao<TTarefas>;
  /** waiting_agency, página de 30 (TETO_DE_PAGINA). */
  conversas_aguardando: ResultadoDeSecao<TThreads>;
  /** waiting_agency + assigned=me, página de 30. */
  conversas_aguardando_minhas: ResultadoDeSecao<TThreads>;
  /** assigned=me sem filtro de status, as 4 do rodapé. */
  conversas_recentes: ResultadoDeSecao<TThreads>;
  /** O intervalo [from, to) vem na query: "hoje" é do fuso de quem olha. */
  eventos_hoje: ResultadoDeSecao<TEventos>;
  aprovacoes_pendentes: ResultadoDeSecao<TAprovacoes>;
  /** ownerId resolvido no servidor — nunca espera o /me pra saber de quem. */
  minhas_demandas: ResultadoDeSecao<TDemandas>;
  clientes: ResultadoDeSecao<TClientes>;
}

export type ResumoDeHoje<
  TMe = unknown,
  TTarefas = unknown,
  TThreads = unknown,
  TEventos = unknown,
  TAprovacoes = unknown,
  TDemandas = unknown,
  TClientes = unknown,
> = SecoesDoResumoDeHoje<TMe, TTarefas, TThreads, TEventos, TAprovacoes, TDemandas, TClientes> & {
  gerado_em: string;
};

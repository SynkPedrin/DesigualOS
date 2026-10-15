import type { PipelineStage, PipelineStageColor } from '@desigual-os/types';

/**
 * quadro-geral.ts — STATUS GERAIS, para os quadros que juntam a agência
 * inteira (15/10/2026, pedido do Pedro: "se a pipeline for de cliente
 * organiza os clientes, se for de tarefas organiza por tarefas; se for de
 * agência mostra de forma geral; se for do colaborador, apenas o que estiver
 * atribuído a ele").
 *
 * Cada lista do ClickUp tem o próprio fluxo de status ("aberto", "to do",
 * "aguardando aprovação", "pronto", "complete"...). Um quadro que junta
 * várias listas não pode ter uma coluna por status de cada uma — então ele
 * fala em CATEGORIAS, e cada status real é traduzido para uma delas.
 *
 * Tudo aqui é puro: a mesma regra serve à sincronização, ao webhook e ao
 * arrastar de cartão, e é testável sem banco nem ClickUp.
 */
export const CATEGORIAS_GERAIS = ['a_fazer', 'em_andamento', 'em_aprovacao', 'concluido'] as const;
export type CategoriaGeral = (typeof CATEGORIAS_GERAIS)[number];

const ROTULO: Record<CategoriaGeral, string> = {
  a_fazer: 'A fazer',
  em_andamento: 'Em andamento',
  em_aprovacao: 'Em aprovação',
  concluido: 'Concluído',
};
const COR: Record<CategoriaGeral, PipelineStageColor> = {
  a_fazer: 'info',
  em_andamento: 'roxo-eletrico',
  em_aprovacao: 'aviso',
  concluido: 'sinal',
};

export function rotuloDaCategoria(categoria: CategoriaGeral): string {
  return ROTULO[categoria];
}

const CONCLUIDO_RE = /conclu[ií]d|complet|encerrad|finaliz|entregue|pronto|publicad|\bdone\b|\bclosed\b|feito/i;
/**
 * "Aguardando aprovação", "revisão", "validação", "feedback do cliente".
 * "Alteração" e "reprovado" NÃO entram: são retrabalho da agência, que volta
 * para a mão de quem faz — ficam em andamento.
 */
const APROVACAO_RE = /aprova[çc][ãa]o|aguardando|revis[ãa]o|valida[çc][ãa]o|feedback|com o cliente/i;
const A_FAZER_RE = /^(to ?do|a fazer|para fazer|aberto|pendente|backlog|novo|n[ãa]o iniciad)/i;

/**
 * Em que categoria geral um status cai. O TIPO do ClickUp manda quando vem
 * (sincronização); só o nome, quando não vem (webhook, que recebe o nome).
 */
export function categoriaDoStatus(status: string | null, tipo: string | null): CategoriaGeral {
  const nome = (status ?? '').trim();
  if (tipo === 'closed' || tipo === 'done') return 'concluido';
  if (CONCLUIDO_RE.test(nome) && tipo !== 'open') return 'concluido';
  if (APROVACAO_RE.test(nome)) return 'em_aprovacao';
  if (tipo === 'open' || A_FAZER_RE.test(nome)) return 'a_fazer';
  return 'em_andamento';
}

const PESO: Record<CategoriaGeral, number> = { a_fazer: 0, em_andamento: 1, em_aprovacao: 2, concluido: 3 };

/**
 * O ESTADO GERAL DE UM CLIENTE pelas tarefas dele: a categoria onde está a
 * maior parte do que está aberto. Empate fica com a menos avançada — o que
 * ainda precisa ser feito pesa mais que o que já andou. Sem nada aberto, o
 * cliente está em dia: "Concluído".
 */
export function categoriaDoCliente(tarefas: ReadonlyArray<{ status: string | null; statusType: string | null }>): CategoriaGeral {
  const contagem: Record<CategoriaGeral, number> = { a_fazer: 0, em_andamento: 0, em_aprovacao: 0, concluido: 0 };
  for (const t of tarefas) {
    const c = categoriaDoStatus(t.status, t.statusType);
    if (c !== 'concluido') contagem[c] += 1;
  }
  const abertas = (['a_fazer', 'em_andamento', 'em_aprovacao'] as const).filter((c) => contagem[c] > 0);
  if (abertas.length === 0) return 'concluido';
  return abertas.reduce((melhor, c) => (contagem[c] > contagem[melhor] || (contagem[c] === contagem[melhor] && PESO[c] < PESO[melhor]) ? c : melhor));
}

/**
 * Rótulos que já dizem a categoria. Só nome inequívoco: num quadro de clientes
 * a coluna "Proposta" é funil comercial, não estágio de trabalho, e não pode
 * virar "em andamento" por exclusão.
 */
function categoriaPeloRotulo(rotulo: string): CategoriaGeral | null {
  const nome = rotulo.trim();
  if (CONCLUIDO_RE.test(nome)) return 'concluido';
  if (APROVACAO_RE.test(nome)) return 'em_aprovacao';
  if (A_FAZER_RE.test(nome) || /^in[ií]cio/i.test(nome)) return 'a_fazer';
  if (/andamento|produ[çc][ãa]o|progresso|fazendo|execu[çc][ãa]o/i.test(nome)) return 'em_andamento';
  return null;
}

/**
 * GARANTE AS QUATRO COLUNAS GERAIS sem apagar o que a pessoa montou.
 *
 * Coluna existente com rótulo inequívoco ganha a categoria (mantendo id,
 * rótulo e cor — os cartões dela continuam onde estão). Categoria que ainda
 * não tem coluna ganha uma nova, no fim. Coluna sem categoria (ex.: "Proposta")
 * fica como está e não é tocada pela organização automática.
 *
 * `soCategorias`: no quadro geral de TAREFAS toda coluna precisa ser uma
 * categoria (é o que o arrastar traduz para status no ClickUp), então o
 * `clickupStatus` antigo sai e coluna que não vira categoria é descartada.
 */
export function garantirEstagiosGerais(stages: readonly PipelineStage[], opcoes: { soCategorias?: boolean } = {}): PipelineStage[] {
  const usadas = new Set<CategoriaGeral>();
  const saida: PipelineStage[] = [];
  for (const s of stages) {
    const categoria = s.categoria && !usadas.has(s.categoria) ? s.categoria : categoriaPeloRotulo(s.clickupStatus ?? s.label);
    if (categoria && !usadas.has(categoria)) {
      usadas.add(categoria);
      // soCategorias: o clickupStatus legado sai da coluna — ela passa a ser
      // só a categoria (é o que o arrastar traduz para status no ClickUp).
      const base = opcoes.soCategorias ? { id: s.id, label: s.label, color: s.color } : s;
      saida.push({ ...base, categoria });
    } else if (!opcoes.soCategorias) {
      // Coluna livre (ex.: "Proposta") fica como está, sem categoria.
      saida.push({ id: s.id, label: s.label, color: s.color, ...(s.clickupStatus !== undefined ? { clickupStatus: s.clickupStatus } : {}) });
    }
  }
  for (const categoria of CATEGORIAS_GERAIS) {
    if (!usadas.has(categoria)) saida.push({ id: `geral-${categoria}`, label: ROTULO[categoria], color: COR[categoria], categoria });
  }
  // Ordem natural do trabalho para as colunas gerais; as livres mantêm a posição relativa.
  return opcoes.soCategorias ? saida.sort((a, b) => PESO[a.categoria!] - PESO[b.categoria!]) : saida;
}

/**
 * TAREFA-ARTEFATO DE TESTE (15/10/2026, Pedro: "tira tudo de QA, que é coisa
 * de testes internos"). A lista "Agência Desigual" é trabalho interno REAL
 * (operação da casa), mas os gates de QA dos agentes despejam nela tarefas
 * que ninguém vai executar: "QA Gate Bento 1790...", "Cliente Teste 7 PEDIDO:",
 * "E2E Claude - pode apagar", "plug2". Padrão apertado e explícito — nome de
 * trabalho de verdade nunca começa assim; se um dia começar, o teste quebra
 * antes de a tarefa sumir do quadro.
 */
const TAREFA_DE_TESTE_RE = /^(qa[ -]?gate\b|cliente teste\b|clinica teste\b|e2e[ -]|plug\d*$)/i;

export function ehTarefaDeTeste(nome: string | null): boolean {
  const n = (nome ?? '').trim();
  if (!n) return false;
  return TAREFA_DE_TESTE_RE.test(n) || /\bpode apagar\b/i.test(n);
}

export function estagioDaCategoria(stages: readonly PipelineStage[], categoria: CategoriaGeral): PipelineStage | null {
  return stages.find((s) => s.categoria === categoria) ?? null;
}

/** Mesma coluna, mesmo rótulo e mesma ordem: não precisa regravar o quadro. */
export function estagiosIguais(a: readonly PipelineStage[], b: readonly PipelineStage[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Ao arrastar no quadro geral: o status REAL da lista da tarefa que
 * corresponde à categoria de destino. O primeiro do fluxo da lista vence
 * (é o "começo" daquela etapa). `null` = a lista não tem status dessa
 * categoria, e o cartão não deve se mover.
 */
export function statusDaListaParaCategoria(
  fluxo: ReadonlyArray<{ status: string; type: string | null }>,
  categoria: CategoriaGeral,
): string | null {
  return fluxo.find((e) => categoriaDoStatus(e.status, e.type) === categoria)?.status ?? null;
}

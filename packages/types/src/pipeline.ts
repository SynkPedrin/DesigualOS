/**
 * PIPELINES — os quadros de trabalho, e de quem é cada um.
 *
 * A regra de propriedade, que é o que separa este módulo de um kanban
 * qualquer: a AGÊNCIA tem pipelines, e CADA PESSOA tem as dela.
 *
 *   ownerId === null   quadro da agência. Todo mundo da empresa vê e mexe.
 *                      É o funil comercial, o quadro que a operação inteira
 *                      acompanha.
 *   ownerId === userId quadro pessoal. Só quem criou vê. É o espaço onde a
 *                      pessoa organiza o próprio trabalho do jeito que
 *                      funciona pra ela, sem negociar a ordem das colunas com
 *                      mais ninguém.
 *
 * Um campo nulo carregando significado exige cuidado na consulta: em SQL,
 * `owner_id = $1` NUNCA é verdadeiro para linha com NULL, então filtrar sem
 * um `IS NULL` explícito faz o quadro da agência sumir para todo mundo, em
 * silêncio. É a mesma armadilha que já escondeu cliente inteiro neste
 * repositório.
 */

export const PIPELINE_TIPOS = ['cliente', 'tarefas', 'colaborador'] as const;
export type PipelineTipo = (typeof PIPELINE_TIPOS)[number];

export const PIPELINE_STAGE_COLORS = ['roxo-eletrico', 'info', 'aviso', 'sinal', 'erro', 'ametista'] as const;
export type PipelineStageColor = (typeof PIPELINE_STAGE_COLORS)[number];

export interface PipelineStage {
  id: string;
  label: string;
  color: PipelineStageColor;
  /**
   * Só para `tipo === 'tarefas'`: o status REAL do ClickUp que esta coluna
   * representa. Mover um cartão muda este status na tarefa — por isso um
   * quadro de tarefas não pode ter coluna com nome inventado.
   */
  /** `| undefined` explícito: o tsconfig usa `exactOptionalPropertyTypes`, e sem
   *  isso o objeto que sai do zod (`string | undefined`) não casa com o tipo. */
  clickupStatus?: string | undefined;
  /**
   * Categoria GERAL (15/10/2026): usada nos quadros que juntam a agência
   * inteira, onde cada lista do ClickUp tem um fluxo próprio. Num quadro de
   * tarefas da agência, mover para esta coluna escreve na tarefa o status da
   * lista dela que cai nesta categoria; num quadro de clientes, é a coluna
   * para onde a sincronização leva o cliente pelo estado das tarefas dele.
   * Ver apps/api/src/pipeline/quadro-geral.ts.
   */
  categoria?: 'a_fazer' | 'em_andamento' | 'em_aprovacao' | 'concluido' | undefined;
}

/** Quem pode ver e mexer num quadro. */
export type PipelineEscopo = 'agencia' | 'pessoal';

export function escopoDoQuadro(ownerId: string | null): PipelineEscopo {
  return ownerId === null ? 'agencia' : 'pessoal';
}

/**
 * Anexo de cartão. `url` aponta pro arquivo já enviado (POST /uploads), nunca
 * pra um `blob:` local — a versão anterior guardava `URL.createObjectURL`, que
 * é um endereço válido só dentro da aba que o criou: o arquivo sumia no
 * recarregamento e nunca existiu pra mais ninguém.
 */
export interface PipelineAnexo {
  id: string;
  nome: string;
  url: string;
  tipo: string;
}

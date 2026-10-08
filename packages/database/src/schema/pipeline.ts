import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { PipelineAnexo, PipelineStage, PipelineTipo } from '@desigual-os/types';
import { idColumn, softDeleteColumn, timestampColumns } from './_shared';
import { organizations } from './organizations';
import { clients } from './clients';
import { users } from './identity';

/**
 * pipeline.ts — os quadros de trabalho, persistidos.
 *
 * A tela de Pipelines existia desde 07/10/2026 com drag-and-drop, criação de
 * quadro, edição de colunas e anexo — tudo em `useState` sobre fixture. Cada
 * recarga apagava o que a pessoa tinha organizado, e em produção a tela nem
 * abria: mostrava "Pipeline ainda não está conectada", porque mostrar funil e
 * faturamento inventados para quem decide pelo número seria pior.
 *
 * A REGRA DE PROPRIEDADE é o centro do modelo:
 *
 *   owner_id IS NULL   quadro da AGÊNCIA — todo mundo da empresa vê e mexe.
 *   owner_id = <user>  quadro PESSOAL — só de quem criou, organizado do jeito
 *                      que funciona pra essa pessoa.
 *
 * Nulo com significado é cômodo e perigoso pelo mesmo motivo: `owner_id = $1`
 * nunca é verdadeiro numa linha NULL, então uma consulta sem `IS NULL`
 * explícito faz o quadro da agência desaparecer para todos sem erro nenhum.
 * O índice abaixo existe para que a consulta certa (empresa + meus + da casa)
 * seja também a rápida.
 */
export const pipelineBoards = pgTable(
  'pipeline_boards',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    /** `null` = quadro da agência. Ver o cabeçalho. */
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    tipo: text('tipo').$type<PipelineTipo>().notNull(),
    /**
     * As colunas, em ordem, como jsonb em vez de tabela própria.
     *
     * Um estágio nunca é lido sem o quadro dele, nunca é referenciado de fora
     * e nunca passa de uma dúzia por quadro. Tabela separada custaria um join
     * em toda leitura e uma transação em toda reordenação de coluna — que é
     * arrastar, a operação mais frequente aqui — para normalizar dado que não
     * tem vida própria. A ordem do array É a ordem na tela.
     */
    stages: jsonb('stages').$type<PipelineStage[]>().notNull().default([]),
    /** Ordem do quadro no seletor. Menor primeiro. */
    posicao: integer('posicao').notNull().default(0),
    ...timestampColumns,
    ...softDeleteColumn,
  },
  (table) => ({
    porDono: index('pipeline_boards_org_owner_idx').on(table.organizationId, table.ownerId),
  }),
);

/**
 * Os cartões. `stage_id` aponta para um `id` dentro do `stages` do quadro —
 * não há FK porque o alvo mora num jsonb, e a rota que apaga uma coluna é a
 * mesma que realoca os cartões dela. Cartão órfão seria cartão invisível, e
 * invisível é pior que errado.
 */
export const pipelineCards = pgTable(
  'pipeline_cards',
  {
    ...idColumn,
    boardId: uuid('board_id').notNull().references(() => pipelineBoards.id, { onDelete: 'cascade' }),
    stageId: text('stage_id').notNull(),
    name: text('name').notNull(),
    /** Cliente ligado ao cartão, quando há. `null` é legítimo: nem todo cartão é de cliente. */
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    /**
     * Só para quadro `tipo='tarefas'`: a tarefa real do ClickUp. É o que faz
     * arrastar o cartão escrever o status LÁ, em vez de só mover um retângulo
     * aqui.
     */
    clickupTaskId: text('clickup_task_id'),
    responsavel: text('responsavel'),
    valor: text('valor'),
    nota: text('nota').notNull().default(''),
    /**
     * Anexos do cartão. jsonb pelo mesmo motivo de `stages`: são sempre lidos
     * com o cartão, nunca referenciados de fora, e poucos por cartão. O
     * ARQUIVO em si vive no storage (POST /uploads); aqui fica só o endereço
     * dele, o nome e o tipo.
     */
    anexos: jsonb('anexos').$type<PipelineAnexo[]>().notNull().default([]),
    /** Ordem dentro da coluna. Menor primeiro. */
    posicao: integer('posicao').notNull().default(0),
    ...timestampColumns,
    ...softDeleteColumn,
  },
  (table) => ({
    porQuadro: index('pipeline_cards_board_stage_idx').on(table.boardId, table.stageId),
    /** Uma tarefa do ClickUp não pode virar dois cartões no mesmo quadro. */
    tarefaUnicaNoQuadro: uniqueIndex('pipeline_cards_board_task_uq')
      .on(table.boardId, table.clickupTaskId)
      .where(sql`clickup_task_id is not null and deleted_at is null`),
  }),
);

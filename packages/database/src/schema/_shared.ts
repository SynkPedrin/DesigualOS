import { timestamp, uuid } from 'drizzle-orm/pg-core';

export const idColumn = {
  id: uuid('id').primaryKey().defaultRandom(),
};

/**
 * `updatedAt` PRECISA do `$onUpdate`: o Drizzle não toca a coluna sozinho num
 * `.update()`, e `defaultNow()` só vale no INSERT. Sem isto a coluna só mudava
 * nas poucas rotas que lembravam de escrever `updatedAt: new Date()` à mão -
 * a maioria não lembrava.
 *
 * Medido no banco real em 18/09/2026, antes da correção:
 *   - conversas: 543 de 663 (82%) com `updated_at` mais VELHO que a última
 *     mensagem delas, a pior defasada em 15 dias. Como GET /conversations
 *     ordena por `updated_at desc` e corta em 50, uma conversa usada hoje
 *     podia simplesmente não aparecer na barra lateral.
 *   - documentos do Canva: 133 de 133 (100%) com `updated_at = created_at`,
 *     todos com conteúdo - ou seja, todos editados depois de criados. A grade
 *     "editados recentemente" estava, na prática, ordenada por data de criação.
 *
 * Quem já passa `updatedAt` explicitamente no `.set()` continua mandando: o
 * `$onUpdate` só preenche quando a coluna não veio no update.
 *
 * ATENÇÃO: isto cobre UPDATE na própria linha. Linha que envelhece por causa
 * de uma tabela filha (conversa que recebe mensagem nova) precisa de um toque
 * explícito - ver `touchConversation` em packages/orchestrator/src/chat-service.ts.
 */
export const timestampColumns = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const softDeleteColumn = {
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
};

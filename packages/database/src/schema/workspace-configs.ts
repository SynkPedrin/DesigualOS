import { jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import { users } from './identity';

/**
 * workspace_configs — Workspace Builder (prompt "FINAL PRODUCT REFINEMENT"
 * §5-13, 06/10/2026): quais módulos este colaborador vê na navegação E pode
 * acionar na API (§79: as duas coisas sempre juntas, nunca só a primeira).
 *
 * POR PESSOA, não por organização: a mesma decisão de `integration_connections`
 * (OAuth por colaborador) — "o que esta pessoa usa do produto" é propriedade
 * dela, não da empresa em que está trabalhando agora. Unique em `userId`
 * sozinho (não composto com organização).
 *
 * `modules` é a fonte de verdade (jsonb de strings validadas contra
 * `WORKSPACE_MODULES` em @desigual-os/types na camada de API, não aqui —
 * mesma divisão de responsabilidade de `client_meta_accounts`/`credentials`
 * em organization_connectors). `templateId` é só MEMÓRIA de qual template deu
 * origem a esta lista, pra tela pré-selecionar da próxima vez que alguém abrir
 * o editor — editar os módulos manualmente não apaga nem precisa mudar o
 * templateId.
 *
 * SEM LINHA AQUI = SEM CONFIGURAÇÃO AINDA, nunca "sem módulo nenhum". O
 * resolver (`resolveEnabledModules`, apps/api/src/workspace/access.ts) cai
 * pro padrão de `modulosPadrao(ehMaster)` quando a linha não existe — isso é
 * o que garante que ligar este recurso não tranca ninguém que já trabalhava.
 */
export const workspaceConfigs = pgTable('workspace_configs', {
  ...idColumn,
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  templateId: text('template_id'),
  modules: jsonb('modules').$type<string[]>().notNull().default([]),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  ...timestampColumns,
});

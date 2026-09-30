import { index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import { users } from './identity';

export const organizations = pgTable('organizations', {
  ...idColumn,
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),

  /**
   * ── IDENTIDADE DA EMPRESA (migração 0046) ─────────────────────────────
   *
   * Tudo opcional, e essa é a decisão: empresa sem logo usa o nome, empresa
   * sem cor usa o token padrão do produto. Ausência aqui é um estado legítimo
   * — o PROVEDOR, por exemplo, não preenche nada, porque usa a marca do
   * produto e não uma configuração de tenant.
   *
   * Em COLUNAS e não num `jsonb` solto: JSON aceitaria qualquer chave, e a
   * primeira vez que alguém escrevesse `primary_color` em vez de
   * `corPrimaria` ninguém descobriria até a tela não mudar de cor. Coluna com
   * nome errado não compila.
   */
  logoUrl: text('logo_url'),
  faviconUrl: text('favicon_url'),
  corPrimaria: text('cor_primaria'),
  corSecundaria: text('cor_secundaria'),

  /** O assistente da empresa. O produto chama de "Bento"; o cliente escolhe. */
  nomeAssistente: text('nome_assistente'),
  avatarAssistente: text('avatar_assistente'),
  mensagemBoasVindas: text('mensagem_boas_vindas'),

  /**
   * Quais módulos esta empresa VÊ. `null` = todos os padrão.
   *
   * Controla o que APARECE, nunca o que é PERMITIDO. Esconder item de menu não
   * protege rota — a checagem continua sendo do enforcement central. Está
   * escrito aqui porque é o erro fácil: um dia alguém vai querer usar isto
   * como permissão, e não é.
   */
  modulosVisiveis: text('modulos_visiveis').array(),

  /** 'ativa' | 'suspensa'. Texto e não enum: estado comercial ganha valores. */
  status: text('status').notNull().default('ativa'),

  /** `set null`: a empresa não some porque quem a criou saiu. */
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),

  ...timestampColumns,
});

export const organizationMembers = pgTable(
  'organization_members',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('collaborator'),
    ...timestampColumns,
  },
  (table) => ({
    membershipUnique: unique().on(table.organizationId, table.userId),
    userIdx: index('organization_members_user_id_idx').on(table.userId),
    organizationIdx: index('organization_members_organization_id_idx').on(table.organizationId),
  }),
);

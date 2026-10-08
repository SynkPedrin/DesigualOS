import { index, pgTable, text, timestamp, unique, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { idColumn, timestampColumns } from './_shared';
import { users } from './identity';

export const organizations = pgTable(
  'organizations',
  {
  ...idColumn,
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),

  /**
   * ── HIERARQUIA AGÊNCIA → SUBCONTAS (migração 0049) ──────────────────────
   *
   * A empresa PAI desta, quando ela é uma subconta. `null` = empresa raiz
   * (o caso de todas até aqui, e da provedora para sempre).
   *
   * `restrict` e não `set null`: com `set null`, apagar uma agência soltaria
   * as subcontas dela como raízes independentes — órfãs silenciosas, que
   * passariam a aparecer como empresas de primeiro nível sem que ninguém
   * pedisse. Quem quiser apagar uma agência reparenta ou remove os filhos
   * antes, de propósito. Ciclo é impossível por construção: `parent_id` só é
   * escrito na criação (criar.ts), apontando para uma empresa que já existe
   * — um filho nunca pode ser pai do próprio pai porque ainda não existia
   * quando o pai nasceu.
   *
   * A regra de quem vê o quê mora em packages/auth
   * (hierarquia-de-organizacao.ts): leitura DESCE (dono da agência lê as
   * subcontas), escrita NÃO atravessa (gravação continua só na org ativa).
   */
  parentId: uuid('parent_id').references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),

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
  },
  (table) => ({
    parentIdx: index('organizations_parent_id_idx').on(table.parentId),
  }),
);

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

/**
 * ── CONVITES DE EMPRESA (migração 0055) ─────────────────────────────────
 *
 * O convite de PLATAFORMA (POST /admin/invite) existia sem vínculo com
 * empresa, sem papel de organização e sem registro local — inlistável e
 * irrevogável. Esta tabela é o registro que torna o convite de EMPRESA
 * listável, revogável e auditável.
 *
 * NÃO HÁ TOKEN AQUI de propósito: o token é do Supabase Auth (generateLink),
 * que já faz hash, expira e é one-time. Guardar um segundo token seria uma
 * segunda superfície de vazamento sem nenhuma função. `supabase_user_id` é
 * só a referência para reenvio e diagnóstico.
 *
 * E-mail em MINÚSCULO na escrita (normalizado pela rota, não por citext:
 * `users.email` também é text e a extensão não está habilitada no projeto).
 * A leitura no aceite (JIT) compara com o e-mail do usuário já em minúsculo.
 *
 * UNICIDADE PARCIAL, e não unique (org, email) com reciclagem de status:
 * um convite revogado/aceito é HISTÓRICO (quem convidou, quando, com que
 * papel), e reciclar a linha apagaria esse rastro. O que não pode existir é
 * dois PENDENTES para o mesmo (org, email) — é o que o índice parcial
 * garante, inclusive sob duas requisições simultâneas.
 */
export const organizationInvites = pgTable(
  'organization_invites',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    /** 'owner' | 'admin' | 'collaborator' — texto livre como organization_members.role. */
    role: text('role').notNull().default('collaborator'),
    /** 'pendente' | 'aceito' | 'revogado' — texto e não enum: estado ganha valores. */
    status: text('status').notNull().default('pendente'),
    /** `set null`: o convite não some porque quem convidou saiu. */
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** O usuário do Supabase Auth criado pelo convite (generateLink). Null no
     *  fallback sem Supabase configurado. */
    supabaseUserId: uuid('supabase_user_id'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => ({
    pendenteUnique: uniqueIndex('organization_invites_pendente_unique')
      .on(table.organizationId, table.email)
      .where(sql`status = 'pendente'`),
    emailIdx: index('organization_invites_email_idx').on(table.email),
    organizationIdx: index('organization_invites_organization_id_idx').on(table.organizationId),
  }),
);

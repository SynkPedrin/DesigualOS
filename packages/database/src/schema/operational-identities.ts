import { boolean, index, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import { organizations } from './organizations';
import { people } from './knowledge-plane';

/**
 * IDENTIDADE OPERACIONAL — quem AGIU, quando quem agiu não tem conta no produto.
 *
 * O modelo do produto é uma conta de login (o master) e muitas pessoas na
 * operação. `users` responde "quem entra no Desigual OS"; `people` responde
 * "quem trabalha na agência". Faltava a terceira: "qual identidade externa
 * executou esta ação".
 *
 * POR QUE `entity_links` NÃO BASTA, e isto foi conferido antes de criar tabela:
 * aquele modelo afirma "a entidade X do Desigual é a MESMA que a origem chama
 * de Y". Funciona para Tammy no ClickUp. Não funciona para `atendimento@`, que
 * não é a mesma que ninguém — é uma conta usada por Tammy, Alicia e Jamile. Não
 * há `desigual_id` honesto para apontar.
 *
 * ---
 *
 * TRÊS TIPOS, e o segundo é a razão de a tabela existir:
 *
 *   person         a conta é de uma pessoa só. `personId` preenchido.
 *   shared_account a conta é de um grupo. `personId` NULO, sempre.
 *   service        automação. Não é gente.
 *
 * A REGRA QUE NÃO SE NEGOCIA: numa conta compartilhada, o sistema NUNCA diz
 * quem digitou. Se a ação veio de `atendimento@`, o ator é "Equipe
 * Atendimento" — não Tammy, não Jamile. Saber que as três usam a conta é
 * informação de composição (ver `operationalIdentityMembers`), nunca de
 * autoria. Atribuir uma ação à pessoa errada é pior que não atribuir: vira
 * avaliação de desempenho sobre dado inventado.
 *
 * ---
 *
 * POR QUE ISTO EXISTE EM VEZ DE CADA FUNCIONÁRIO TER LOGIN:
 *
 * Medido em 01/10/2026 no fluxo de OAuth do MCP: a identidade NÃO vem do
 * Claude. O Claude manda `client_id` e um `client_name` que é a string
 * "Claude", igual para todo mundo. Quem identifica o humano é a tela de
 * consentimento do próprio Desigual, exigindo login Supabase — e o produto
 * decidiu não criar conta para a equipe inteira.
 *
 * Então a conexão é gerada PELO MASTER e carrega a identidade: o funcionário
 * cola no Claude dele e nunca entra no Desigual. `mcp_tokens.user_id` continua
 * dizendo quem AUTORIZOU; esta tabela diz quem AGE.
 */
export const operationalIdentities = pgTable(
  'operational_identities',
  {
    ...idColumn,
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    /** 'claude' | 'clickup' | futuro conector. */
    source: text('source').notNull(),

    /**
     * O identificador no sistema de origem. Para uma conexão gerada pelo
     * master, é o id da própria conexão — estável e nosso, em vez de um e-mail
     * que a pessoa troca.
     */
    externalId: text('external_id').notNull(),

    /** Como aparece para humanos: "Equipe Atendimento", "Pedro Claude". */
    displayName: text('display_name').notNull(),

    /** 'person' | 'shared_account' | 'service'. */
    actorType: text('actor_type').notNull(),

    /**
     * A pessoa, SÓ quando `actorType = 'person'`. Em conta compartilhada fica
     * nulo de propósito — é o campo que impede o sistema de chutar autoria.
     */
    personId: uuid('person_id').references(() => people.id, { onDelete: 'set null' }),

    active: boolean('active').notNull().default(true),
    metadata: jsonb('metadata').notNull().default({}),
    ...timestampColumns,
  },
  (table) => ({
    /** Mesma forma do unique de `entity_links`: a empresa entra na chave. */
    identidadeUnica: unique('operational_identities_org_source_external_unique').on(
      table.organizationId,
      table.source,
      table.externalId,
    ),
    organizacaoIdx: index('operational_identities_organization_id_idx').on(table.organizationId),
    pessoaIdx: index('operational_identities_person_id_idx').on(table.personId),
  }),
);

/**
 * QUEM COMPÕE uma conta compartilhada.
 *
 * É informação de COMPOSIÇÃO, nunca de AUTORIA. Saber que Tammy, Alicia e
 * Jamile usam `atendimento@` permite ao Bento dizer "houve atividade da conta
 * de atendimento, usada por essas três" — e é exatamente o que ele deve dizer
 * em vez de escolher uma.
 *
 * A tabela existe para que essa frase seja possível SEM que o evento carregue
 * uma pessoa que ninguém provou.
 */
export const operationalIdentityMembers = pgTable(
  'operational_identity_members',
  {
    ...idColumn,
    identityId: uuid('identity_id')
      .notNull()
      .references(() => operationalIdentities.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    ...timestampColumns,
  },
  (table) => ({
    membroUnico: unique('operational_identity_members_unique').on(table.identityId, table.personId),
    identidadeIdx: index('operational_identity_members_identity_id_idx').on(table.identityId),
  }),
);

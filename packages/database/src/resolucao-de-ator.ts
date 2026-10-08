import { and, eq } from 'drizzle-orm';
import { db } from './client';
import { operationalIdentities, operationalIdentityMembers } from './schema/operational-identities';
import { people } from './schema/knowledge-plane';

/**
 * resolucao-de-ator.ts — QUEM AGIU, e quando é honesto dizer um nome.
 *
 * O produto tem uma conta de login (o master) e vinte e três pessoas na
 * operação. A pergunta "o que a Jamile fez hoje?" precisa de uma resposta que
 * não invente — e inventar aqui é fácil: a conta `atendimento@` é usada por
 * Tammy, Alicia e Jamile, e escolher uma das três produziria um relatório de
 * desempenho em cima de palpite.
 *
 * A REGRA, em uma linha: pessoa só é nomeada quando a identidade é de UMA
 * pessoa. Em conta compartilhada o ator é a equipe, e a composição existe
 * apenas para o agente poder dizer "foi a conta de atendimento, usada por
 * essas três" em vez de escolher.
 *
 * COMPOSIÇÃO NÃO É AUTORIA. É a distinção inteira deste arquivo.
 */

export type TipoDeAtor = 'person' | 'shared_account' | 'service';

export interface AtorResolvido {
  identityId: string;
  /** Como chamar o ator numa frase: "Jamile Galdino", "Equipe Atendimento". */
  nome: string;
  actorType: TipoDeAtor;
  /**
   * A pessoa, SÓ quando a identidade é individual. `null` em conta
   * compartilhada — e é esse nulo que impede o evento de nascer com autoria
   * que ninguém provou.
   */
  personId: string | null;
  /**
   * Quem USA a conta, quando ela é compartilhada. Serve para o agente explicar
   * a ambiguidade, nunca para resolvê-la.
   */
  membros: Array<{ personId: string; nome: string }>;
  organizationId: string;
}

/**
 * Acha o ator por identidade operacional. `null` quando a identidade não
 * existe, está inativa, ou é de outra empresa — e a empresa entra na consulta
 * sempre, porque identidade de um tenant jamais pode resolver no outro.
 */
export async function resolverAtor(
  organizationId: string,
  source: string,
  externalId: string,
): Promise<AtorResolvido | null> {
  const [identidade] = await db
    .select({
      id: operationalIdentities.id,
      displayName: operationalIdentities.displayName,
      actorType: operationalIdentities.actorType,
      personId: operationalIdentities.personId,
      organizationId: operationalIdentities.organizationId,
      active: operationalIdentities.active,
    })
    .from(operationalIdentities)
    .where(
      and(
        eq(operationalIdentities.organizationId, organizationId),
        eq(operationalIdentities.source, source),
        eq(operationalIdentities.externalId, externalId),
      ),
    )
    .catch(() => []);

  if (!identidade || !identidade.active) return null;

  const tipo = identidade.actorType as TipoDeAtor;

  /**
   * SÓ identidade individual carrega pessoa. Mesmo que uma linha de conta
   * compartilhada tivesse `personId` preenchido por engano, ele é ignorado
   * aqui: a regra mora na leitura, não só na escrita, porque é a leitura que
   * alimenta o evento.
   */
  const personId = tipo === 'person' ? identidade.personId : null;

  const membros =
    tipo === 'shared_account'
      ? await db
          .select({ personId: people.id, nome: people.canonicalName })
          .from(operationalIdentityMembers)
          .innerJoin(people, eq(people.id, operationalIdentityMembers.personId))
          .where(eq(operationalIdentityMembers.identityId, identidade.id))
          .catch(() => [])
      : [];

  return {
    identityId: identidade.id,
    nome: identidade.displayName,
    actorType: tipo,
    personId,
    membros,
    organizationId: identidade.organizationId,
  };
}

/**
 * A frase que o agente usa para falar do ator — e, em conta compartilhada, a
 * frase que o impede de escolher alguém.
 *
 * Existe aqui, junto da resolução, de propósito: se cada lugar montasse a sua,
 * um deles acabaria escrevendo "Tammy" onde o dado só autoriza "Equipe
 * Atendimento".
 */
export function descreverAtor(ator: AtorResolvido): string {
  if (ator.actorType === 'person') return ator.nome;
  if (ator.actorType === 'service') return `${ator.nome} (automação)`;

  const nomes = ator.membros.map((m) => m.nome);
  if (nomes.length === 0) return `${ator.nome} (conta compartilhada)`;
  return (
    `${ator.nome} (conta compartilhada, usada por ${nomes.join(', ')}) — ` +
    'não é possível atribuir esta ação a uma dessas pessoas em específico'
  );
}

/**
 * A pessoa pode ser responsabilizada por esta ação?
 *
 * `false` para conta compartilhada SEMPRE, inclusive quando ela tem um membro
 * só: hoje é uma pessoa, amanhã são três, e o histórico já teria nome gravado.
 */
export function podeAtribuirAPessoa(ator: AtorResolvido): boolean {
  return ator.actorType === 'person' && ator.personId !== null;
}

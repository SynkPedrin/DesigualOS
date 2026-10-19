import type { McpPrincipal } from '@desigual-os/mcp-domain';

/**
 * autoria.ts — QUEM GRAVOU, em uma função só para nenhuma tool improvisar.
 *
 * A distinção que este arquivo protege: `principal.userId`/`principal.name` diz
 * quem AUTORIZOU (no OAuth é a própria pessoa; na credencial de conexão é o
 * master que gerou). `principal.ator` diz quem AGE. Antes desta camada, a
 * autoria gravada era `principal.name` — e com credencial de conta
 * compartilhada o conhecimento da Equipe Atendimento saía atribuído ao Pedro.
 * Autoria errada é pior que ausente: vira avaliação de desempenho sobre dado
 * inventado.
 *
 * A REGRA INEGOCIÁVEL — conta compartilhada NUNCA grava nome de pessoa — não é
 * reimplementada aqui: ela já está decidida na resolução
 * (packages/database/src/resolucao-de-ator.ts), que devolve `personId: null` e
 * o nome da EQUIPE como displayName para `shared_account`, mesmo com um membro
 * só. Aqui a regra se cumpre por construção: gravamos o displayName, e o
 * displayName de uma conta compartilhada nunca é uma pessoa.
 */

/** O nome que vai para `recorded_by` e para a coluna `actor`: quem age, se houver; senão o legado. */
export function autorDoRegistro(principal: McpPrincipal): string {
  return principal.ator?.displayName ?? principal.name;
}

/**
 * Autoria no `payload` do operational_event — vazio quando não há ator (legado
 * intacto: nenhum campo novo aparece nos 250+ tokens antigos). SEM migration:
 * coluna só quando alguém precisar filtrar por ator.
 */
export function autoriaNoPayload(principal: McpPrincipal): Record<string, unknown> {
  if (!principal.ator) return {};
  return {
    actor_identity_id: principal.ator.identityId,
    actor: principal.ator.displayName,
    actor_type: principal.ator.actorType,
    authorized_by_user_id: principal.userId,
  };
}

/**
 * Autoria no `metadata` da memory — mesmo contrato do payload, com
 * `authorized_by` legível (o nome de quem autorizou) em vez do id.
 */
export function autoriaNoMetadata(principal: McpPrincipal): Record<string, unknown> {
  if (!principal.ator) return {};
  return {
    actor_identity_id: principal.ator.identityId,
    actor_type: principal.ator.actorType,
    authorized_by: principal.name,
  };
}

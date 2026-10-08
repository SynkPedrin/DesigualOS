export * as schema from './schema/index';
export { db } from './client';
export type { Database } from './client';
export { getSchemaVersion } from './schema-version.js';
export {
  vincularEntidade,
  resolverPessoaPorClickupUserId,
  resolverPessoaPorEmail,
  linksDaEntidade,
  type PessoaResolvida,
  type VincularEntidadeInput,
  type VincularEntidadeOutcome,
} from './entity-resolution.js';

export * from './resolucao-de-ator';

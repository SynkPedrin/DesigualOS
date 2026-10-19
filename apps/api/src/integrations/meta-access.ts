/**
 * Re-export: a implementação real mora em
 * `packages/tool-gateway/src/meta-access-resolver.ts` desde os Relatórios
 * PDF (06/10/2026) — o worker também precisa resolver a conexão Meta de um
 * `connectionId` pra gerar um relatório. Este arquivo existe só pra nenhum
 * import existente em apps/api precisar mudar.
 */
export { META_PROVIDER, getMetaConnection, resolveMetaAccess, resolveMetaAccessByConnectionId, type MetaAccess } from '@desigual-os/tool-gateway';

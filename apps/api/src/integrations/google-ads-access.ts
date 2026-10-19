/**
 * Re-export: a implementação real mora em
 * `packages/tool-gateway/src/google-ads-access-resolver.ts` desde os
 * Relatórios PDF (06/10/2026) — mesmo motivo de meta-access.ts. Este arquivo
 * existe só pra nenhum import existente em apps/api precisar mudar.
 */
export {
  GOOGLE_ADS_PROVIDER,
  getGoogleAdsEnvConfig,
  getGoogleAdsConnection,
  resolveGoogleAdsAccess,
  resolveGoogleAdsAccessByConnectionId,
  type GoogleAdsAccess,
} from '@desigual-os/tool-gateway';

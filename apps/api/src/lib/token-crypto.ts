/**
 * Re-export: a implementação real mora em
 * `packages/tool-gateway/src/token-crypto.ts` desde a missão de release
 * OpenAI + ClickUp MCP (o worker também precisa decifrar o token do
 * ClickUp MCP). Este arquivo existe só pra nenhum import existente em
 * apps/api precisar mudar.
 */
export { encryptToken, decryptToken } from '@desigual-os/tool-gateway';

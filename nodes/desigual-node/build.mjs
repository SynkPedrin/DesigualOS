import { build } from 'esbuild';

/**
 * Mesmo problema e mesma solução do apps/api/build.mjs (ver comentário lá):
 * `tsc` puro emite imports relativos sem extensão, que o loader ESM do Node
 * não resolve - `node dist/index.js` quebrava com ERR_MODULE_NOT_FOUND.
 * Confirmado ao vivo em 08/09/2026 escrevendo o README de instalação deste
 * node: `pnpm build && pnpm start` falhava exatamente assim, apesar do
 * mesmo bug já ter sido corrigido em apps/api/apps/worker.
 *
 * Dependências reais (fastify, zod, dotenv, pino via @desigual-os/logging)
 * são todas JS puro, sem addon nativo - mesma situação de apps/api, então
 * empacota tudo (workspace + node_modules) em vez de manter lista de
 * exclusão à mão.
 */
// NOTA: `dist/index.js` só funciona com NODE_ENV=production (o "start" do
// package.json já força isso). Sem essa env var, createLogger (packages/
// logging) ativa o transport pino-pretty, que spawna uma worker thread
// (thread-stream) dependente de `__dirname` - inexistente em ESM bundled
// por esbuild (`ReferenceError: __dirname is not defined`, confirmado ao
// vivo em 08/09/2026). Não afeta o caminho real de produção nem `pnpm dev`
// (que roda via tsx, não este bundle) - só rodar o bundle SEM
// NODE_ENV=production, o que "start" nunca faz.
await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist/index.js',
  sourcemap: true,
  logLevel: 'info',
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});

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
 * e o pacote @desigual-os/otto (planejamento criativo, JS/TS puro) são
 * todas sem addon nativo - mesma situação de apps/api, então empacota tudo
 * (workspace + node_modules) em vez de manter lista de exclusão à mão.
 */
// NOTA: `dist/index.js` só funciona com NODE_ENV=production (o "start" do
// package.json já força isso) - ver comentário completo em
// nodes/desigual-node/build.mjs (mesmo bug de __dirname em ESM bundled).
const RELEASE_SHA = process.env.RELEASE_SHA ?? 'dev';
const BUILD_TIME = new Date().toISOString();

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist/index.js',
  // Carimba SHA e hora no bundle: o /health do node passa a dizer que versão
  // está atendendo, em vez de "deve estar atualizado".
  define: {
    'process.env.RELEASE_SHA': JSON.stringify(RELEASE_SHA),
    'process.env.BUILD_TIME': JSON.stringify(BUILD_TIME),
  },
  sourcemap: true,
  logLevel: 'info',
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});

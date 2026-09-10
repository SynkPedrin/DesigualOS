import { build } from 'esbuild';

/**
 * Mesmo problema do apps/api/build.mjs (tsc puro emite import relativo sem
 * extensão, ERR_MODULE_NOT_FOUND no Node) - confirmado ao vivo em
 * 08/09/2026 escrevendo o README de instalação deste node. A SOLUÇÃO aqui é
 * diferente da de apps/api/apps/worker/desigual-node/otto-node, de propósito:
 * `sharp` compila um addon nativo por plataforma e `puppeteer-core` só
 * referencia um binário de browser real - empacotar os dois com esbuild
 * quebraria em runtime (addon nativo/binário não é JS, não bundleia).
 *
 * Então aqui NÃO empacota tudo: as dependências reais (resolvidas do
 * node_modules normal, instalado de verdade na máquina do Studio) ficam
 * `external`; só os pacotes @desigual-os/* entram no bundle, porque eles
 * são fonte TS pura sem build próprio (`"main": "./src/index.ts"`, ver
 * packages/logging/package.json) - sem bundlear, o Node não teria como
 * rodar o TypeScript deles direto.
 */
// NOTA: `dist/index.js` só funciona com NODE_ENV=production (o "start" do
// package.json já força isso) - ver comentário completo em
// nodes/desigual-node/build.mjs (mesmo bug de __dirname em ESM bundled,
// só que aqui é @desigual-os/logging que fica dentro do bundle mesmo com
// os outros pacotes externalizados).
await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist/index.js',
  sourcemap: true,
  logLevel: 'info',
  external: [
    '@supabase/supabase-js',
    'bullmq',
    'dotenv',
    'ffmpeg-static',
    'drizzle-orm',
    'puppeteer-core',
    'sharp',
    'zod',
  ],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});

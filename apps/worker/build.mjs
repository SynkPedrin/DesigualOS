import { build } from 'esbuild';

/**
 * Mesmo problema e mesma solução do apps/api/build.mjs: `tsc` puro emite
 * imports relativos sem extensão, que o loader ESM do Node não resolve.
 * Pacotes `@desigual-os/*` (fonte TS pura, sem build próprio) entram no
 * bundle; todo outro pacote (bullmq, drizzle-orm etc) fica de fora e é
 * resolvido do node_modules normalmente em runtime.
 */
// Bundle completo (workspace + node_modules), ESM: mesma escolha e o
// mesmo banner de apps/api/build.mjs (ver comentários lá) - createRequire
// resolve dependências CJS internas chamando require(builtin) depois de
// empacotadas, e ESM preserva import.meta.url pros arquivos que se
// localizam em disco por conta própria (packages/database/src/env.ts,
// packages/router/src/marketing-copy.ts).
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

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
/**
 * Addons NATIVOS do Otto Motion: @remotion/renderer, @remotion/bundler (que
 * carrega @rspack/binding) e sharp trazem binário `.node`, que o esbuild não
 * empacota — a build do worker falhava em "No loader is configured for .node
 * files" desde que o Motion Engine entrou, despercebido porque `dev` roda em
 * `tsx`. Ao contrário da API, o worker RENDERIZA de verdade, então aqui eles
 * não podem só sumir: ficam externos e precisam existir em node_modules na
 * imagem do worker (ver o estágio `worker` em Dockerfile.prod).
 */
const NATIVOS_DO_MOTION = ['@remotion/renderer', '@remotion/bundler', 'sharp'];

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist/index.js',
  external: NATIVOS_DO_MOTION,
  sourcemap: true,
  logLevel: 'info',
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});

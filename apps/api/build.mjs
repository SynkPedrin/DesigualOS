import { build } from 'esbuild';
import { shaDeRelease, versaoDoSchema } from '../../scripts/identidade-de-release.mjs';

/**
 * `tsc` sozinho (module: ESNext, moduleResolution: Bundler no
 * tsconfig.base.json) emite imports relativos sem extensão (`./nodes/routes`
 * em vez de `./nodes/routes.js`), que o loader ESM nativo do Node não
 * resolve - `node dist/server.js` quebrava com ERR_MODULE_NOT_FOUND (ADR
 * 0002, nunca validado até 2026-09-07). O bundler resolve isso sozinho.
 *
 * Bundle completo (workspace + node_modules): deixar só os pacotes
 * `@desigual-os/*` no bundle e externalizar o resto vira um jogo de
 * "descobrir a dependência transitiva que falta" (pino, etc - dependências
 * de pacotes internos que a própria API nunca declarou direto, e o
 * node_modules isolado do pnpm não deixa resolver por fora do package.json
 * de quem realmente depende). Todo o código aqui é JS puro (sem addon
 * nativo), então empacotar tudo é mais simples e mais robusto que manter
 * essa lista de exclusão à mão.
 */
// ESM (não CJS): packages/database/src/env.ts e packages/router/src/
// marketing-copy.ts usam `import.meta.url` pra se localizar em disco - em
// CJS isso vira vazio e quebra o caminho do .env/Brain-Marketing. O banner
// abaixo resolve o outro lado do problema (dependências CJS internas como
// dotenv chamando require('fs') depois de empacotadas em contexto ESM,
// que sem isso vira "Dynamic require of fs is not supported"): define um
// `require` de verdade via createRequire, capaz de pedir módulo nativo do
// Node normalmente.
/**
 * O comentário acima ("todo o código aqui é JS puro, sem addon nativo")
 * deixou de valer quando o Otto Motion Engine entrou: o pipeline de motion
 * usa @remotion/renderer, @remotion/bundler (que carrega @rspack/binding) e
 * sharp — todos com binário `.node`, que o esbuild não sabe empacotar. A
 * build da API passou a falhar em "No loader is configured for .node files",
 * e isso passou despercebido porque `dev` roda em `tsx`, sem bundle.
 *
 * A API nunca renderiza: ela só ENFILEIRA (getMotionQueue). Quem renderiza é
 * o worker. Marcar estes pacotes como externos mantém o bundle da API livre
 * de binário nativo — e, como `queue.ts` carrega o pipeline por `import()`
 * tardio na entrada `@desigual-os/otto-motion/pipeline`, a API nem chega a
 * resolvê-los em runtime. Por isso a imagem da API continua sem node_modules.
 */
const NATIVOS_DO_MOTION = [
  '@desigual-os/otto-motion/pipeline',
  '@remotion/renderer',
  '@remotion/bundler',
  'sharp',
];

await build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist/server.js',
  external: NATIVOS_DO_MOTION,
  sourcemap: true,
  logLevel: 'info',
  // O SHA vira literal no bundle. Ver scripts/sha-de-release.mjs: o
  // container de produção não tem .git, então resolver isso em runtime
  // devolvia 'unknown' e o /health não provava qual commit estava no ar.
  define: {
    __RELEASE_SHA__: JSON.stringify(shaDeRelease()),
    __SCHEMA_VERSION__: JSON.stringify(versaoDoSchema()),
  },
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});

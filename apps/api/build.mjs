import { build } from 'esbuild';

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
await build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist/server.js',
  sourcemap: true,
  logLevel: 'info',
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});

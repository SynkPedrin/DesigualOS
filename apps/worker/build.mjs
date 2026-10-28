import { copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { shaDeRelease, versaoDoSchema } from '../../scripts/identidade-de-release.mjs';

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
 *
 * @react-pdf/renderer entra por outro motivo (13/10/2026): o pdfkit dentro
 * dele resolve as fontes padrão por imports de pacote (`#standard-fonts/*`),
 * que o Node só consegue resolver de dentro do pacote original. Empacotado,
 * o require vazava pro bundle e o worker morria em MODULE_NOT_FOUND. Externo,
 * ele é resolvido do node_modules da imagem, onde o imports dele vale.
 */
const NATIVOS_DO_MOTION = ['@remotion/renderer', '@remotion/bundler', 'sharp', '@react-pdf/renderer'];

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'dist/index.js',
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

/**
 * O WORKER DO PDF.JS VAI JUNTO DO BUNDLE (28/10/2026).
 *
 * O pdf-parse, empacotado, procura `pdf.worker.mjs` ao lado de quem o importa
 * — aqui, `dist/index.js`. Sem este arquivo, TODA leitura de PDF falha em
 * produção com "Setting up fake worker failed: Cannot find module
 * .../dist/pdf.worker.mjs". Achado ao rodar a leitura dentro da imagem de
 * produção antes de publicar o Jarbas lendo documentos; o teste unitário não
 * pegava porque roda o pdf-parse direto do node_modules, sem bundle.
 * O arquivo é o da MESMA versão do pdf-parse que entrou no bundle.
 */
const workerDoPdf = join(dirname(fileURLToPath(import.meta.resolve('pdf-parse'))), 'pdf.worker.mjs');
copyFileSync(workerDoPdf, 'dist/pdf.worker.mjs');

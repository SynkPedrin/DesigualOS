/**
 * Prova do caminho Remotion sem banco, sem fila e sem agente: scaffold ->
 * bundle -> render de preview -> frames -> QA técnico.
 *
 * Roda à mão (`tsx src/render/render.smoke.mts`), não no `vitest run`: baixa o
 * Chrome Headless Shell na primeira vez e renderiza vídeo de verdade.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '@desigual-os/logging';
import { createWorkspace, destroyWorkspace } from '../workspace/workspace.js';
import { writeScaffold } from './scaffold.js';
import { bundleMotion } from './bundle.js';
import { extractReviewFrames, renderMotion } from './render.js';
import { runTechnicalQa } from '../qa/technical.js';

const logger = createLogger({ service: 'motion-smoke', pretty: true });
const workspace = await createWorkspace('smoke-render');
const config = { width: 1080, height: 1920, fps: 30, durationInFrames: 90, durationSeconds: 3, brandName: 'Smoke' };

await writeScaffold(workspace, config);
await fs.writeFile(
  path.join(workspace.project, 'src', 'Motion.tsx'),
  `import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { MOTION_CONFIG } from './config';

export const Motion: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entrada = spring({ frame, fps, config: { damping: 200 } });
  const y = interpolate(entrada, [0, 1], [80, 0]);
  return (
    <AbsoluteFill style={{ backgroundColor: '#0B0B0D', justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ transform: \`translateY(\${y}px)\`, opacity: entrada, color: '#fff', fontSize: 120, fontWeight: 800 }}>
        {MOTION_CONFIG.brandName}
      </div>
    </AbsoluteFill>
  );
};
`,
  'utf8',
);

console.log('bundling...');
const { serveUrl, durationMs } = await bundleMotion(workspace);
console.log(`bundle ok em ${durationMs}ms`);

console.log('renderizando preview...');
const preview = await renderMotion({ workspace, serveUrl, quality: 'preview', logger });
console.log('preview:', { ...preview, file: path.basename(preview.file) });

console.log('extraindo frames...');
const frames = await extractReviewFrames({ workspace, serveUrl, count: 5 });
console.log('frames:', frames.map((f) => `${f.timeSeconds.toFixed(2)}s`).join(', '));

const qa = await runTechnicalQa({
  file: preview.file,
  expected: { width: preview.width, height: preview.height, fps: config.fps, durationSeconds: config.durationSeconds },
  frames,
  runtimeErrors: [],
  missingAssets: [],
});
console.log('QA TÉCNICO:', qa.score, '/100');
for (const check of qa.checks) console.log(`  ${check.passed ? 'ok ' : 'X  '} ${check.label}: ${check.detail}`);

if (process.argv.includes('--limpar')) await destroyWorkspace(workspace);
process.exit(qa.score >= 95 ? 0 : 1);

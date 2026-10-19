import fs from 'node:fs/promises';
import path from 'node:path';
import type { MotionWorkspace } from '../workspace/workspace.js';

/**
 * Esqueleto do projeto Remotion.
 *
 * A divisão é deliberada e é o que faz o QA técnico (§25) ser verificação de
 * verdade em vez de torcida:
 *
 *   NOSSO (o agente não deve tocar):
 *     src/index.ts   registerRoot
 *     src/Root.tsx   a <Composition>, com duração/fps/resolução vindos do job
 *     src/config.ts  os números do job, gerados a partir da MotionSession
 *
 *   DO AGENTE:
 *     src/Motion.tsx  e o que mais ele quiser criar dentro de src/
 *
 * Se a duração e o formato fossem escritos pelo modelo, "15 segundos em
 * 1080x1920" viraria uma intenção no prompt em vez de um fato no arquivo — e
 * o QA estaria conferindo o vídeo contra o que o próprio modelo decidiu, o
 * que não prova nada.
 */
export interface ScaffoldConfig {
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  durationSeconds: number;
  brandName: string;
}

export const COMPOSITION_ID = 'MotionMain';

/** Arquivos que o pipeline restaura se o agente os alterar. */
export const PROTECTED_FILES = ['src/index.ts', 'src/Root.tsx', 'src/config.ts'] as const;

function indexSource(): string {
  return `import { registerRoot } from 'remotion';
import { RemotionRoot } from './Root';

registerRoot(RemotionRoot);
`;
}

function rootSource(): string {
  return `import { Composition } from 'remotion';
import { MOTION_CONFIG } from './config';
import { Motion } from './Motion';

/**
 * Arquivo do Motion Engine. Não edite: duração, fps e resolução vêm do job e
 * o QA técnico confere o MP4 contra estes números.
 */
export const RemotionRoot: React.FC = () => (
  <Composition
    id="${COMPOSITION_ID}"
    component={Motion}
    durationInFrames={MOTION_CONFIG.durationInFrames}
    fps={MOTION_CONFIG.fps}
    width={MOTION_CONFIG.width}
    height={MOTION_CONFIG.height}
  />
);
`;
}

function configSource(config: ScaffoldConfig): string {
  return `/** Gerado pelo Motion Engine a partir do pedido. Não edite. */
export const MOTION_CONFIG = {
  width: ${config.width},
  height: ${config.height},
  fps: ${config.fps},
  durationInFrames: ${config.durationInFrames},
  durationSeconds: ${config.durationSeconds},
  brandName: ${JSON.stringify(config.brandName)},
} as const;
`;
}

/** Placeholder só pra primeira build não quebrar antes de o agente escrever. */
function motionPlaceholderSource(): string {
  return `import { AbsoluteFill } from 'remotion';

export const Motion: React.FC = () => <AbsoluteFill style={{ backgroundColor: '#000' }} />;
`;
}

export async function writeScaffold(workspace: MotionWorkspace, config: ScaffoldConfig): Promise<void> {
  const src = path.join(workspace.project, 'src');
  await fs.mkdir(src, { recursive: true });
  await fs.mkdir(path.join(workspace.project, 'public'), { recursive: true });

  await fs.writeFile(path.join(src, 'index.ts'), indexSource(), 'utf8');
  await fs.writeFile(path.join(src, 'Root.tsx'), rootSource(), 'utf8');
  await fs.writeFile(path.join(src, 'config.ts'), configSource(config), 'utf8');

  // O Motion.tsx só é criado se ainda não existir: numa iteração (§43) o
  // arquivo do agente É o trabalho anterior e sobrescrevê-lo seria
  // exatamente o "rewrite" que o §43 proíbe.
  const motionFile = path.join(src, 'Motion.tsx');
  try {
    await fs.access(motionFile);
  } catch {
    await fs.writeFile(motionFile, motionPlaceholderSource(), 'utf8');
  }

  // package.json do projeto: `type: module` e nada mais. Sem dependências
  // próprias de propósito — a resolução sobe até packages/otto-motion/node_modules
  // (ver workspace.ts), então não há `npm install` por job nem chance de o
  // agente puxar pacote arbitrário da rede.
  await fs.writeFile(
    path.join(workspace.project, 'package.json'),
    `${JSON.stringify({ name: 'otto-motion-project', private: true, version: '0.0.0', type: 'module' }, null, 2)}\n`,
    'utf8',
  );
}

/**
 * Restaura os arquivos protegidos. Roda DEPOIS de cada sessão do agente: o
 * `--restricted` confina ao workspace, mas dentro do workspace o agente pode
 * escrever onde quiser, e um Root.tsx "melhorado" com outra duração faria o
 * job entregar 8 segundos onde se pediu 15.
 */
export async function restoreProtectedFiles(
  workspace: MotionWorkspace,
  config: ScaffoldConfig,
): Promise<string[]> {
  const src = path.join(workspace.project, 'src');
  const expected: Record<string, string> = {
    'src/index.ts': indexSource(),
    'src/Root.tsx': rootSource(),
    'src/config.ts': configSource(config),
  };

  const restored: string[] = [];
  for (const relative of PROTECTED_FILES) {
    const file = path.join(src, path.basename(relative));
    const wanted = expected[relative];
    if (wanted === undefined) continue;
    const current = await fs.readFile(file, 'utf8').catch(() => null);
    if (current !== wanted) {
      await fs.writeFile(file, wanted, 'utf8');
      restored.push(relative);
    }
  }
  return restored;
}

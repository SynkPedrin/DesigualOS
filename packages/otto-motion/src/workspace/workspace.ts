import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * §12 — cada motion tem seu próprio workspace, e §11 — a fonte do cliente é
 * read-only.
 *
 * A raiz fica DENTRO do pacote (packages/otto-motion/runtime) por um motivo
 * técnico concreto, não por gosto: o bundler do Remotion resolve `react` e
 * `remotion` subindo a árvore de node_modules a partir do arquivo de entrada.
 * Com pnpm não existe node_modules hoisted na raiz do repositório — só o
 * link farm em cada pacote. Workspace dentro do pacote significa que o projeto
 * gerado enxerga `packages/otto-motion/node_modules` sem `npm install` por
 * job: sem rede, sem minutos de instalação e sem o risco de o agente puxar
 * dependência arbitrária.
 */
const DEFAULT_RUNTIME_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../runtime/motions',
);

export function motionRuntimeRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.OTTO_MOTION_RUNTIME_DIR ?? DEFAULT_RUNTIME_DIR;
}

export interface MotionWorkspace {
  motionId: string;
  root: string;
  /** Código do motion. É só isto que o Claude Code pode escrever. */
  project: string;
  /** Cópias dos assets do cliente. Nunca os originais. */
  assets: string;
  references: string;
  output: string;
  previews: string;
  frames: string;
  logs: string;
  metadataFile: string;
  requestFile: string;
  contextFile: string;
}

export function workspaceFor(motionId: string, env: NodeJS.ProcessEnv = process.env): MotionWorkspace {
  const root = path.join(motionRuntimeRoot(env), `motion_${motionId}`);
  return {
    motionId,
    root,
    project: path.join(root, 'project'),
    assets: path.join(root, 'assets'),
    references: path.join(root, 'references'),
    output: path.join(root, 'output'),
    previews: path.join(root, 'previews'),
    frames: path.join(root, 'frames'),
    logs: path.join(root, 'logs'),
    metadataFile: path.join(root, 'metadata.json'),
    requestFile: path.join(root, 'request.json'),
    contextFile: path.join(root, 'context.json'),
  };
}

export async function createWorkspace(
  motionId: string = randomUUID(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<MotionWorkspace> {
  const workspace = workspaceFor(motionId, env);
  for (const dir of [
    workspace.root,
    workspace.project,
    path.join(workspace.project, 'src'),
    workspace.assets,
    workspace.references,
    workspace.output,
    workspace.previews,
    workspace.frames,
    workspace.logs,
  ]) {
    await fs.mkdir(dir, { recursive: true });
  }
  return workspace;
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

export async function appendLog(workspace: MotionWorkspace, name: string, content: string): Promise<void> {
  await fs.mkdir(workspace.logs, { recursive: true });
  await fs.appendFile(path.join(workspace.logs, name), content.endsWith('\n') ? content : `${content}\n`, 'utf8');
}

/**
 * Nome de arquivo seguro derivado da URL de origem.
 *
 * O hash no prefixo não é enfeite: dois clientes podem ter "logo.png", e o
 * §52 exige que dois clientes NUNCA compartilhem asset. Como cada job já tem
 * workspace próprio, o hash resolve a colisão dentro do mesmo job (duas URLs
 * diferentes com o mesmo basename) sem depender do nome que veio de fora.
 */
export function safeAssetName(url: string, filename: string): string {
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 8);
  const base = path
    .basename(filename)
    .replace(/[^\w.\-]+/g, '_')
    .slice(-60);
  return `${hash}_${base || 'asset'}`;
}

/** Remove o workspace inteiro. Só para limpeza explícita — nunca automático em falha. */
export async function destroyWorkspace(workspace: MotionWorkspace): Promise<void> {
  await fs.rm(workspace.root, { recursive: true, force: true });
}

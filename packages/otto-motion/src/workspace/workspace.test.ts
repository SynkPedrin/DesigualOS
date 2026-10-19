import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createWorkspace, destroyWorkspace, safeAssetName, workspaceFor, type MotionWorkspace } from './workspace.js';

const criados: MotionWorkspace[] = [];

afterAll(async () => {
  for (const workspace of criados) await destroyWorkspace(workspace).catch(() => undefined);
});

describe('workspace do job (§12)', () => {
  it('o diretório criado é EXATAMENTE o que workspaceFor localiza depois', async () => {
    // Defeito real (24/09/2026): o workspace nascia com um uuid aleatório e o
    // pipeline o procurava pelo id da sessão. Dois diretórios, um órfão, e
    // `workspace_path` no banco apontando pro lugar errado.
    const id = `teste-mesmo-id-${Date.now()}`;
    const criado = await createWorkspace(id);
    criados.push(criado);
    expect(workspaceFor(id).root).toBe(criado.root);
    expect(criado.root.endsWith(`motion_${id}`)).toBe(true);
  });

  it('cria a estrutura inteira do §12', async () => {
    const workspace = await createWorkspace(`teste-estrutura-${Date.now()}`);
    criados.push(workspace);
    for (const dir of [
      workspace.project,
      workspace.assets,
      workspace.references,
      workspace.output,
      workspace.previews,
      workspace.frames,
      workspace.logs,
    ]) {
      await expect(fs.access(dir)).resolves.toBeUndefined();
    }
  });

  it('jobs diferentes não compartilham diretório (§12, §52)', async () => {
    const a = await createWorkspace(`teste-a-${Date.now()}`);
    const b = await createWorkspace(`teste-b-${Date.now()}`);
    criados.push(a, b);
    expect(a.root).not.toBe(b.root);
    expect(path.relative(a.root, b.root)).not.toBe('');
  });

  it('o nome do asset é seguro mesmo vindo hostil de fora', () => {
    expect(safeAssetName('https://x/a', 'foto bonita (1).PNG')).toMatch(/^[0-9a-f]{8}_[\w.-]+$/);
  });
});

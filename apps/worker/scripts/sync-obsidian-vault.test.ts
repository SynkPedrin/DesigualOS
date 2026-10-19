import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// O módulo testado importa rememberFact/carregarClientes no topo do arquivo
// (fora do bloco CLI) — importar o módulo pra testar as funções puras abaixo
// pux a cadeia real de @desigual-os/database sem isto. Mesma lição do Bento
// 3.0 Fase 2 (senior-operation.test.ts): nunca deixar teste bater em infra
// real por falta de mock explícito.
vi.mock('@desigual-os/database', () => ({ db: {}, schema: {} }));
vi.mock('@desigual-os/orchestrator', () => ({ rememberFact: vi.fn() }));

const { arquivosDoVault, deveIgnorarCaminho } = await import('./sync-obsidian-vault.mjs');

/**
 * Não há vault Obsidian real disponível nesta sessão (OBSIDIAN_VAULT_PATH não
 * está configurado, e o conteúdo real do vault não mora no repositório — ver
 * o docstring do próprio script). Prova a lógica de filtro/varredura com um
 * vault sintético; o casamento arquivo→cliente em si é o mesmo de
 * sync-dossies.mts (lib/clientes.mts), já em uso em produção.
 */
describe('deveIgnorarCaminho', () => {
  it('ignora qualquer coisa sob 02-clientes — isso já é dono do sync-dossies.mts', () => {
    expect(deveIgnorarCaminho('02-clientes/fratelli.md')).toBe(true);
    expect(deveIgnorarCaminho(path.join('02-clientes', 'fratelli.md'))).toBe(true);
    expect(deveIgnorarCaminho(path.join('notas', '02-clientes', 'x.md'))).toBe(true);
  });

  it('ignora pastas ocultas (.obsidian e afins)', () => {
    expect(deveIgnorarCaminho(path.join('.obsidian', 'workspace.json'))).toBe(true);
    expect(deveIgnorarCaminho(path.join('.trash', 'nota.md'))).toBe(true);
  });

  it('não ignora o resto do vault', () => {
    expect(deveIgnorarCaminho('reuniao-colormaq.md')).toBe(false);
    expect(deveIgnorarCaminho(path.join('notas', 'fratelli-briefing.md'))).toBe(false);
  });
});

describe('arquivosDoVault', () => {
  let raiz: string;

  beforeEach(() => {
    raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-sintetico-'));
    fs.writeFileSync(path.join(raiz, 'reuniao-colormaq.md'), '# Reunião Colormaq\nConteúdo real da nota.');
    fs.mkdirSync(path.join(raiz, '02-clientes'));
    fs.writeFileSync(path.join(raiz, '02-clientes', 'colormaq.md'), '# Dossiê Colormaq');
    fs.mkdirSync(path.join(raiz, '.obsidian'));
    fs.writeFileSync(path.join(raiz, '.obsidian', 'workspace.json'), '{}');
    fs.mkdirSync(path.join(raiz, 'notas'));
    fs.writeFileSync(path.join(raiz, 'notas', 'fratelli-briefing.md'), '# Briefing Fratelli');
    fs.writeFileSync(path.join(raiz, 'notas', 'imagem.png'), 'não é markdown');
  });

  afterEach(() => {
    fs.rmSync(raiz, { recursive: true, force: true });
  });

  it('acha os .md do vault, fora de 02-clientes/ e de pastas ocultas, recursivamente', () => {
    const arquivos = arquivosDoVault(raiz)
      .map((a) => path.relative(raiz, a))
      .sort();
    expect(arquivos).toEqual([path.join('notas', 'fratelli-briefing.md'), 'reuniao-colormaq.md']);
  });

  it('vault inexistente devolve lista vazia, nunca lança', () => {
    expect(arquivosDoVault(path.join(raiz, 'nao-existe'))).toEqual([]);
  });
});

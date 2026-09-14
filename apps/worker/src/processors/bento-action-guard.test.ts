import { describe, expect, it, vi } from 'vitest';

vi.mock('@desigual-os/database', () => ({ db: {}, schema: {} }));

/**
 * Regressão da falha medida ao vivo em 14/09/2026: "perfeito, atribua a task
 * a ele" criou uma task NOVA chamada "perfeito, a ele" porque a classificação
 * não reconhecia o verbo. O `\b` depois de prefixo ("atribu\b") nunca casa
 * "atribua" - o `a` seguinte é word char. Estes testes travam a intenção,
 * não o texto exato.
 */
describe('bento-action-guard: classificação de intenção', () => {
  it('"perfeito, atribua a task a ele" é update_assignee, NUNCA create', async () => {
    const { classifyIntentForTest } = await import('./bento-action-guard.js');
    const intent = classifyIntentForTest('perfeito, atribua a task a ele');
    expect(intent.kind).toBe('update_assignee');
  });

  it('"atribui essa task pra Jamile" é update_assignee com pessoa explícita', async () => {
    const { classifyIntentForTest } = await import('./bento-action-guard.js');
    const intent = classifyIntentForTest('atribui essa task pra Jamile');
    expect(intent.kind).toBe('update_assignee');
  });

  it('"muda o prazo dela pra amanhã" é update_due', async () => {
    const { classifyIntentForTest } = await import('./bento-action-guard.js');
    const intent = classifyIntentForTest('muda o prazo dela pra amanhã');
    expect(intent.kind).toBe('update_due');
  });

  it('"crie uma task pro Pedro chamada X" é create com pessoa', async () => {
    const { classifyIntentForTest } = await import('./bento-action-guard.js');
    const intent = classifyIntentForTest('crie uma task pro Pedro Gabriel chamada "Boas-vindas"');
    expect(intent.kind).toBe('create');
    if (intent.kind === 'create') {
      expect(intent.personName).toBe('Pedro Gabriel');
      expect(intent.taskName).toBe('Boas-vindas');
    }
  });

  it('consulta operacional NUNCA cai no guard', async () => {
    const { classifyIntentForTest } = await import('./bento-action-guard.js');
    expect(classifyIntentForTest('quantas tasks vencem hoje?').kind).toBe('none');
    expect(classifyIntentForTest('o que a Tammy precisa entregar?').kind).toBe('none');
    expect(classifyIntentForTest('como está a operação?').kind).toBe('none');
  });
});

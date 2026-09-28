import { describe, expect, it } from 'vitest';

/**
 * Medido no ClickUp REAL em 28/09/2026, logo depois de entregar os campos
 * novos. Cinco turnos na mesma task:
 *
 *   1. "cria a task ... prioridade alta, prazo amanhã"  -> funcionou
 *   2. "marca com a tag qa-teste"                       -> "já estava assim"
 *   3. "estima 2h e início amanhã"                      -> "já tinha feito isso"
 *   4. "abre um checklist com A e B"                    -> "já tinha feito isso"
 *   5. "status urgente"                                 -> "já tinha feito isso"
 *
 * A task ficou sem tag, sem estimativa, sem início e sem checklist. O planner
 * estava CERTO nos cinco (conferido chamando-o direto). Duas causas, as duas
 * do mesmo tipo — campo novo nascido fora de uma lista antiga:
 *
 *   (a) a chave de idempotência enumerava campo a campo e não conhecia os
 *       novos: três pedidos DIFERENTES viravam a mesma chave;
 *   (b) o early-return de "já estava assim" no executor roda antes das
 *       operações que não são PUT, então um pedido só-de-tag chegava lá com
 *       zero outcomes e era respondido como se nada tivesse sido pedido.
 *
 * Este teste trava (a). O (b) é ordem de execução dentro do executor, coberto
 * pelo comentário no próprio arquivo e pelo ciclo real.
 */

import { normalizeTaskName } from '@desigual-os/tool-gateway';

type Changes = Record<string, unknown> | null;

/** Cópia fiel de `canonicalizeChanges` (bento-openai-core.ts). */
function canonicalizeChanges(changes: Changes): unknown {
  if (!changes) return null;
  const entradas = Object.entries(changes)
    .filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0))
    .map<[string, unknown]>(([k, v]) => {
      if ((k === 'title' || k === 'assignee') && typeof v === 'string') return [k, normalizeTaskName(v)];
      if (typeof v === 'string') return [k, v.trim().toLowerCase()];
      if (Array.isArray(v)) return [k, v.map((x) => String(x).trim().toLowerCase()).sort()];
      if (typeof v === 'object') {
        return [k, Object.entries(v as Record<string, unknown>).map(([a, b]) => `${a.trim().toLowerCase()}=${String(b).trim().toLowerCase()}`).sort()];
      }
      return [k, v];
    })
    .sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entradas);
}

const chave = (c: Changes) => JSON.stringify(canonicalizeChanges(c));

describe('a chave de idempotência enxerga TODO campo do pedido', () => {
  it('os três turnos que a task real perdeu geram chaves DIFERENTES', () => {
    const tag = chave({ addTags: ['qa-teste'] });
    const estimativa = chave({ startDate: '2026-09-29', timeEstimate: '2h' });
    const checklist = chave({ checklistName: 'Revisão', checklistItems: ['revisar texto', 'exportar'] });
    const prioridade = chave({ priority: 'urgente' });
    expect(new Set([tag, estimativa, checklist, prioridade]).size).toBe(4);
  });

  it.each([
    ['prioridade', { priority: 'urgente' }],
    ['início', { startDate: '2026-09-29' }],
    ['estimativa', { timeEstimate: '2h' }],
    ['tag aplicada', { addTags: ['x'] }],
    ['tag removida', { removeTags: ['x'] }],
    ['campo personalizado', { customFields: { Etapa: 'Aprovação' } }],
    ['checklist', { checklistItems: ['a'] }],
    ['dependência', { dependsOnTaskId: 'T9' }],
    ['dependência inversa', { dependencyOfTaskId: 'T9' }],
  ])('%s sozinho já distingue o pedido de um pedido vazio', (_n, c) => {
    expect(chave(c)).not.toBe(chave({}));
  });

  it('o MESMO pedido repetido continua sendo a mesma chave — o retry segue protegido', () => {
    expect(chave({ addTags: ['qa-teste'] })).toBe(chave({ addTags: ['qa-teste'] }));
  });

  it('ordem de lista e de chave não inventa diferença', () => {
    expect(chave({ addTags: ['b', 'a'] })).toBe(chave({ addTags: ['a', 'b'] }));
    expect(chave({ priority: 'alta', status: 'pronto' })).toBe(chave({ status: 'pronto', priority: 'alta' }));
  });

  it('caixa do nome da pessoa não inventa pedido novo', () => {
    expect(chave({ assignee: 'Matheus Sain' })).toBe(chave({ assignee: 'matheus  sain' }));
  });

  it('valores diferentes do MESMO campo são pedidos diferentes', () => {
    expect(chave({ priority: 'alta' })).not.toBe(chave({ priority: 'urgente' }));
    expect(chave({ customFields: { Etapa: 'Briefing' } })).not.toBe(chave({ customFields: { Etapa: 'Aprovação' } }));
  });
});

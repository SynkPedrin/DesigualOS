import { describe, expect, it } from 'vitest';
import { extrairContextoDoHistoryItem } from './webhook-actor';

/**
 * A extração do autor/ocorrência do payload do ClickUp — pura, porque a regra
 * "nunca inventar quem mexeu" começa aqui: payload sem user.id NÃO produz autor.
 */
describe('extrairContextoDoHistoryItem', () => {
  it('extrai autor e data do primeiro history_item (payload real de taskUpdated)', () => {
    const raw = {
      event: 'taskUpdated',
      task_id: 'abc123',
      webhook_id: 'wh-1',
      history_items: [
        {
          id: 'hi-1',
          date: '1790844000000',
          field: 'status',
          user: { id: 12345678, username: 'Ana Souza', email: 'ana@desigual.com', color: '#000', initials: 'AS' },
        },
      ],
    };
    const ctx = extrairContextoDoHistoryItem(raw);
    expect(ctx.autor).toEqual({ clickupUserId: '12345678', username: 'Ana Souza', email: 'ana@desigual.com' });
    expect(ctx.ocorridoEm).toEqual(new Date(1790844000000));
  });

  it('user.id como string também é aceito', () => {
    const ctx = extrairContextoDoHistoryItem({
      history_items: [{ user: { id: '987', username: 'Gui', email: null }, date: '1790844000000' }],
    });
    expect(ctx.autor?.clickupUserId).toBe('987');
  });

  it('history_items vazio (taskCreated às vezes vem assim) -> sem autor, sem data', () => {
    expect(extrairContextoDoHistoryItem({ history_items: [] })).toEqual({ autor: null, ocorridoEm: null });
  });

  it('item sem user -> autor null (nunca inventar), data ainda aproveitada', () => {
    const ctx = extrairContextoDoHistoryItem({ history_items: [{ date: '1790844000000', field: 'status' }] });
    expect(ctx.autor).toBeNull();
    expect(ctx.ocorridoEm).toEqual(new Date(1790844000000));
  });

  it('raw ausente ou malformado -> nulls, sem lançar', () => {
    expect(extrairContextoDoHistoryItem(undefined)).toEqual({ autor: null, ocorridoEm: null });
    expect(extrairContextoDoHistoryItem({ history_items: 'nao-e-array' })).toEqual({ autor: null, ocorridoEm: null });
    expect(extrairContextoDoHistoryItem({ history_items: [{ date: 'lixo' }] })).toEqual({ autor: null, ocorridoEm: null });
  });
});

import { describe, expect, it, vi } from 'vitest';

vi.mock('@desigual-os/database', () => ({ db: {}, schema: {} }));
const { deveAbrirSozinho, elegivel } = await import('./service');

const agora = new Date('2026-10-21T12:00:00Z');
const base = { active: true, rollout: 'all', qaUserIds: [] as string[], publishedAt: new Date('2026-10-01T00:00:00Z'), expiresAt: null as Date | null, audience: { modules: ['comunicacao'] } };
const pessoa = { id: 'u1', roles: ['member'], modulos: new Set(['comunicacao']), organizationId: 'o1' };

describe('elegivel', () => {
  it('ativo, publicado, sem expirar, com o módulo: vê', () => {
    expect(elegivel(base, pessoa, agora)).toBe(true);
  });
  it('desligado, inativo, ainda não publicado ou já expirado: não vê', () => {
    expect(elegivel({ ...base, rollout: 'off' }, pessoa, agora)).toBe(false);
    expect(elegivel({ ...base, active: false }, pessoa, agora)).toBe(false);
    expect(elegivel({ ...base, publishedAt: new Date('2026-11-01T00:00:00Z') }, pessoa, agora)).toBe(false);
    expect(elegivel({ ...base, expiresAt: new Date('2026-10-20T00:00:00Z') }, pessoa, agora)).toBe(false);
  });
  it('público: módulo, papel e empresa', () => {
    expect(elegivel(base, { ...pessoa, modulos: new Set(['hoje']) }, agora)).toBe(false);
    expect(elegivel({ ...base, audience: { roles: ['master'] } }, pessoa, agora)).toBe(false);
    expect(elegivel({ ...base, audience: { organization_ids: ['o2'] } }, pessoa, agora)).toBe(false);
    expect(elegivel({ ...base, audience: { organization_ids: ['o1'] } }, pessoa, agora)).toBe(true);
  });
  it('QA: só quem está na lista; rollout desconhecido não vale', () => {
    expect(elegivel({ ...base, rollout: 'qa' }, pessoa, agora)).toBe(false);
    expect(elegivel({ ...base, rollout: 'qa', qaUserIds: ['u1'] }, pessoa, agora)).toBe(true);
    expect(elegivel({ ...base, rollout: 'tudo' }, pessoa, agora)).toBe(false);
  });
});

describe('deveAbrirSozinho', () => {
  const a = { display: { auto_open: true } };
  it('uma vez: sem estado abre; já apresentado, dispensado ou concluído não', () => {
    expect(deveAbrirSozinho(a, null)).toBe(true);
    expect(deveAbrirSozinho(a, { autoShownAt: null, state: 'not_seen' })).toBe(true);
    expect(deveAbrirSozinho(a, { autoShownAt: new Date(), state: 'not_seen' })).toBe(false);
    expect(deveAbrirSozinho(a, { autoShownAt: null, state: 'dismissed' })).toBe(false);
    expect(deveAbrirSozinho(a, { autoShownAt: null, state: 'completed' })).toBe(false);
    expect(deveAbrirSozinho({ display: { auto_open: false } }, null)).toBe(false);
  });
});

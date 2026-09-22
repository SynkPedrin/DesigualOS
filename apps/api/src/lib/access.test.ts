import { describe, expect, it } from 'vitest';
import { canActOnStudioEntity, canDeleteCanvasDocument } from './access';
import type { AuthenticatedUser } from '../auth/middleware';

function user(id: string, roles: string[] = ['colaborador'], studioWrite = true): { user: AuthenticatedUser; opts: { hasStudioWrite: boolean } } {
  return {
    user: { id, email: `${id}@test`, name: id, roles, permissions: [] } as unknown as AuthenticatedUser,
    opts: { hasStudioWrite: studioWrite },
  };
}

describe('canActOnStudioEntity', () => {
  it('o dono pode agir na própria peça', () => {
    const a = user('user-a');
    expect(canActOnStudioEntity(a.user, 'user-a', a.opts)).toBe(true);
  });

  /**
   * O vazamento real corrigido em 17/09/2026: as rotas de escrita do Studio
   * combinavam `studio:write` com `hasClientAccess`, que devolve `true` pra
   * todo mundo por decisão de produto - na prática qualquer colaborador
   * apagava ou cancelava o job de qualquer outro.
   */
  it('colaborador NÃO age na peça de outro, mesmo tendo studio:write', () => {
    const b = user('user-b', ['colaborador'], true);
    expect(canActOnStudioEntity(b.user, 'user-a', b.opts)).toBe(false);
  });

  it('master age em qualquer peça', () => {
    const m = user('user-m', ['master'], false);
    expect(canActOnStudioEntity(m.user, 'user-a', m.opts)).toBe(true);
  });

  it('usuário sem vínculo nenhum não age', () => {
    const c = user('user-c', ['colaborador'], false);
    expect(canActOnStudioEntity(c.user, 'user-a', c.opts)).toBe(false);
  });

  /**
   * Peça sem dono: jobs anteriores à coluna `requested_by` e assets
   * importados do histórico do ComfyUI. Exigir posse deixaria esse lixo
   * impossível de limpar; por isso, e só nesse caso, vale a permissão do
   * módulo.
   */
  it('peça órfã (sem dono) cai na permissão do módulo', () => {
    const comWrite = user('user-x', ['colaborador'], true);
    const semWrite = user('user-y', ['colaborador'], false);
    expect(canActOnStudioEntity(comWrite.user, null, comWrite.opts)).toBe(true);
    expect(canActOnStudioEntity(semWrite.user, null, semWrite.opts)).toBe(false);
  });
});

describe('canDeleteCanvasDocument', () => {
  it('permite o proprietário', () => {
    const a = user('user-a');
    expect(canDeleteCanvasDocument(a.user, 'user-a')).toBe(true);
  });

  it('bloqueia outro colaborador', () => {
    const b = user('user-b');
    expect(canDeleteCanvasDocument(b.user, 'user-a')).toBe(false);
  });

  it('permite master em qualquer documento', () => {
    const m = user('user-m', ['master']);
    expect(canDeleteCanvasDocument(m.user, 'user-a')).toBe(true);
    expect(canDeleteCanvasDocument(m.user, null)).toBe(true);
  });

  it('bloqueia documentos legados sem proprietário para colaboradores', () => {
    const c = user('user-c');
    expect(canDeleteCanvasDocument(c.user, null)).toBe(false);
  });
});

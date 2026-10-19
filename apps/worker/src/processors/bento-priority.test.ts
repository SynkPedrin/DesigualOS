import { describe, expect, it } from 'vitest';
import { mapPrioridade, desviarStatusQueEhPrioridade } from './bento-priority';

/**
 * 28/09/2026, ao vivo com a Tammy: "altere o status dessa task para urgente"
 * voltou com a lista de status válidos. A recusa estava certa ("urgente" não é
 * status) e parava no lugar errado — prioridade é campo do ClickUp que o
 * executor já escrevia, e faltava só o plano carregá-lo.
 */

describe('tradução de prioridade', () => {
  it.each([
    ['urgente', 1],
    ['URGENTE', 1],
    ['urgência máxima', 1],
    ['crítico', 1],
    ['alta', 2],
    ['high', 2],
    ['normal', 3],
    ['média', 3],
    ['baixa', 4],
    ['low', 4],
  ])('%s -> %i', (texto, valor) => {
    expect(mapPrioridade(texto)).toBe(valor);
  });

  it.each(['', '   ', 'pronto', 'em revisão', 'aguardando aprovação', null, undefined])(
    '%s não vira prioridade nenhuma (nunca chuta)',
    (texto) => {
      expect(mapPrioridade(texto as string | null | undefined)).toBeNull();
    },
  );
});

describe('"status" que na verdade é prioridade', () => {
  it('o caso exato da Tammy', () => {
    const r = desviarStatusQueEhPrioridade({ status: 'urgente' });
    expect(r.desviado).toBe(true);
    expect(r.priority).toBe('urgente');
    expect(r.status).toBeUndefined();
  });

  it.each(['urgente', 'alta', 'prioridade alta', 'baixa', 'para urgente'])('%s desvia', (s) => {
    expect(desviarStatusQueEhPrioridade({ status: s }).desviado).toBe(true);
  });

  it.each(['pronto', 'encerrado', 'aguardando aprovação', 'em revisão', 'reprovado', 'concluída'])(
    '%s continua sendo STATUS de fluxo',
    (s) => {
      const r = desviarStatusQueEhPrioridade({ status: s });
      expect(r.desviado).toBe(false);
      expect(r.status).toBe(s);
    },
  );

  it('prioridade já preenchida pelo planner não é mexida', () => {
    const r = desviarStatusQueEhPrioridade({ status: 'pronto', priority: 'alta' });
    expect(r.desviado).toBe(false);
    expect(r.status).toBe('pronto');
    expect(r.priority).toBe('alta');
  });

  it('sem status não há o que desviar', () => {
    expect(desviarStatusQueEhPrioridade({}).desviado).toBe(false);
  });
});

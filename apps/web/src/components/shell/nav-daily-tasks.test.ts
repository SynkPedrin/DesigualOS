import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from './nav-items';
import { itensVisiveisNaNavegacao } from './nav-visibility';

const base = { isMaster: true, ehProvider: true, dentroDeTenant: false };
const temDailyTasks = (f: Parameters<typeof itensVisiveisNaNavegacao>[1]) =>
  itensVisiveisNaNavegacao(NAV_ITEMS, f).some((i) => i.href === '/daily-tasks');

describe('item Daily Tasks', () => {
  it('nasce escondido: sem resposta do servidor ou com allowed=false não aparece, nem para master', () => {
    expect(temDailyTasks(base)).toBe(false);
    expect(temDailyTasks({ ...base, dailyTasksLiberado: false })).toBe(false);
  });
  it('aparece só quando o servidor libera', () => {
    expect(temDailyTasks({ ...base, dailyTasksLiberado: true })).toBe(true);
  });
});

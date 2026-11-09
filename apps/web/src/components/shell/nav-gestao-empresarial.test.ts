import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from './nav-items';
import { itensVisiveisNaNavegacao } from './nav-visibility';

const base = { isMaster: true, ehProvider: true, dentroDeTenant: false };
const tem = (f: Parameters<typeof itensVisiveisNaNavegacao>[1]) => itensVisiveisNaNavegacao(NAV_ITEMS, f).some((i) => i.href === '/gestao-empresarial');

describe('item Gestão Empresarial', () => {
  it('nasce escondido: sem resposta do servidor ou com allowed=false não aparece, nem para master', () => {
    expect(tem(base)).toBe(false);
    expect(tem({ ...base, gestaoEmpresarialLiberada: false })).toBe(false);
  });
  it('aparece só quando o servidor libera E a pessoa é master', () => {
    expect(tem({ ...base, gestaoEmpresarialLiberada: true })).toBe(true);
    expect(tem({ ...base, isMaster: false, gestaoEmpresarialLiberada: true })).toBe(false);
  });
  it('é um item só: a navegação interna mora dentro do módulo, não no menu', () => {
    expect(NAV_ITEMS.filter((i) => i.href.startsWith('/gestao-empresarial'))).toHaveLength(1);
  });
  it('não colide com a "Gestão da equipe" (/gestao)', () => {
    expect(NAV_ITEMS.find((i) => i.href === '/gestao')?.label).toBe('Gestão da equipe');
  });
});

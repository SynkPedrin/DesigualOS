import { describe, expect, it } from 'vitest';
import { aplicarMarca, corSegura } from './brand-provider';

/**
 * A marca de cada empresa entra por variável CSS, em tempo de execução — é o
 * que permite UMA aplicação servir muitas marcas, em vez de um build por
 * cliente (seção 68 do briefing).
 *
 * O que estes testes protegem não é a cor: é que valor vindo de CONFIGURAÇÃO
 * não vira CSS arbitrário. Configuração de tenant é dado de entrada como
 * qualquer outro, e vai parar direto num `style` do documento.
 */
describe('cor vinda de configuração', () => {
  it('aceita os formatos de cor de verdade', () => {
    expect(corSegura('#9333ea')).toBe('#9333ea');
    expect(corSegura('#abc')).toBe('#abc');
    expect(corSegura('rgb(147, 51, 234)')).toBe('rgb(147, 51, 234)');
    expect(corSegura('  #9333EA  ')).toBe('#9333EA');
  });

  /**
   * O caso que justifica a validação existir. Sem ela, a string entraria
   * inteira numa variável CSS do documento.
   */
  it('recusa o que não é cor', () => {
    expect(corSegura('url(javascript:alert(1))')).toBeNull();
    expect(corSegura('red; background: url(http://evil)')).toBeNull();
    expect(corSegura('expression(alert(1))')).toBeNull();
    expect(corSegura('')).toBeNull();
    expect(corSegura(null)).toBeNull();
    expect(corSegura(undefined)).toBeNull();
  });
});

describe('aplicação da marca no documento', () => {
  function raizFalsa() {
    const props = new Map<string, string>();
    return {
      props,
      el: {
        style: {
          setProperty: (k: string, v: string) => props.set(k, v),
          removeProperty: (k: string) => props.delete(k),
        },
      } as unknown as HTMLElement,
    };
  }

  it('escreve as cores configuradas', () => {
    const { props, el } = raizFalsa();

    aplicarMarca(el, { primary: '#00ff88', secondary: '#005533' });

    expect(props.get('--color-brand-primary')).toBe('#00ff88');
    expect(props.get('--color-brand-secondary')).toBe('#005533');
  });

  /**
   * SEM COR CONFIGURADA, REMOVE em vez de escrever um padrão. Assim o token
   * volta a apontar para o da Desigual — que é o comportamento certo e o único
   * que não precisa ser mantido em dois lugares.
   */
  it('sem marca, não deixa sobrescrita para trás', () => {
    const { props, el } = raizFalsa();

    aplicarMarca(el, { primary: '#00ff88' });
    expect(props.has('--color-brand-primary')).toBe(true);

    aplicarMarca(el, null);
    expect(props.has('--color-brand-primary')).toBe(false);
  });

  it('cor inválida não é escrita — nem como valor, nem como sobra', () => {
    const { props, el } = raizFalsa();

    aplicarMarca(el, { primary: 'url(javascript:alert(1))' });

    expect(props.has('--color-brand-primary')).toBe(false);
  });
});

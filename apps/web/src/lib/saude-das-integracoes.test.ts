import { describe, expect, it } from 'vitest';
import { saudeDasIntegracoes } from './saude-das-integracoes';

const conectada = { connected: true, configured: true };
const pronta = { connected: false, configured: true };
const semConfig = { connected: false, configured: false };

/**
 * Numa tela de integração, verde por omissão é a mentira mais fácil de contar:
 * ninguém confere "está tudo certo", e quando descobre que não estava, já
 * perdeu o dia procurando o problema noutro lugar.
 */
describe('saudeDasIntegracoes', () => {
  it('tudo conectado é tudo conectado', () => {
    const r = saudeDasIntegracoes([conectada, conectada]);
    expect(r.rotulo).toBe('Tudo conectado');
    expect(r.proporcao).toBe(1);
  });

  it('metade conectada é Parcial, nunca Excelente', () => {
    const r = saudeDasIntegracoes([conectada, pronta]);
    expect(r.rotulo).toBe('Parcial');
    expect(r.proporcao).toBe(0.5);
  });

  /**
   * O caso que mais importa: média sobre conjunto vazio dá 100% em muita
   * implementação ingênua, e a tela anunciaria saúde perfeita sem ter uma
   * única integração.
   */
  it('nenhuma configurada NÃO vira saúde perfeita', () => {
    const r = saudeDasIntegracoes([semConfig, semConfig]);
    expect(r.rotulo).toBe('Sem configuração');
    expect(r.proporcao).toBeNull();
    expect(r.conectadas).toBe(0);
  });

  it('lista vazia também não inventa saúde', () => {
    expect(saudeDasIntegracoes([]).rotulo).toBe('Sem configuração');
  });

  /**
   * Falta de variável de ambiente não conta como problema de SAÚDE — é
   * trabalho de administrador. Misturar as duas esconde as duas: a conexão que
   * um clique resolve e a que precisa de alguém mexer no ambiente.
   */
  it('separa o que um clique resolve do que depende de administrador', () => {
    const r = saudeDasIntegracoes([conectada, pronta, semConfig]);
    expect(r.conectadas).toBe(1);
    expect(r.prontas).toBe(1);
    expect(r.semConfiguracao).toBe(1);
    // A proporção olha só as configuradas: 1 de 2, não 1 de 3.
    expect(r.proporcao).toBe(0.5);
  });

  /**
   * O estado que ninguém escreve de propósito e o ambiente produz sozinho:
   * alguém tira a variável de ambiente DEPOIS que a conexão já foi feita.
   * Tratando `connected` e `configured` como independentes, a conta dava
   * `prontas: -1` e proporção acima de 100% — a tela reportando mais
   * conectadas do que conectáveis.
   */
  it('conectada sem configuração não produz contagem negativa nem passa de 100%', () => {
    const orfa = { connected: true, configured: false };
    const r = saudeDasIntegracoes([orfa, pronta]);
    expect(r.conectadas).toBe(1);
    expect(r.prontas).toBe(1);
    expect(r.semConfiguracao).toBe(0);
    expect(r.proporcao).toBe(0.5);
    expect(r.rotulo).toBe('Parcial');
  });

  it('nenhuma contagem é negativa, em qualquer combinação', () => {
    const todos = [
      { connected: true, configured: true },
      { connected: true, configured: false },
      { connected: false, configured: true },
      { connected: false, configured: false },
    ];
    for (const a of todos) {
      for (const b of todos) {
        const r = saudeDasIntegracoes([a, b]);
        expect(r.prontas).toBeGreaterThanOrEqual(0);
        expect(r.semConfiguracao).toBeGreaterThanOrEqual(0);
        expect(r.conectadas + r.prontas + r.semConfiguracao).toBe(r.total);
        if (r.proporcao !== null) {
          expect(r.proporcao).toBeGreaterThanOrEqual(0);
          expect(r.proporcao).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('estado ainda carregando não entra na conta', () => {
    const r = saudeDasIntegracoes([conectada, undefined, undefined]);
    expect(r.total).toBe(1);
    expect(r.proporcao).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { ehFixture, ehInterno, escopoOperacional, naturezaDoCliente, separarCarteira } from './natureza-do-cliente';

/**
 * A CARTEIRA REAL, copiada do banco em 29/09/2026 (51 linhas).
 *
 * Este array é a trava do padrão de segurança: se alguém ampliar
 * PADRAO_DE_FIXTURE e um cliente pagante passar a casar, o teste quebra ANTES
 * de o cliente sumir de um relatório. É o inverso do teste que confirma o
 * exemplo do commit — aqui o que se protege é tudo que NÃO deve mudar.
 */
const CARTEIRA_REAL = [
  '🔥 Construtora e Imobiliária Cosentino Ltda. — Enterprise', '3Net', 'Abitte Urbanismo',
  'Aeroclube Birigui', 'Alves Componentes', 'AMGR CONSTRUTORA', 'APAE', 'Areia Branca',
  'BIO FIT', 'Biofit', 'Botini', 'Bravvo', 'Cardassi', 'Clínica Santa Maria', 'Colormaq',
  'Colpar', 'Colpar Brasil', 'Cond. Pôr do Sol', 'Consdon', 'Cosentino', 'Costa Azul',
  'D. Carvalho', 'Da Mata', 'DCS - Diagnostico por imagem', 'Dra. Thais Bertelli', 'Elite',
  'Engeuni', 'Envu', 'EQUILIBRIUM', 'Fácil Seguros', 'FESTARA', 'Gelateria Fratelli',
  'Home Center Tecaut', 'Ibiza II', 'IPIS', 'Jardim do Lago', 'John Deere', 'Lexeer',
  'Mamma Mia', 'Missão Guadalupe', 'Modulo One', 'Oh My Skin', 'Pequito calçados',
  'SETCATA', 'Sonhar Painéis', 'Specialist', 'Takata', 'TOP TENNIS CLUB', 'Yak Sushibar',
];

describe('naturezaDoCliente — nem toda linha de clients é cliente', () => {
  it('NENHUM cliente pagante é reclassificado — a trava que mais importa', () => {
    for (const nome of CARTEIRA_REAL) {
      expect(naturezaDoCliente(nome), `"${nome}" deixou de ser CLIENTE`).toBe('CLIENTE');
    }
  });

  it('o fixture de QA que aparecia no panorama sai', () => {
    // "teste" apareceu com 27 atrasadas e 27 sem dono numa resposta real.
    expect(ehFixture('teste')).toBe(true);
    expect(ehFixture('Cliente Teste 7')).toBe(true);
    expect(ehFixture('Clinica Teste Fase 7')).toBe(true);
    expect(ehFixture('Lista QA')).toBe(true);
  });

  it('a casa e os produtos internos são INTERNO, não cliente', () => {
    expect(ehInterno('Agência Desigual')).toBe(true);
    expect(ehInterno('🔥 CITÁVEL™ — Enterprise')).toBe(true);
    expect(ehInterno('Endrigo Almada')).toBe(true);
    expect(ehInterno('André Almada')).toBe(true);
  });

  it('as DUAS grafias do Case #0 caem no mesmo lugar', () => {
    // O banco tem a linha duplicada variando só a caixa.
    expect(naturezaDoCliente('🧪 Case #0 — Endrigo Almada / CITÁVEL™')).toBe('INTERNO');
    expect(naturezaDoCliente('🧪 CASE #0 — Endrigo Almada / CITÁVEL™')).toBe('INTERNO');
  });

  it('acento, emoji e caixa não mudam a classificação', () => {
    expect(naturezaDoCliente('AGÊNCIA DESIGUAL')).toBe('INTERNO');
    expect(naturezaDoCliente('agencia desigual')).toBe('INTERNO');
    expect(naturezaDoCliente('  Teste  ')).toBe('FIXTURE');
  });

  it('o padrão de segurança exige palavra INTEIRA', () => {
    // Um cliente cujo nome CONTÉM as letras não pode virar fixture.
    expect(naturezaDoCliente('Contestado Urbanismo')).toBe('CLIENTE');
    expect(naturezaDoCliente('Protesta Comunicação')).toBe('CLIENTE');
    expect(naturezaDoCliente('Qatar Investimentos')).toBe('CLIENTE');
  });

  it('nome vazio não vira fixture por acidente', () => {
    expect(naturezaDoCliente('')).toBe('CLIENTE');
    expect(naturezaDoCliente('   ')).toBe('CLIENTE');
  });
});

describe('separarCarteira — devolve os três para que o corte seja DECLARÁVEL', () => {
  const linhas = [
    { name: 'Cosentino' }, { name: 'teste' }, { name: 'Agência Desigual' },
    { name: 'D. Carvalho' }, { name: 'Cliente Teste 7' },
  ];

  it('separa as três naturezas preservando a ordem', () => {
    const r = separarCarteira(linhas);
    expect(r.carteira.map((c) => c.name)).toEqual(['Cosentino', 'D. Carvalho']);
    expect(r.internos.map((c) => c.name)).toEqual(['Agência Desigual']);
    expect(r.fixtures.map((c) => c.name)).toEqual(['teste', 'Cliente Teste 7']);
  });

  it('o INTERNO continua no escopo operacional — é trabalho de verdade', () => {
    // Esconder as 170 tarefas da casa trocaria um erro por outro pior.
    const nomes = escopoOperacional(linhas).map((c) => c.name);
    expect(nomes).toContain('Agência Desigual');
    expect(nomes).not.toContain('teste');
    expect(nomes).not.toContain('Cliente Teste 7');
  });

  it('lista vazia não quebra', () => {
    const r = separarCarteira([]);
    expect(r.carteira).toEqual([]);
    expect(escopoOperacional([])).toEqual([]);
  });
});

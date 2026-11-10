import { describe, expect, it } from 'vitest';
import { formatarBlocoDeProdutividade, perguntaEhDeProdutividade, type ProdutividadeDePessoa } from './person-productivity';

describe('perguntaEhDeProdutividade', () => {
  it.each([
    'quantas tarefas o Gui tá finalizando por dia',
    'como está a produtividade do Gui',
    'quantas tasks o Gui mudou pra aprovação essa semana',
    'o que o Gui entregou essa semana',
    'qual o rendimento do Gui',
  ])('reconhece: %s', (mensagem) => {
    expect(perguntaEhDeProdutividade(mensagem)).toBe(true);
  });

  it.each([
    'bom dia',
    'o que mudou na Cosentino essa semana?',
    'cria uma task pro Gui revisar o post',
    'status da tarefa de Natal',
  ])('ignora: %s', (mensagem) => {
    expect(perguntaEhDeProdutividade(mensagem)).toBe(false);
  });

  it('ignora o encanamento depois do separador de contexto', () => {
    expect(perguntaEhDeProdutividade('bom dia\n\n---\nContexto: produtividade finalizando')).toBe(false);
  });
});

describe('formatarBlocoDeProdutividade', () => {
  const base: ProdutividadeDePessoa = {
    userId: 'u1',
    nome: 'Guilherme',
    concluidasPorDia: [
      { dia: '2026-11-09', n: 3 },
      { dia: '2026-11-10', n: 2 },
    ],
    totalConcluidas14d: 5,
    avancosPorDia: [{ dia: '2026-11-10', n: 4 }],
    totalAvancos14d: 4,
    abertasAgora: 16,
    atrasadasAgora: 9,
  };

  it('lista os números por dia e o total', () => {
    const bloco = formatarBlocoDeProdutividade([base]);
    expect(bloco).toContain('Guilherme');
    expect(bloco).toContain('5 concluída(s)');
    expect(bloco).toContain('2026-11-09: 3');
    expect(bloco).toContain('2026-11-10: 4');
    expect(bloco).toContain('16 em aberto');
    expect(bloco).toContain('9 atrasada(s)');
  });

  it('declara ausência no período sem inventar zero', () => {
    const bloco = formatarBlocoDeProdutividade([{ ...base, concluidasPorDia: [], totalConcluidas14d: 0 }]);
    expect(bloco).toContain('nenhuma nos últimos 14 dias');
  });

  it('lista vazia não vira bloco', () => {
    expect(formatarBlocoDeProdutividade([])).toBe('');
  });
});

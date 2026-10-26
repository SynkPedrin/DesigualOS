import { describe, expect, it } from 'vitest';
import { diaEmSaoPaulo, textoDoPrazo, urgenciaDoPrazo } from './prazo';

// 26/10/2026, 15h em São Paulo (18h UTC)
const agora = new Date('2026-10-26T18:00:00Z');

describe('em que dia cai o prazo (fuso de São Paulo)', () => {
  it('a meia-noite UTC ainda é o dia anterior em São Paulo', () => {
    expect(diaEmSaoPaulo(new Date('2026-10-27T01:30:00Z'))).toBe('2026-10-26');
    expect(diaEmSaoPaulo('2026-10-26')).toBe('2026-10-26');
  });

  it('prazo é DIA: um horário de hoje que já passou continua sendo HOJE (o Daily Tasks grava ao meio-dia)', () => {
    expect(urgenciaDoPrazo(new Date('2026-10-27T02:59:00Z'), { agora })).toBe('hoje');
    expect(urgenciaDoPrazo(new Date('2026-10-26T12:00:00Z'), { agora })).toBe('hoje');
    expect(urgenciaDoPrazo(new Date('2026-10-25T20:00:00Z'), { agora })).toBe('atrasado');
  });

  it('compromisso com hora marcada (temHora): passou da hora hoje já é ATRASADA', () => {
    expect(urgenciaDoPrazo(new Date('2026-10-27T02:59:00Z'), { agora, temHora: true })).toBe('hoje');
    expect(urgenciaDoPrazo(new Date('2026-10-26T12:00:00Z'), { agora, temHora: true })).toBe('atrasado');
  });

  it('prazo SÓ DE DIA vale o dia inteiro: hoje é HOJE mesmo às 15h', () => {
    expect(urgenciaDoPrazo('2026-10-26', { agora })).toBe('hoje');
    expect(urgenciaDoPrazo('2026-10-25', { agora })).toBe('atrasado');
  });

  it('amanhã, esta semana e depois', () => {
    expect(urgenciaDoPrazo('2026-10-27', { agora })).toBe('amanha');
    expect(urgenciaDoPrazo('2026-11-02', { agora })).toBe('semana');
    expect(urgenciaDoPrazo('2026-11-03', { agora })).toBe('depois');
  });

  it('timestamp numérico (como o ClickUp manda) também funciona', () => {
    expect(urgenciaDoPrazo(new Date('2026-10-26T23:00:00Z').getTime(), { agora })).toBe('hoje');
  });

  it('sem prazo, sem urgência', () => {
    expect(urgenciaDoPrazo(null, { agora })).toBeNull();
    expect(urgenciaDoPrazo(undefined, { agora })).toBeNull();
    expect(urgenciaDoPrazo('', { agora })).toBeNull();
  });
});

describe('texto do prazo', () => {
  it('HOJE em maiúsculas; atraso em dias; o resto discreto', () => {
    expect(textoDoPrazo('2026-10-26', 'hoje', { agora })).toBe('HOJE');
    expect(textoDoPrazo('2026-10-23', 'atrasado', { agora })).toBe('ATRASADA · 3 DIAS');
    expect(textoDoPrazo('2026-10-25', 'atrasado', { agora })).toBe('ATRASADA · 1 DIA');
    expect(textoDoPrazo(new Date('2026-10-26T12:00:00Z'), 'atrasado', { agora })).toBe('ATRASADA · HOJE');
    expect(textoDoPrazo('2026-10-23', 'atrasado', { agora, feminino: false })).toBe('ATRASADO · 3 DIAS');
    expect(textoDoPrazo('2026-10-27', 'amanha', { agora })).toBe('Amanhã');
    expect(textoDoPrazo('2026-10-30', 'semana', { agora })).toBe('Em 4 dias');
    expect(textoDoPrazo('2026-11-12', 'depois', { agora })).toBe('12/11');
  });
});

import { estaEmAprovacao } from './prazo';

describe('está aguardando aprovação?', () => {
  it('categoria do quadro geral manda; sem categoria, o nome da coluna', () => {
    expect(estaEmAprovacao({ categoria: 'em_aprovacao' })).toBe(true);
    expect(estaEmAprovacao({ categoria: 'em_andamento', label: 'Aprovação' })).toBe(false);
    expect(estaEmAprovacao({ label: 'Aguardando aprovação do cliente' })).toBe(true);
    expect(estaEmAprovacao({ clickupStatus: 'EM APROVAÇÃO' })).toBe(true);
    expect(estaEmAprovacao({ label: 'Em revisão' })).toBe(false);
    expect(estaEmAprovacao('aprovar')).toBe(true);
    expect(estaEmAprovacao(null)).toBe(false);
  });
});

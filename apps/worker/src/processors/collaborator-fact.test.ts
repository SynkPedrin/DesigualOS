import { describe, expect, it } from 'vitest';
import { extrairFatoDeColaborador, respostaDoRegistro, type MembroDaEquipe } from './collaborator-fact';

const ana: MembroDaEquipe = { userId: 'u-ana', nome: 'Ana Souza', gestor: false };
const bruno: MembroDaEquipe = { userId: 'u-bruno', nome: 'Bruno Lima', gestor: true };
const caio: MembroDaEquipe = { userId: 'u-caio', nome: 'Caio Reis', gestor: false };
const EQUIPE = [ana, bruno, caio];

describe('extrairFatoDeColaborador', () => {
  it('o exemplo da missão: preferência própria sem "anota" é confirmada e é DELA', () => {
    const f = extrairFatoDeColaborador('Bento, quando eu receber um briefing de Reels, preciso do objetivo, público, referências e CTA.', ana, EQUIPE)!;
    expect(f.alvo.userId).toBe('u-ana');
    expect(f.classe).toBe('CONFIRMED_PREFERENCE');
    expect(f.aspecto).toBe('briefing');
    expect(f.subject).toBe('colaborador:u-ana:briefing');
    expect(f.texto).toContain('objetivo, público, referências e CTA');
  });
  it('gestão registrando responsabilidade de alguém = FACT, no perfil oficial', () => {
    const f = extrairFatoDeColaborador('Anota que a Ana é responsável pelos carrosséis da Alfa', bruno, EQUIPE)!;
    expect(f.alvo.userId).toBe('u-ana');
    expect(f.classe).toBe('FACT');
    expect(f.subject).toBe('colaborador:u-ana:responsabilidade');
  });
  it('colega falando de outro = INFERENCE num registro próprio, que nunca substitui o da pessoa', () => {
    const f = extrairFatoDeColaborador('Anota que o Bruno prefere briefing em áudio', ana, EQUIPE)!;
    expect(f.alvo.userId).toBe('u-bruno');
    expect(f.classe).toBe('INFERENCE');
    expect(f.subject).toBe('colaborador:u-bruno:briefing:por:u-ana');
  });
  it('colaborador comum declarando responsabilidade de outro também é INFERENCE', () => {
    expect(extrairFatoDeColaborador('Anota que o Caio é responsável pelo tráfego', ana, EQUIPE)!.classe).toBe('INFERENCE');
  });
  it('autodeclaração de responsabilidade fica a confirmar pela gestão', () => {
    const f = extrairFatoDeColaborador('Anota que eu sou responsável pelos relatórios mensais', ana, EQUIPE)!;
    expect(f.classe).toBe('INFERENCE');
    expect(f.subject).toBe('colaborador:u-ana:responsabilidade:por:u-ana');
  });
  it('sobre outra pessoa SEM verbo de registro: contado de passagem, não grava', () => {
    expect(extrairFatoDeColaborador('O Bruno prefere briefing em áudio', ana, EQUIPE)).toBeNull();
  });
  it('pergunta e pedido não são ensino', () => {
    expect(extrairFatoDeColaborador('Como o Bruno prefere receber briefing?', ana, EQUIPE)).toBeNull();
    expect(extrairFatoDeColaborador('Cria uma task pro Bruno revisar o briefing', ana, EQUIPE)).toBeNull();
  });
  it('pessoa fora da equipe não vira alvo (nome que não existe é descartado)', () => {
    expect(extrairFatoDeColaborador('Anota que a Sofia prefere briefing curto', ana, EQUIPE)).toBeNull();
  });
  it('nome ambíguo não escolhe ninguém', () => {
    const duasAnas = [...EQUIPE, { userId: 'u-ana2', nome: 'Ana Costa', gestor: false }];
    expect(extrairFatoDeColaborador('Anota que a Ana prefere briefing curto', bruno, duasAnas)).toBeNull();
  });
  it('fora do trabalho não grava: só aspecto operacional ou preferência explícita', () => {
    expect(extrairFatoDeColaborador('Anota que o Caio torce pro Corinthians', ana, EQUIPE)).toBeNull();
  });
});

describe('respostaDoRegistro', () => {
  it('diz a procedência e não promete o que não é', () => {
    const f = extrairFatoDeColaborador('Anota que o Bruno prefere briefing em áudio', ana, EQUIPE)!;
    const r = respostaDoRegistro(f, 'u-ana');
    expect(r).toContain('Anotado sobre Bruno Lima');
    expect(r).toContain('sem confirmação de Bruno');
  });
});

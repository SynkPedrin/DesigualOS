import { describe, expect, it } from 'vitest';
import {
  agruparConexoes,
  redigirAviso,
  JANELA_DE_OLHAR_MS,
  SILENCIO_POR_PESSOA_MS,
  type EventoDeConexao,
} from './aviso-de-conexao-mcp';

/**
 * A rajada real, copiada do banco em 30/09/2026: seis sessões da MESMA pessoa
 * em cinco segundos. É o caso que define o desenho inteiro deste vigia, então é
 * o caso que o teste carrega — inventar uma rajada bonitinha esconderia
 * justamente o que a medição ensinou.
 */
const BASE = new Date('2026-09-30T02:32:16.183Z');
const RAJADA_REAL: EventoDeConexao[] = [
  { id: 'e6', userId: 'u-qa', actor: 'QA Bot', occurredAt: new Date('2026-09-30T02:32:20.842Z') },
  { id: 'e5', userId: 'u-qa', actor: 'QA Bot', occurredAt: new Date('2026-09-30T02:32:19.760Z') },
  { id: 'e4', userId: 'u-qa', actor: 'QA Bot', occurredAt: new Date('2026-09-30T02:32:18.918Z') },
  { id: 'e3', userId: 'u-qa', actor: 'QA Bot', occurredAt: new Date('2026-09-30T02:32:18.060Z') },
  { id: 'e2', userId: 'u-qa', actor: 'QA Bot', occurredAt: new Date('2026-09-30T02:32:17.164Z') },
  { id: 'e1', userId: 'u-qa', actor: 'QA Bot', occurredAt: BASE },
];

const AGORA = new Date('2026-09-30T02:33:00.000Z');

describe('agruparConexoes', () => {
  it('seis sessões da mesma pessoa viram UM aviso', () => {
    const avisos = agruparConexoes(RAJADA_REAL, new Map(), AGORA);

    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.sessoes).toBe(6);
  });

  it('a hora do aviso é o COMEÇO da rajada, não a última sessão', () => {
    const avisos = agruparConexoes(RAJADA_REAL, new Map(), AGORA);

    // Quem conectou, conectou em :16 — :20 é consequência do mesmo clique.
    expect(avisos[0]!.quando.toISOString()).toBe(BASE.toISOString());
  });

  it('pessoas diferentes na mesma janela geram avisos diferentes', () => {
    const avisos = agruparConexoes(
      [...RAJADA_REAL, { id: 'x', userId: 'u-tammy', actor: 'Tammy', occurredAt: AGORA }],
      new Map(),
      AGORA,
    );

    expect(avisos.map((a) => a.userId)).toEqual(['u-tammy', 'u-qa']);
  });

  /**
   * O silêncio é o que impede o vigia de reanunciar a MESMA conexão a cada 2
   * minutos: os eventos continuam na janela de 15 min por sete rodadas.
   */
  it('quem já foi anunciado não é anunciado de novo dentro do silêncio', () => {
    const avisados = new Map([['u-qa', new Date(AGORA.getTime() - 60_000)]]);

    expect(agruparConexoes(RAJADA_REAL, avisados, AGORA)).toHaveLength(0);
  });

  it('passado o silêncio, uma conexão nova volta a ser notícia', () => {
    const avisados = new Map([['u-qa', new Date(AGORA.getTime() - SILENCIO_POR_PESSOA_MS - 1000)]]);

    expect(agruparConexoes(RAJADA_REAL, avisados, AGORA)).toHaveLength(1);
  });

  /**
   * NA PRIMEIRA VEZ QUE ISTO RODAR o banco já tem eventos. Nenhum deles é
   * "acabou de conectar", e anunciá-los seria mentir sobre o tempo.
   */
  it('evento fora da janela não vira aviso, por mais real que seja', () => {
    const velho = new Date(AGORA.getTime() - JANELA_DE_OLHAR_MS - 1000);
    const eventos = RAJADA_REAL.map((e) => ({ ...e, occurredAt: velho }));

    expect(agruparConexoes(eventos, new Map(), AGORA)).toHaveLength(0);
  });

  it('evento sem pessoa ou sem hora é ignorado em vez de virar "Alguém, em algum momento"', () => {
    const eventos: EventoDeConexao[] = [
      { id: 'a', userId: null, actor: 'Sem dono', occurredAt: AGORA },
      { id: 'b', userId: 'u-x', actor: 'Sem hora', occurredAt: null },
    ];

    expect(agruparConexoes(eventos, new Map(), AGORA)).toHaveLength(0);
  });

  it('nome ausente não inventa identidade', () => {
    const avisos = agruparConexoes([{ id: 'a', userId: 'u-x', actor: null, occurredAt: AGORA }], new Map(), AGORA);

    expect(avisos[0]!.nome).toBe('Alguém');
  });
});

describe('redigirAviso', () => {
  it('explica a rajada em vez de deixar parecer que seis pessoas entraram', () => {
    const { body } = redigirAviso({ userId: 'u-qa', nome: 'QA Bot', quando: BASE, sessoes: 6 });

    expect(body).toContain('não são 6 pessoas');
  });

  it('uma sessão só não fala de rajada nenhuma', () => {
    const { title, body } = redigirAviso({ userId: 'u-t', nome: 'Tammy', quando: BASE, sessoes: 1 });

    expect(title).toBe('Tammy conectou o Claude ao Desigual OS');
    expect(body).not.toMatch(/sessões/);
  });

  it('o link leva pra tela de MCP já apontando a pessoa', () => {
    const { link } = redigirAviso({ userId: 'u-t', nome: 'Tammy', quando: BASE, sessoes: 1 });

    expect(link).toBe('/mcp?conectou=u-t');
  });
});

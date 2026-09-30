import { describe, expect, it } from 'vitest';
import {
  candidatasADuplicata,
  chaveDeNome,
  ordenarAlertas,
  pareceArtefatoDeTeste,
  procedenciaDe,
  type AlertaDeQualidade,
} from './qualidade-de-dado';

/**
 * Os casos são os do banco real (medidos em 30/09/2026), não inventados. Se a
 * carteira mudar de forma, estes testes quebram — que é o que devem fazer.
 */
describe('duplicatas: apontar, nunca resolver', () => {
  const carteira = [
    { id: '1', name: 'BIO FIT' },
    { id: '2', name: 'Biofit' },
    { id: '3', name: '🧪 CASE #0 — Endrigo Almada / CITÁVEL™' },
    { id: '4', name: '🧪 Case #0 — Endrigo Almada / CITÁVEL™' },
    { id: '5', name: 'Colpar' },
    { id: '6', name: 'Colpar Brasil' },
    { id: '7', name: 'Cosentino' },
  ];

  it('acha as duas duplicatas exatas do cadastro real', () => {
    const exatas = candidatasADuplicata(carteira).filter((c) => c.tipo === 'exata');
    expect(exatas).toHaveLength(2);
    expect(exatas.flatMap((e) => e.entidades.map((x) => x.name))).toContain('Biofit');
  });

  it('acha a quase-duplicata por prefixo (Colpar / Colpar Brasil)', () => {
    const prefixo = candidatasADuplicata(carteira).filter((c) => c.tipo === 'prefixo');
    expect(prefixo.some((p) => p.entidades.some((e) => e.name === 'Colpar Brasil'))).toBe(true);
  });

  /**
   * A parte conservadora: prefixo curto faria meia carteira virar "quase
   * igual", e a tela perde a utilidade exatamente por acusar demais.
   */
  it('prefixo curto NÃO vira duplicata', () => {
    const curtos = candidatasADuplicata([
      { id: 'a', name: 'Ana' },
      { id: 'b', name: 'Anabela' },
    ]);
    expect(curtos).toHaveLength(0);
  });

  it('cliente sozinho nunca é candidato', () => {
    expect(candidatasADuplicata([{ id: '1', name: 'Cosentino' }])).toHaveLength(0);
  });

  it('a chave ignora emoji, acento, caixa e pontuação', () => {
    expect(chaveDeNome('🧪 CASE #0 — Endrigo')).toBe(chaveDeNome('Case #0 - Endrigo'));
  });
});

describe('marca de artefato de teste', () => {
  it('reconhece os carimbos que o aceite deixou no banco', () => {
    expect(pareceArtefatoDeTeste('Bento, guarda esta referência da conversa: marco-029857.')).toBe(true);
    expect(pareceArtefatoDeTeste('ACEITE-1790723321445 Anotação privada')).toBe(true);
    expect(pareceArtefatoDeTeste('QA CAMPOS 1790624559995')).toBe(true);
  });

  /**
   * A regra que impede o erro caro: um regex largo escondendo cliente real é
   * silencioso; fixture aparecendo na lista é visível e alguém corrige.
   */
  it('"teste" solto NÃO marca — existe cliente real com isso no nome', () => {
    expect(pareceArtefatoDeTeste('Clinica Teste Fase 7 pediu ajuste no card')).toBe(false);
    expect(pareceArtefatoDeTeste('testar a nova campanha da Cosentino')).toBe(false);
  });

  it('número solto também não marca', () => {
    expect(pareceArtefatoDeTeste('a campanha rendeu 1790624 impressões')).toBe(false);
  });
});

describe('proveniência ausente é pendência, não valor', () => {
  it('null vira DESCONHECIDA, nunca SYSTEM', () => {
    expect(procedenciaDe(null)).toBe('DESCONHECIDA');
    expect(procedenciaDe(undefined)).toBe('DESCONHECIDA');
    expect(procedenciaDe('')).toBe('DESCONHECIDA');
  });

  it('reconhece as origens que existem no banco', () => {
    expect(procedenciaDe('claude')).toBe('CLAUDE');
    expect(procedenciaDe('clickup_comment')).toBe('CLICKUP');
    expect(procedenciaDe('chat_message')).toBe('MANUAL');
    expect(procedenciaDe('vault')).toBe('IMPORT');
  });
});

describe('alertas: o que engana vem antes do que incomoda', () => {
  const alerta = (over: Partial<AlertaDeQualidade>): AlertaDeQualidade => ({
    codigo: 'SEM_PROVENIENCIA',
    titulo: 't',
    oQueFazer: 'x',
    quantos: 1,
    gravidade: 'BAIXO',
    exemplos: [],
    ...over,
  });

  it('ordena por gravidade e depois por volume', () => {
    const ordenados = ordenarAlertas([
      alerta({ gravidade: 'BAIXO', quantos: 100 }),
      alerta({ gravidade: 'ALTO', quantos: 2 }),
      alerta({ gravidade: 'MEDIO', quantos: 50 }),
    ]);
    expect(ordenados.map((a) => a.gravidade)).toEqual(['ALTO', 'MEDIO', 'BAIXO']);
  });

  /** Zero não é conquista pra exibir: é a ausência do problema. */
  it('alerta zerado some da lista', () => {
    expect(ordenarAlertas([alerta({ quantos: 0 })])).toHaveLength(0);
  });
});

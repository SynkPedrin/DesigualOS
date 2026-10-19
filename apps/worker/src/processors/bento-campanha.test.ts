import { describe, expect, it, vi } from 'vitest';
import {
  decomporCampanha, validarFrentes, resolverResponsaveis, montarPergunta,
  funcaoDoTexto, type FrenteDeTrabalho, type MembroConhecido,
} from './bento-campanha';

/**
 * Pedido da operação (28/09/2026): da campanha, segmentar responsabilidades e
 * lançar uma task por colaborador, cada uma com SEU briefing — "o de redator
 * pro Sain, o de designer pro Gui, o de edição pro Celso; ou perguntar, se
 * tiver mais de um por função".
 *
 * O que estes testes protegem é a metade difícil: o Bento pode errar a
 * segmentação e alguém corrige; se ele errar o DONO, a task nasce no nome de
 * quem não vai fazer, e ninguém percebe até o prazo. Por isso função nunca é
 * inferida — é nomeada, declarada, ou perguntada.
 */

const frente = (over: Partial<FrenteDeTrabalho> = {}): FrenteDeTrabalho => ({
  funcao: 'design',
  titulo: 'Layout dos 5 cards — Colormaq',
  briefing: 'Formato 1080x1350, tom técnico, sem adjetivo de propaganda.',
  responsavelNomeado: null,
  ...over,
});

describe('a função sai do vocabulário da operação', () => {
  it.each([
    ['copy dos posts', 'redacao'],
    ['roteiro do reels', 'redacao'],
    ['layout do carrossel', 'design'],
    ['key visual da campanha', 'design'],
    ['edição do vídeo', 'video'],
    ['subir os anúncios', 'trafego'],
    ['calendário editorial', 'social'],
  ])('%s -> %s', (texto, id) => {
    expect(funcaoDoTexto(texto)).toBe(id);
  });

  it('texto sem função reconhecível não vira palpite', () => {
    expect(funcaoDoTexto('resolver aquilo de ontem')).toBeNull();
  });
});

describe('validação da forma — o modelo propõe, a forma é conferida aqui', () => {
  it('frente sem briefing é descartada: task vazia é pior que frente faltando', () => {
    const r = validarFrentes({ frentes: [{ funcao: 'design', titulo: 'Layout', briefing: 'curto' }] });
    expect(r).toEqual([]);
  });

  it('frente sem título é descartada', () => {
    expect(validarFrentes({ frentes: [{ funcao: 'design', briefing: 'x'.repeat(40) }] })).toEqual([]);
  });

  it('função inválida é recuperada pelo texto, não descartada à toa', () => {
    const r = validarFrentes({ frentes: [{ funcao: 'inventada', titulo: 'Edição do vídeo de 30s', briefing: 'x'.repeat(40) }] });
    expect(r[0]?.funcao).toBe('video');
  });

  it('função irrecuperável cai — melhor uma frente a menos que dono no chute', () => {
    expect(validarFrentes({ frentes: [{ funcao: 'zzz', titulo: 'Resolver pendência', briefing: 'x'.repeat(40) }] })).toEqual([]);
  });

  it('frentes duplicadas (mesma função + mesmo título) contam uma vez', () => {
    const f = { funcao: 'design', titulo: 'Layout', briefing: 'x'.repeat(40) };
    expect(validarFrentes({ frentes: [f, { ...f }] })).toHaveLength(1);
  });

  it('resposta que não é JSON não derruba nada — devolve vazio', () => {
    expect(validarFrentes(null)).toEqual([]);
    expect(validarFrentes({ frentes: 'texto' })).toEqual([]);
  });

  it('responsavel só vem quando é string com conteúdo', () => {
    const r = validarFrentes({ frentes: [{ funcao: 'design', titulo: 'T', briefing: 'x'.repeat(40), responsavel: '  ' }] });
    expect(r[0]?.responsavelNomeado).toBeNull();
  });
});

describe('decomposição: JSON cercado de texto ou de crase ainda é lido', () => {
  it('extrai o JSON de uma resposta suja', async () => {
    const escritor = vi.fn(async () => '```json\n{"frentes":[{"funcao":"redacao","titulo":"Copy dos 5 posts","briefing":"' + 'x'.repeat(40) + '"}]}\n```');
    const r = await decomporCampanha({ mensagem: 'campanha de outubro', escritor });
    expect(r).toHaveLength(1);
    expect(r[0]?.funcao).toBe('redacao');
  });

  it('escritor que falha não derruba o turno', async () => {
    const r = await decomporCampanha({ mensagem: 'x', escritor: vi.fn(async () => { throw new Error('offline'); }) });
    expect(r).toEqual([]);
  });
});

const EQUIPE: MembroConhecido[] = [
  { nome: 'Matheus Sain', funcoes: ['redacao'] },
  { nome: 'Gui', funcoes: ['design'] },
  { nome: 'Bruna Baldacini', funcoes: ['design'] },
  { nome: 'Celso de Andrade Guimarães', funcoes: ['video'] },
];

describe('dono: nomeado, declarado, ou pergunta — nunca escolhido', () => {
  it('pessoa nomeada no pedido ganha de tudo', () => {
    const r = resolverResponsaveis([frente({ responsavelNomeado: 'Jamile Galdino' })], EQUIPE);
    expect(r.prontas[0]).toMatchObject({ responsavel: 'Jamile Galdino', origem: 'nomeado_no_pedido' });
    expect(r.perguntas).toEqual([]);
  });

  it('função com UM candidato declarado resolve sozinha', () => {
    const r = resolverResponsaveis([frente({ funcao: 'redacao', titulo: 'Copy' })], EQUIPE);
    expect(r.prontas[0]).toMatchObject({ responsavel: 'Matheus Sain', origem: 'registro_declarado' });
  });

  it('DOIS candidatos viram pergunta — o Bento não escolhe entre pessoas', () => {
    const r = resolverResponsaveis([frente({ funcao: 'design' })], EQUIPE);
    expect(r.prontas).toEqual([]);
    expect(r.perguntas[0]).toMatchObject({ funcao: 'design', candidatos: ['Gui', 'Bruna Baldacini'] });
  });

  it('função sem ninguém declarado também pergunta, sem candidato nenhum', () => {
    const r = resolverResponsaveis([frente({ funcao: 'trafego', titulo: 'Subir anúncios' })], EQUIPE);
    expect(r.perguntas[0]).toMatchObject({ funcao: 'trafego', candidatos: [] });
  });

  it('várias frentes da MESMA função pendente viram UMA pergunta só', () => {
    const r = resolverResponsaveis(
      [frente({ funcao: 'design', titulo: 'Layout A' }), frente({ funcao: 'design', titulo: 'Layout B' })],
      EQUIPE,
    );
    expect(r.perguntas).toHaveLength(1);
    expect(r.perguntas[0]?.titulos).toEqual(['Layout A', 'Layout B']);
  });

  it('o caso que a operação descreveu: redator e editor resolvem, designer pergunta', () => {
    const r = resolverResponsaveis(
      [
        frente({ funcao: 'redacao', titulo: 'Copy dos 5 posts' }),
        frente({ funcao: 'video', titulo: 'Edição do reels' }),
        frente({ funcao: 'design', titulo: 'Layout dos cards' }),
      ],
      EQUIPE,
    );
    expect(r.prontas.map((f) => f.responsavel)).toEqual(['Matheus Sain', 'Celso de Andrade Guimarães']);
    expect(r.perguntas.map((p) => p.funcao)).toEqual(['design']);
  });
});

describe('a pergunta sai uma vez só, com tudo', () => {
  it('lista o que falta E o que já tem dono, pra pessoa responder de uma vez', () => {
    const r = resolverResponsaveis(
      [frente({ funcao: 'redacao', titulo: 'Copy' }), frente({ funcao: 'design', titulo: 'Layout' })],
      EQUIPE,
    );
    const msg = montarPergunta(r)!;
    expect(msg).toContain('Design');
    expect(msg).toContain('Gui, Bruna Baldacini');
    expect(msg).toContain('Matheus Sain');
    expect(msg).toContain('cada uma com o briefing dela');
  });

  it('sem pendência, não há pergunta', () => {
    const r = resolverResponsaveis([frente({ responsavelNomeado: 'Gui' })], EQUIPE);
    expect(montarPergunta(r)).toBeNull();
  });

  it('nunca afirma que lançou antes de lançar', () => {
    const msg = montarPergunta(resolverResponsaveis([frente({ funcao: 'design' })], EQUIPE))!;
    expect(msg).not.toMatch(/\b(criei|lancei|lancei|atribuí)\b/i);
  });
});

import { membrosPorFuncao } from './equipe-funcoes';

/**
 * O registro é DECLARADO. A operação afirmou em 28/09/2026: redação → Matheus
 * Sain, design → Gui, vídeo → Celso. O que ninguém declarou vira pergunta.
 */
describe('registro de funções da equipe', () => {
  it('o que a operação declarou resolve sozinho', () => {
    const r = resolverResponsaveis(
      [frente({ funcao: 'redacao', titulo: 'Copy' }), frente({ funcao: 'video', titulo: 'Edição' })],
      membrosPorFuncao({}),
    );
    expect(r.prontas.map((f) => f.responsavel)).toEqual(['Matheus Sain', 'Celso de Andrade Guimarães']);
    expect(r.perguntas).toEqual([]);
  });

  it('função que ninguém declarou pergunta, sem candidato', () => {
    const r = resolverResponsaveis([frente({ funcao: 'trafego', titulo: 'Anúncios' })], membrosPorFuncao({}));
    expect(r.perguntas[0]).toMatchObject({ funcao: 'trafego', candidatos: [] });
  });

  it('a env vence o padrão — corrigir o time não exige deploy', () => {
    const env = { BENTO_FUNCOES_EQUIPE: '{"redacao":["Jamile Galdino"],"trafego":["Alicia"]}' } as NodeJS.ProcessEnv;
    const r = resolverResponsaveis(
      [frente({ funcao: 'redacao', titulo: 'Copy' }), frente({ funcao: 'trafego', titulo: 'Anúncios' })],
      membrosPorFuncao(env),
    );
    expect(r.prontas.map((f) => f.responsavel)).toEqual(['Jamile Galdino', 'Alicia']);
  });

  it('dois nomes na mesma função passam a PERGUNTAR — é o pedido da operação', () => {
    const env = { BENTO_FUNCOES_EQUIPE: '{"design":["Gui","Bruna Baldacini"]}' } as NodeJS.ProcessEnv;
    const r = resolverResponsaveis([frente({ funcao: 'design' })], membrosPorFuncao(env));
    expect(r.prontas).toEqual([]);
    expect(r.perguntas[0]?.candidatos).toEqual(['Gui', 'Bruna Baldacini']);
  });

  it('JSON quebrado cai pro declarado, não vira mapa vazio silencioso', () => {
    const env = { BENTO_FUNCOES_EQUIPE: '{isso nao e json' } as NodeJS.ProcessEnv;
    expect(membrosPorFuncao(env).some((m) => m.nome === 'Matheus Sain')).toBe(true);
  });

  it('função inexistente na env é ignorada, não quebra o mapa', () => {
    const env = { BENTO_FUNCOES_EQUIPE: '{"inventada":["X"],"design":["Gui"]}' } as NodeJS.ProcessEnv;
    expect(membrosPorFuncao(env)).toEqual([{ nome: 'Gui', funcoes: ['design'] }]);
  });
});

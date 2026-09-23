import { describe, expect, it } from 'vitest';
import {
  containsForbiddenPhrase,
  detectForbiddenLanguage,
  extractForbiddenPhrases,
  extractRequestedRemovals,
  verifyRequestedRemovals,
} from './universal-quality.js';

describe('extractForbiddenPhrases + containsForbiddenPhrase (Otto Senior V1, piso universal)', () => {
  const dossieVistaAlegre =
    'Tom de marca: aspiracional mas honesto, sem exagero de "sonho realizado". Público: famílias em busca do segundo imóvel.';

  it('extrai a frase proibida entre aspas do dossiê', () => {
    expect(extractForbiddenPhrases(dossieVistaAlegre)).toContain('sonho realizado');
  });

  /**
   * REGRESSÃO REAL (Otto Senior V1, certificação não-vídeo): o dossiê dizia
   * "sem exagero de 'sonho realizado'" e a legenda final usava
   * "#SonhosRealizadosComQualidade" — plural, hashtag, CamelCase, e ainda
   * assim é a MESMA frase proibida.
   */
  it('teste 18/6: pega a variação em hashtag CamelCase pluralizada ("#SonhosRealizadosComQualidade")', () => {
    expect(containsForbiddenPhrase('Confira! #SonhosRealizadosComQualidade', 'sonho realizado')).toBe(true);
  });

  it('pega a frase em prosa normal, sem hashtag', () => {
    expect(containsForbiddenPhrase('Aqui está o seu sonho realizado.', 'sonho realizado')).toBe(true);
  });

  it('NÃO acusa texto que não tem a frase proibida', () => {
    expect(containsForbiddenPhrase('Qualidade que inspira, sem exageros.', 'sonho realizado')).toBe(false);
  });

  it('detectForbiddenLanguage junta extração + checagem: dossiê + resposta final com a violação', () => {
    const resposta = 'Seja bem-vindo! #SonhosRealizadosComQualidade';
    expect(detectForbiddenLanguage(resposta, dossieVistaAlegre)).toEqual(['sonho realizado']);
  });

  it('detectForbiddenLanguage vazio quando a resposta respeita a restrição', () => {
    const resposta = 'Seja bem-vindo! #QualidadeElegante';
    expect(detectForbiddenLanguage(resposta, dossieVistaAlegre)).toEqual([]);
  });

  it('reconhece "evite \'X\'" e "não use \'X\'" além de "sem exagero de"', () => {
    expect(extractForbiddenPhrases('Tom: evite "liquida tudo" na comunicação.')).toContain('liquida tudo');
    expect(extractForbiddenPhrases('Regra: não use "desconto imperdível" em nenhum canal.')).toContain('desconto imperdível');
  });

  it('sem nenhuma restrição declarada no contexto, não extrai nada', () => {
    expect(extractForbiddenPhrases('Tom de marca: direto e confiante.')).toEqual([]);
  });
});

describe('extractRequestedRemovals + verifyRequestedRemovals (Otto Senior V1, feedback rewrite contract)', () => {
  /**
   * REGRESSÃO REAL: feedback pedia "tira o clichê de sonho realizado" — a
   * reescrita de fato tirou. Este teste prova que a verificação
   * DETERMINÍSTICA confirma isso, não só o autorrelato do modelo.
   */
  it('teste feedback 2 mudanças: a que FOI aplicada é verificada como applied=true', () => {
    const feedback = 'tira o clichê de "sonho realizado" da legenda';
    const removals = extractRequestedRemovals(feedback);
    expect(removals.length).toBeGreaterThan(0);
    const respostaCorrigida = 'Seja bem-vindo! #QualidadeElegante';
    const verificado = verifyRequestedRemovals(respostaCorrigida, removals);
    expect(verificado.every((v) => v.applied)).toBe(true);
  });

  /**
   * REGRESSÃO REAL: a MESMA sessão de feedback pedia DUAS coisas — a
   * segunda ("tira o clichê") NÃO foi aplicada na resposta que simula o
   * achado ao vivo (clichê ainda presente). A verificação determinística
   * pega isso mesmo sem re-perguntar ao critic.
   */
  it('teste feedback 2 mudanças: a que NÃO foi aplicada é verificada como applied=false', () => {
    const feedback = 'tira o clichê de "sonho realizado" da legenda';
    const removals = extractRequestedRemovals(feedback);
    const respostaAindaComClicheh = 'Seja bem-vindo! #SonhosRealizadosComQualidade';
    const verificado = verifyRequestedRemovals(respostaAindaComClicheh, removals);
    expect(verificado.every((v) => v.applied)).toBe(false);
  });

  it('extrai múltiplas instruções de remoção do mesmo feedback', () => {
    const feedback = 'tira o clichê de "sonho realizado" e remove o emoji de coração';
    const removals = extractRequestedRemovals(feedback);
    expect(removals.length).toBeGreaterThanOrEqual(2);
  });

  it('feedback sem nenhuma instrução de remoção não extrai nada', () => {
    expect(extractRequestedRemovals('deixa mais premium, mais contido')).toEqual([]);
  });
});

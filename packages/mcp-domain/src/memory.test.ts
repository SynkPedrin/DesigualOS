import { describe, expect, it } from 'vitest';
import {
  confiancaInicial, deveRegistrar, ehCitavel, importanciaPadrao, MEMORY_STATUSES,
  podeAprovar, podeTransicionar, statusInicial,
} from './index';

describe('procedência — nada que o Claude escreveu nasce como fato (§11)', () => {
  it('o Claude é a fonte menos confiável, e isso é por construção', () => {
    expect(confiancaInicial('claude')).toBeLessThan(confiancaInicial('human'));
    expect(confiancaInicial('claude')).toBeLessThan(confiancaInicial('clickup'));
    expect(confiancaInicial('claude')).toBeLessThan(confiancaInicial('agent'));
  });

  it('nada nasce APPROVED nem CONFIRMED', () => {
    for (const fonte of ['human', 'claude', 'agent', 'clickup', 'vault'] as const) {
      expect(['OBSERVED', 'INFERRED']).toContain(statusInicial(fonte));
    }
  });

  it('nenhuma fonte nasce com confiança total', () => {
    for (const fonte of ['human', 'claude', 'agent', 'clickup', 'vault', 'meta_ads', 'system'] as const) {
      expect(confiancaInicial(fonte)).toBeLessThan(1);
    }
  });
});

describe('ciclo de vida — não existe atalho até virar política', () => {
  it('OBSERVED nunca volta de REJECTED nem de SUPERSEDED', () => {
    for (const destino of MEMORY_STATUSES) {
      expect(podeTransicionar('REJECTED', destino), `REJECTED -> ${destino}`).toBe(false);
      expect(podeTransicionar('SUPERSEDED', destino), `SUPERSEDED -> ${destino}`).toBe(false);
    }
  });

  it('APPROVED só pode ser rejeitado ou substituído', () => {
    expect(podeTransicionar('APPROVED', 'REJECTED')).toBe(true);
    expect(podeTransicionar('APPROVED', 'SUPERSEDED')).toBe(true);
    expect(podeTransicionar('APPROVED', 'OBSERVED')).toBe(false);
    expect(podeTransicionar('APPROVED', 'CONFIRMED')).toBe(false);
  });

  it('só SUPER_ADMIN e MANAGER aprovam — criativo registra, não legisla', () => {
    expect(podeAprovar('SUPER_ADMIN')).toBe(true);
    expect(podeAprovar('MANAGER')).toBe(true);
    for (const r of ['CREATIVE', 'CUSTOMER_SUCCESS', 'TRAFFIC_MANAGER', 'QA', 'VIEWER']) {
      expect(podeAprovar(r), r).toBe(false);
    }
  });
});

describe('citabilidade — o que sai com ressalva e o que não sai', () => {
  it('rejeitada e substituída não são citáveis', () => {
    expect(ehCitavel({ status: 'REJECTED' }).citavel).toBe(false);
    expect(ehCitavel({ status: 'SUPERSEDED' }).citavel).toBe(false);
  });

  it('só APPROVED sai sem ressalva', () => {
    expect(ehCitavel({ status: 'APPROVED' }).ressalva).toBeNull();
    expect(ehCitavel({ status: 'OBSERVED' }).ressalva).toContain('não confirmado');
    expect(ehCitavel({ status: 'INFERRED' }).ressalva).toContain('deduzido');
    expect(ehCitavel({ status: 'CONFIRMED' }).ressalva).toContain('sem aprovação formal');
  });
});

describe('deveRegistrar — o filtro do §10, e ele erra para o lado seguro', () => {
  it('registra conhecimento operacional de verdade', () => {
    expect(deveRegistrar({ eventType: 'CLIENT_FEEDBACK', summary: 'O cliente pediu para parar com comunicação promocional agressiva.' }).registrar).toBe(true);
  });

  it('NÃO registra hipótese — é o que envenena a memória', () => {
    const r = deveRegistrar({ eventType: 'STRATEGY_CHANGED', summary: 'Talvez a gente mude a estratégia para foco em vídeo curto.' });
    expect(r.registrar).toBe(false);
    if (!r.registrar) expect(r.motivo).toContain('hipótese');
  });

  it('não registra conversa nem resumo curto demais', () => {
    expect(deveRegistrar({ eventType: 'PROCESS_LEARNING', summary: 'valeu, obrigado pela ajuda' }).registrar).toBe(false);
    expect(deveRegistrar({ eventType: 'PROCESS_LEARNING', summary: 'ok' }).registrar).toBe(false);
  });

  it('ATO CONSUMADO passa mesmo escrito com hedge — o tipo carrega a certeza', () => {
    // "acho que ficou ótimo, aprovado" é uma aprovação. O texto hesita, o fato não.
    const r = deveRegistrar({ eventType: 'CREATIVE_APPROVED', summary: 'Acho que ficou ótimo, cliente aprovou o carrossel de outubro.' });
    expect(r.registrar).toBe(true);
  });

  it('decisão de cliente e mudança de estratégia pesam mais que log de trabalho', () => {
    expect(importanciaPadrao('CLIENT_DECISION')).toBe('HIGH');
    expect(importanciaPadrao('STRATEGY_CHANGED')).toBe('HIGH');
    expect(importanciaPadrao('WORK_LOGGED')).toBe('LOW');
  });
});

import { describe, expect, it } from 'vitest';
import { groundClaims } from '@desigual-os/agent-runtime';
import { operationalDataRetrieved, operationalEvidenceSummary } from './agentic-dispatch';
import { checkCountConsistency, expectedCount } from './count-consistency';

/**
 * Regressão do achado do release gate (15/09/2026): a evidência operacional
 * guardava só o cabeçalho do bloco, sem número nenhum, e por isso o grounding
 * não conseguia conferir contagem alguma — o Bento afirmou "5 tarefas vencem
 * hoje" com 15 no bloco e nada acusou.
 */

const BLOCO = [
  'DADOS AO VIVO DO CLICKUP (consultados agora, valem mais que qualquer memória sua):',
  '15 tarefa(s) aberta(s) (janela: hoje) em 5 cliente(s), de 50 cliente(s) consultado(s).',
  '1 sem responsável definido.',
  '',
  '3Net (6):',
  '- 3Net - BASE VÍDEOS ADS | status: aberto | prazo: hoje | resp: Ana Luiza',
].join('\n');

describe('operationalEvidenceSummary', () => {
  it('carrega o preâmbulo quantitativo, não só o cabeçalho', () => {
    const resumo = operationalEvidenceSummary(BLOCO);
    expect(resumo).toContain('15 tarefa(s) aberta(s)');
    expect(resumo).toContain('1 sem responsável definido');
    // Para na primeira linha em branco: o detalhe por cliente não entra.
    expect(resumo).not.toContain('3Net (6)');
  });

  it('bloco vazio não vira resumo vazio', () => {
    expect(operationalEvidenceSummary('')).toBe('dados operacionais ao vivo do ClickUp');
  });

  it('respeita o teto de 600 chars', () => {
    const gigante = ['cabeçalho', 'x'.repeat(2000)].join('\n');
    expect(operationalEvidenceSummary(gigante).length).toBeLessThanOrEqual(600);
  });
});

describe('grounding com a evidência operacional corrigida', () => {
  const evidence = [{ id: 'ev-op', summary: operationalEvidenceSummary(BLOCO) }];

  it('a contagem CORRETA fica ancorada na evidência', () => {
    const r = groundClaims('15 tarefas vencem hoje.', evidence);
    expect(r.ungroundedFacts).toHaveLength(0);
    expect(r.claims[0]?.evidenceIds).toContain('ev-op');
  });

  it('contagem inventada fica SEM âncora — o sinal que faltava', () => {
    const r = groundClaims('7 tarefas vencem hoje.', evidence);
    expect(r.ungroundedFacts).toHaveLength(1);
    expect(r.ungroundedFacts[0]?.text).toContain('7 tarefas');
  });

  /**
   * Limite CONHECIDO e aceito: a ancoragem confere presença do número, não o
   * papel dele. Aqui "5" existe no bloco como contagem de CLIENTES, então
   * "5 tarefas" ainda ancora. Reduzir isso exigiria evidência tipada por
   * campo (tarefas=15, clientes=5), não só texto — fica registrado como
   * limite real em vez de virar falsa sensação de cobertura.
   */
  it('número presente em OUTRO papel ainda ancora (limite conhecido)', () => {
    const r = groundClaims('5 tarefas vencem hoje.', evidence);
    expect(r.ungroundedFacts).toHaveLength(0);
  });

  it('com o resumo antigo (só cabeçalho) nem a contagem certa ancorava', () => {
    const antigo = [{ id: 'ev-op', summary: 'DADOS AO VIVO DO CLICKUP (consultados agora, valem mais que qualquer memória sua):' }];
    const r = groundClaims('15 tarefas vencem hoje.', antigo);
    expect(r.ungroundedFacts).toHaveLength(1);
  });
});

/**
 * O outro formato de dado ao vivo: o BRIEFING estruturado, que a API manda no
 * lugar da lista crua quando o pedido é de panorama/briefing. Não era
 * reconhecido, e por isso toda pergunta de operação perdia evidência e
 * grounding (release gate, 15/09/2026).
 */
const BRIEFING = [
  'BRIEFING MONTADO COM DADO AO VIVO — Operação (hoje) — BRIEFING OPERACIONAL',
  '',
  'VISÃO GERAL',
  '15 tarefa(s) | 2 atrasada(s) | 1 sem responsável',
  '',
  'RISCOS',
  '- 1 tarefa(s) sem responsável',
].join('\n');

describe('briefing como dado ao vivo', () => {
  it('é reconhecido como dado operacional recuperado', () => {
    expect(operationalDataRetrieved({ operationalContext: BRIEFING } as never)).toBe(true);
  });

  it('lista crua continua reconhecida', () => {
    expect(operationalDataRetrieved({ operationalContext: BLOCO } as never)).toBe(true);
  });

  it('sem dado ao vivo continua falso', () => {
    expect(operationalDataRetrieved({ operationalContext: 'texto qualquer' } as never)).toBe(false);
    expect(operationalDataRetrieved({} as never)).toBe(false);
  });

  it('o resumo da evidência carrega a contagem do briefing', () => {
    const r = operationalEvidenceSummary(BRIEFING);
    expect(r).toContain('BRIEFING MONTADO COM DADO AO VIVO');
    expect(r).toContain('15 tarefa(s)');
  });

  it('a contagem do briefing é conferível', () => {
    expect(expectedCount(BRIEFING)).toBe(15);
    expect(checkCountConsistency('Nenhuma tarefa hoje.', BRIEFING).ok).toBe(false);
    expect(checkCountConsistency('São 15 tarefas hoje.', BRIEFING).ok).toBe(true);
  });
});

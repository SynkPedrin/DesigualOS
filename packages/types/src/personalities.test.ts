import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AGENT_PERSONALITIES } from './personalities.js';

/**
 * PORTÃO DO JARBAS (auditoria docs/auditoria-forense-agentes-2026-09-12.md,
 * seção 5): o Jarbas é o baseline de qualidade do sistema e é INTOCÁVEL.
 * Este snapshot congela o texto exato da personalidade dele. Qualquer edição
 * no bloco JARBAS de personalities.ts quebra este teste de propósito.
 *
 * Se você chegou aqui porque o teste quebrou: pare. O Jarbas não entra em
 * nenhuma onda de correção. Se a mudança for mesmo inevitável, ela precisa
 * de autorização explícita do dono e de atualização consciente deste hash,
 * registrada no relatório da onda.
 */
const JARBAS_PERSONALITY_SHA256 =
  '862433c03f504680dd9443e071f72200ee334dde8d2c6023b779656833ebfa86';

describe('portão do Jarbas: snapshot da personalidade', () => {
  it('o texto do Jarbas é byte a byte o texto auditado (sha256 congelado)', () => {
    const jarbas = AGENT_PERSONALITIES.jarbas;
    expect(jarbas, 'AGENT_PERSONALITIES.jarbas não pode sumir').toBeTruthy();
    const hash = createHash('sha256').update(jarbas!).digest('hex');
    expect(
      hash,
      'O prompt do Jarbas mudou. O Jarbas é INTOCÁVEL (baseline do sistema). ' +
        'Se esta mudança foi autorizada pelo dono, atualize JARBAS_PERSONALITY_SHA256 ' +
        'neste teste e registre no relatório da onda. Caso contrário, reverta personalities.ts.',
    ).toBe(JARBAS_PERSONALITY_SHA256);
  });

  it('o Jarbas continua cabendo no próprio limite de canal (855 chars medidos)', () => {
    // Limite medido em produção (docs/agent-prompts/README.md): acima de ~900
    // caracteres de instrução combinada o Jarbas devolve answer: null.
    expect(AGENT_PERSONALITIES.jarbas!.length).toBeLessThanOrEqual(900);
  });
});

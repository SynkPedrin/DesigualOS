import { describe, expect, it } from 'vitest';
import type { AgentName } from '@desigual-os/types';
import { agenteAceitaBlocoNaMensagem, contextoEnvenenaBusca } from './message-assembly.js';

const TODOS_OS_AGENTES: AgentName[] = ['bento', 'jarbas', 'suzy', 'otto', 'studio'];

/**
 * PORTÃO DO JARBAS, contrato de mensagem (auditoria, seção 5): o bloco
 * operacional do ClickUp NUNCA entra no payload do Jarbas. Medido em
 * produção em 10/09/2026: o serviço dele classifica a mensagem inteira e o
 * bloco dispara o edge case job_via_whatsapp, que responde com erro genérico
 * e ignora a pergunta do usuário.
 */
describe('portão do Jarbas: contrato de montagem da mensagem', () => {
  it('jarbas nunca recebe o bloco operacional na mensagem', () => {
    expect(agenteAceitaBlocoNaMensagem('jarbas')).toBe(false);
  });

  it('suzy nunca recebe o bloco operacional na mensagem (mesmo serviço, mesmo edge case)', () => {
    expect(agenteAceitaBlocoNaMensagem('suzy')).toBe(false);
  });

  it('bento também não recebe na mensagem: o dado operacional dele viaja em campo separado', () => {
    expect(agenteAceitaBlocoNaMensagem('bento')).toBe(false);
  });

  it('só otto e studio aceitam o bloco operacional na mensagem', () => {
    const aceitam = TODOS_OS_AGENTES.filter((a) => agenteAceitaBlocoNaMensagem(a));
    expect(aceitam).toEqual(['otto', 'studio']);
  });

  it('o bloco de contexto geral continua fora da mensagem do Bento (busca vetorial)', () => {
    expect(contextoEnvenenaBusca('bento')).toBe(true);
    for (const agente of TODOS_OS_AGENTES.filter((a) => a !== 'bento')) {
      expect(contextoEnvenenaBusca(agente)).toBe(false);
    }
  });
});

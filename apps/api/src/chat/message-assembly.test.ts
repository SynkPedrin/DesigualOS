import { describe, expect, it } from 'vitest';
import type { AgentName } from '@desigual-os/types';
import {
  agenteAceitaBlocoNaMensagem,
  contextoGeralVaiNaMensagem,
  operacionalPorCampoApartado,
} from './message-assembly.js';

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

  it('o bloco de contexto geral continua fora da mensagem do Bento (busca vetorial)', () => {
    expect(contextoGeralVaiNaMensagem('bento')).toBe(false);
  });
});

/**
 * BYPASS DE CONTEXTO DO OTTO (17/09/2026).
 *
 * O worker projeta o contexto do Otto por intenção, e a API concatenava uma
 * SEGUNDA cópia crua do mesmo domínio na mensagem — dossiê, histórico, id de
 * lista do ClickUp e as respostas anteriores do próprio Otto. Medido na
 * conversa bcaea819: 16 chars de pedido contra 3913 chars de bloco não
 * projetado. Projetar num caminho enquanto o outro despeja o texto cru não
 * projeta nada.
 *
 * As três asserções que seguram a correção: a mensagem do Otto é só a mensagem
 * do usuário, ele tem UM caminho de contexto, e o dado operacional continua
 * chegando — por campo, não colado.
 */
describe('otto_raw_user_message_is_not_polluted_by_api_context', () => {
  it('o bloco de contexto geral não vai na mensagem do Otto', () => {
    expect(contextoGeralVaiNaMensagem('otto')).toBe(false);
  });

  it('o bloco operacional também não vai colado na mensagem dele', () => {
    expect(agenteAceitaBlocoNaMensagem('otto')).toBe(false);
  });
});

describe('otto_does_not_receive_duplicate_context_paths', () => {
  it('nenhum agente recebe contexto geral NA mensagem e dado operacional por campo ao mesmo tempo', () => {
    for (const agente of TODOS_OS_AGENTES) {
      const doisCaminhos = contextoGeralVaiNaMensagem(agente) && operacionalPorCampoApartado(agente);
      expect(doisCaminhos, agente).toBe(false);
    }
  });

  it('o Otto tem exatamente UM caminho de contexto: o campo apartado', () => {
    expect(contextoGeralVaiNaMensagem('otto')).toBe(false);
    expect(agenteAceitaBlocoNaMensagem('otto')).toBe(false);
    expect(operacionalPorCampoApartado('otto')).toBe(true);
  });
});

describe('otto_operational_query_still_gets_operational_context', () => {
  it('tirar o bloco da mensagem não tira o dado: ele passa a viajar por campo', () => {
    expect(operacionalPorCampoApartado('otto')).toBe(true);
  });
});

/**
 * REGRESSÃO DOS OUTROS AGENTES. A correção é só do Otto; se ela mexer no
 * caminho de quem já está passando, ela não vale.
 */
describe('a montagem dos outros agentes não muda', () => {
  it('bento_message_assembly_unchanged: sem contexto na mensagem, operacional por campo', () => {
    expect(contextoGeralVaiNaMensagem('bento')).toBe(false);
    expect(agenteAceitaBlocoNaMensagem('bento')).toBe(false);
    expect(operacionalPorCampoApartado('bento')).toBe(true);
  });

  it('jarbas_message_assembly_unchanged: contexto geral sim, operacional nunca', () => {
    expect(contextoGeralVaiNaMensagem('jarbas')).toBe(true);
    expect(agenteAceitaBlocoNaMensagem('jarbas')).toBe(false);
    expect(operacionalPorCampoApartado('jarbas')).toBe(false);
  });

  it('suzy_message_assembly_unchanged: mesmo serviço, mesmo contrato', () => {
    expect(contextoGeralVaiNaMensagem('suzy')).toBe(true);
    expect(agenteAceitaBlocoNaMensagem('suzy')).toBe(false);
    expect(operacionalPorCampoApartado('suzy')).toBe(false);
  });

  it('studio segue recebendo os dois blocos na mensagem: não tem campo próprio', () => {
    expect(contextoGeralVaiNaMensagem('studio')).toBe(true);
    expect(agenteAceitaBlocoNaMensagem('studio')).toBe(true);
    expect(operacionalPorCampoApartado('studio')).toBe(false);
  });
});

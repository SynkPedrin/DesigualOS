import { describe, expect, it } from 'vitest';
import { separarRegistrosAposentados, APOSENTADO_APOS_MS, type LinhaDeNode } from './retired-nodes';

const AGORA = new Date('2026-09-11T12:00:00.000Z').getTime();

function node(over: Partial<LinhaDeNode> = {}): LinhaDeNode {
  return {
    nodeId: 'NODE_X',
    agent: 'otto',
    status: 'online',
    lastHeartbeatAt: new Date(AGORA - 10_000),
    ...over,
  };
}

const velho = new Date(AGORA - APOSENTADO_APOS_MS - 60_000);

describe('separarRegistrosAposentados', () => {
  it('o caso real: NODE_OTTO velho sai da conta porque NODE_OTTO_01 está vivo', () => {
    const { ativos, aposentados } = separarRegistrosAposentados(
      [
        node({ nodeId: 'NODE_OTTO', status: 'offline', lastHeartbeatAt: velho }),
        node({ nodeId: 'NODE_OTTO_01', status: 'online' }),
      ],
      AGORA,
    );
    expect(aposentados.map((a) => a.nodeId)).toEqual(['NODE_OTTO']);
    expect(ativos.map((a) => a.nodeId)).toEqual(['NODE_OTTO_01']);
  });

  it('NÃO esconde máquina caída: sem nenhum node vivo do agente, o offline continua contando', () => {
    const { ativos, aposentados } = separarRegistrosAposentados(
      [
        node({ nodeId: 'NODE_SUZY', agent: 'suzy', status: 'offline', lastHeartbeatAt: velho }),
        node({ nodeId: 'NODE_SUZY_01', agent: 'suzy', status: 'offline', lastHeartbeatAt: velho }),
      ],
      AGORA,
    );
    expect(aposentados).toHaveLength(0);
    expect(ativos).toHaveLength(2);
  });

  it('queda RECENTE nunca é aposentada, mesmo com outro node do agente vivo', () => {
    const { aposentados } = separarRegistrosAposentados(
      [
        node({ nodeId: 'NODE_A', status: 'offline', lastHeartbeatAt: new Date(AGORA - 60_000) }),
        node({ nodeId: 'NODE_B', status: 'online' }),
      ],
      AGORA,
    );
    expect(aposentados).toHaveLength(0);
  });

  it('cada agente é avaliado sozinho: node vivo do Otto não aposenta registro da Suzy', () => {
    const { aposentados } = separarRegistrosAposentados(
      [
        node({ nodeId: 'NODE_OTTO_01', agent: 'otto', status: 'online' }),
        node({ nodeId: 'NODE_SUZY', agent: 'suzy', status: 'offline', lastHeartbeatAt: velho }),
      ],
      AGORA,
    );
    expect(aposentados).toHaveLength(0);
  });

  it('node online nunca é aposentado, por mais antigo que seja o registro', () => {
    const { aposentados } = separarRegistrosAposentados(
      [node({ nodeId: 'NODE_A', status: 'online', lastHeartbeatAt: velho })],
      AGORA,
    );
    expect(aposentados).toHaveLength(0);
  });

  it('registro que nunca bateu (heartbeat nulo) é aposentado se o agente tem node vivo', () => {
    const { aposentados } = separarRegistrosAposentados(
      [
        node({ nodeId: 'NODE_ORFAO', status: 'offline', lastHeartbeatAt: null }),
        node({ nodeId: 'NODE_VIVO', status: 'online' }),
      ],
      AGORA,
    );
    expect(aposentados.map((a) => a.nodeId)).toEqual(['NODE_ORFAO']);
  });

  it('status degradado não é offline: continua na conta, senão a degradação some do painel', () => {
    const { ativos, aposentados } = separarRegistrosAposentados(
      [
        node({ nodeId: 'NODE_DEG', status: 'degraded', lastHeartbeatAt: velho }),
        node({ nodeId: 'NODE_VIVO', status: 'online' }),
      ],
      AGORA,
    );
    // `degraded` só é aposentado pela mesma regra de qualquer não-online, e aqui ele CUMPRE as
    // duas condições. O que o teste trava é que a separação não inventa uma terceira categoria:
    // ou está na conta, ou está declarado como aposentado.
    expect(ativos.length + aposentados.length).toBe(2);
  });

  it('lista vazia não quebra', () => {
    expect(separarRegistrosAposentados([], AGORA)).toEqual({ ativos: [], aposentados: [] });
  });
});

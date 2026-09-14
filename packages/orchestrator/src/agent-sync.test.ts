import { describe, expect, it } from 'vitest';
import { decideNodeStatus, isOrphanProbeRow } from './agent-sync';

/**
 * As duas decisões que erravam em SILÊNCIO no Monitoramento (11/09/2026,
 * relato: "o sistema consta que os agentes estão offline mas todos estão
 * ligados"). Nenhuma das duas lança exceção quando erra - a consequência é
 * uma tela que mente, que é justamente o que ninguém percebe até alguém
 * reclamar.
 */

describe('isOrphanProbeRow', () => {
  const alvos = new Set(['NODE_BENTO_01', 'NODE_SUZY_01']);
  const agora = Date.parse('2026-09-11T12:00:00Z');
  const ontem = new Date('2026-09-10T20:19:41Z');
  const agoraMesmo = new Date('2026-09-11T11:59:55Z');

  it('linha da sonda antiga, fora da lista de alvos e parada há horas, é órfã', () => {
    // Este é o caso real: os nodeIds ganharam o sufixo "_01" em 10/09 e as
    // linhas antigas ficaram congeladas em offline, inflando o painel pra
    // "4 de 10 conectados" com 5 máquinas fantasma.
    expect(isOrphanProbeRow({ nodeId: 'NODE_BENTO', version: 'probe', lastHeartbeatAt: ontem }, alvos, agora)).toBe(true);
  });

  it('linha que a sonda mantém viva NUNCA é apagada, mesmo fora da lista de alvos', () => {
    expect(
      isOrphanProbeRow({ nodeId: 'NODE_ALGUM', version: 'probe', lastHeartbeatAt: agoraMesmo }, alvos, agora),
    ).toBe(false);
  });

  it('alvo atual da sonda nunca é apagado', () => {
    expect(isOrphanProbeRow({ nodeId: 'NODE_BENTO_01', version: 'probe', lastHeartbeatAt: ontem }, alvos, agora)).toBe(false);
  });

  it('Node Agent de verdade (versão própria, registrado por heartbeat) nunca é apagado', () => {
    // Uma máquina que se registra sozinha grava a versão real dela. Mesmo
    // parada há dias, apagá-la seria destruir o cadastro de uma máquina real.
    expect(isOrphanProbeRow({ nodeId: 'NODE_NOVO_02', version: '1.4.2', lastHeartbeatAt: ontem }, alvos, agora)).toBe(false);
  });

  it('linha sem heartbeat nenhum e fora dos alvos é órfã', () => {
    expect(isOrphanProbeRow({ nodeId: 'NODE_VELHO', version: 'probe', lastHeartbeatAt: null }, alvos, agora)).toBe(true);
  });
});

describe('decideNodeStatus', () => {
  it('agente respondendo é gravado como respondeu, sem depender de histórico', () => {
    expect(decideNodeStatus('online', 'offline', 0)).toBe('online');
    expect(decideNodeStatus('degraded', 'online', 0)).toBe('degraded');
  });

  it('UMA falha isolada não derruba um agente que estava no ar', () => {
    // Handshake lento da Tailscale, pico de carga na máquina, um segundo de
    // Wi-Fi ruim: nada disso é "o agente caiu".
    expect(decideNodeStatus('offline', 'online', 1)).toBe('online');
    expect(decideNodeStatus('offline', 'online', 2)).toBe('online');
  });

  it('falhas seguidas o bastante declaram offline de verdade', () => {
    expect(decideNodeStatus('offline', 'online', 3)).toBe('offline');
    expect(decideNodeStatus('offline', 'online', 10)).toBe('offline');
  });

  it('quem já estava offline continua offline (não "volta" por falhar de novo)', () => {
    expect(decideNodeStatus('offline', 'offline', 1)).toBe('offline');
  });

  it('node sem registro anterior entra como offline, não inventa um estado saudável', () => {
    expect(decideNodeStatus('offline', null, 1)).toBe('offline');
  });

  it('a primeira resposta boa zera a dívida: volta a online na hora', () => {
    expect(decideNodeStatus('online', 'offline', 0)).toBe('online');
  });
});

describe('diagnoseTextEngine (via syncAgents)', () => {
  /**
   * O Ollama roda na máquina do Studio e é o motor de texto de Bento e
   * Jarbas. Em 11/09/2026 ele estava fora, o painel mostrava "Bento online",
   * e nenhuma tela ligava uma coisa na outra - o usuário descobriu agente
   * por agente, tentando conversar. O teste trava a ligação.
   */
  it('a lista de serviços do Studio identifica o Ollama pelo nome que o diagnóstico procura', async () => {
    const { getProbeTargets } = await import('./agent-probe');
    const studio = getProbeTargets().find((target) => target.agent === 'studio');

    expect(studio?.services.map((service) => service.name)).toContain('ollama');
  });
});

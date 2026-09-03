/**
 * Estado em memória deste processo do Node Agent. agentStatus reflete se o
 * agente (Bento/Jarbas/Suzy, via OpenClaw) está ocioso ou processando algo;
 * a integração real com OpenClaw entra na Fase 4+, por enquanto fica 'idle'.
 */
export const runtimeState = {
  agentStatus: 'idle' as 'idle' | 'busy',
  startedAt: Date.now(),
};

export function uptimeSeconds(): number {
  return Math.round((Date.now() - runtimeState.startedAt) / 1000);
}

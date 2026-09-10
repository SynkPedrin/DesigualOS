/**
 * Estado em memória deste processo do Node Agent. agentStatus reflete se o
 * Otto está ocioso ou no meio de um pipeline criativo (retrieval -> LLM ->
 * plano -> spec), pra o /status e o heartbeat reportarem busy de verdade.
 */
export const runtimeState = {
  agentStatus: 'idle' as 'idle' | 'busy',
  startedAt: Date.now(),
};

export function uptimeSeconds(): number {
  return Math.round((Date.now() - runtimeState.startedAt) / 1000);
}

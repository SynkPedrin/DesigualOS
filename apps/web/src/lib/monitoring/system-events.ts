export interface SystemEvent {
  id: string;
  nodeLabel: string;
  message: string;
  level: 'info' | 'warning' | 'error';
  timestamp: string;
}

function minutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/** Static seed: no real /ws yet, see docs/api-gaps.md. A live channel would append here. */
export const mockSystemEvents: SystemEvent[] = [
  { id: 'evt-1', nodeLabel: 'Studio (RTX 5090)', message: 'Job de renderização iniciado na fila.', level: 'info', timestamp: minutesAgo(4) },
  { id: 'evt-2', nodeLabel: 'Jarbas (Mac Mini 2)', message: 'CPU acima de 70% por mais de 5 minutos.', level: 'warning', timestamp: minutesAgo(18) },
  { id: 'evt-3', nodeLabel: 'Suzy (Mac Mini 3)', message: 'Heartbeat reestabelecido após atraso.', level: 'info', timestamp: minutesAgo(42) },
  { id: 'evt-4', nodeLabel: 'Suzy (Mac Mini 3)', message: 'Heartbeat atrasado, node marcado como degradado.', level: 'error', timestamp: minutesAgo(45) },
  { id: 'evt-5', nodeLabel: 'Bento (Mac Mini 1)', message: 'Node registrado e saudável.', level: 'info', timestamp: minutesAgo(390) },
  { id: 'evt-6', nodeLabel: 'Orchestrator', message: 'Backup diário não configurado, nenhuma ação necessária.', level: 'warning', timestamp: minutesAgo(700) },
];

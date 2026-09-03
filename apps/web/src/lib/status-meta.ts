import type { ExecutionStatus, NodeStatus } from '@desigual-os/types';

interface StatusMeta {
  label: string;
  dotClass: string;
  textClass: string;
}

export const NODE_STATUS_META: Record<NodeStatus, StatusMeta> = {
  online: { label: 'Online', dotClass: 'bg-sucesso', textClass: 'text-sucesso' },
  warning: { label: 'Alerta', dotClass: 'bg-aviso', textClass: 'text-aviso' },
  busy: { label: 'Ocupado', dotClass: 'bg-aviso', textClass: 'text-aviso' },
  rendering: { label: 'Renderizando', dotClass: 'bg-sinal', textClass: 'text-sinal' },
  degraded: { label: 'Degradado', dotClass: 'bg-aviso', textClass: 'text-aviso' },
  maintenance: { label: 'Manutenção', dotClass: 'bg-info', textClass: 'text-info' },
  offline: { label: 'Offline', dotClass: 'bg-erro', textClass: 'text-erro' },
};

export const EXECUTION_STATUS_META: Record<ExecutionStatus, StatusMeta> = {
  pending: { label: 'Pendente', dotClass: 'bg-nevoa', textClass: 'text-nevoa' },
  queued: { label: 'Na fila', dotClass: 'bg-info', textClass: 'text-info' },
  running: { label: 'Em execução', dotClass: 'bg-aviso', textClass: 'text-aviso' },
  completed: { label: 'Concluída', dotClass: 'bg-sucesso', textClass: 'text-sucesso' },
  failed: { label: 'Falhou', dotClass: 'bg-erro', textClass: 'text-erro' },
  timeout: { label: 'Expirou', dotClass: 'bg-erro', textClass: 'text-erro' },
  cancelled: { label: 'Cancelada', dotClass: 'bg-nevoa', textClass: 'text-nevoa' },
};

import { db } from '@desigual-os/database';

/** Quem está agindo e em qual empresa. Todo serviço do motor recebe isto; nenhum lê "usuário atual" de lugar nenhum. */
export interface WorkContext {
  organizationId: string;
  userId: string;
  /** user | automation | agent | system: vai para a trilha de atividade, para separar pessoa de máquina. */
  actorKind?: 'user' | 'automation' | 'agent' | 'system';
  /**
   * Quem recebeu aviso no sino nesta operação. O motor grava a notificação DENTRO da transação; quem monta o contexto
   * (a rota) avisa a tela de cada pessoa depois que a resposta sai, quando a transação já foi confirmada.
   */
  aoNotificar?: (userIds: string[]) => void;
}

/** Tipo da conexão OU da transação (os dois expõem a mesma API de consulta). */
export type Db = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

/** Teto de aninhamento de subtarefas. Configurável por quem monta o contexto; padrão conservador. */
export const MAX_SUBTASK_DEPTH = 5;

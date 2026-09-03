import { pgEnum } from 'drizzle-orm/pg-core';
import {
  AGENT_NAMES,
  EXECUTION_COMPLEXITIES,
  EXECUTION_STATUSES,
  NODE_STATUSES,
  NODE_TYPES,
  QUEUE_PRIORITIES,
  ROLE_NAMES,
} from '@desigual-os/types';

export const agentNameEnum = pgEnum('agent_name', AGENT_NAMES);
export const nodeTypeEnum = pgEnum('node_type', NODE_TYPES);
export const nodeStatusEnum = pgEnum('node_status', NODE_STATUSES);
export const executionStatusEnum = pgEnum('execution_status', EXECUTION_STATUSES);
export const executionComplexityEnum = pgEnum('execution_complexity', EXECUTION_COMPLEXITIES);
export const queuePriorityEnum = pgEnum('queue_priority', QUEUE_PRIORITIES);
export const roleNameEnum = pgEnum('role_name', ROLE_NAMES);

export const toolAccessEnum = pgEnum('tool_access', ['none', 'read', 'write']);
export const messageRoleEnum = pgEnum('message_role', ['user', 'assistant', 'system']);

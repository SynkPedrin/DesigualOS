import { pgEnum } from 'drizzle-orm/pg-core';
import {
  AGENT_NAMES,
  APPROVAL_RESOURCE_TYPES,
  APPROVAL_STATUSES,
  BRIEF_STATUSES,
  BRIEF_VERSION_SOURCES,
  COMMUNICATION_CHANNELS,
  CONVERSATION_STATUSES,
  DEMAND_PRIORITIES,
  DEMAND_SOURCES,
  DEMAND_STATUSES,
  EXECUTION_COMPLEXITIES,
  EXECUTION_STATUSES,
  MESSAGE_DELIVERY_STATUSES,
  MESSAGE_DIRECTIONS,
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

export const communicationChannelEnum = pgEnum('communication_channel', COMMUNICATION_CHANNELS);
export const conversationStatusEnum = pgEnum('conversation_status', CONVERSATION_STATUSES);
export const messageDirectionEnum = pgEnum('message_direction', MESSAGE_DIRECTIONS);
export const messageDeliveryStatusEnum = pgEnum('message_delivery_status', MESSAGE_DELIVERY_STATUSES);

export const demandSourceEnum = pgEnum('demand_source', DEMAND_SOURCES);
export const demandStatusEnum = pgEnum('demand_status', DEMAND_STATUSES);
export const demandPriorityEnum = pgEnum('demand_priority', DEMAND_PRIORITIES);

export const briefStatusEnum = pgEnum('brief_status', BRIEF_STATUSES);
export const briefVersionSourceEnum = pgEnum('brief_version_source', BRIEF_VERSION_SOURCES);

export const approvalResourceTypeEnum = pgEnum('approval_resource_type', APPROVAL_RESOURCE_TYPES);
export const approvalStatusEnum = pgEnum('approval_status', APPROVAL_STATUSES);

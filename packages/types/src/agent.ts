export const AGENT_NAMES = ['bento', 'jarbas', 'suzy', 'studio'] as const;

export type AgentName = (typeof AGENT_NAMES)[number];

export const NODE_TYPES = ['mac_mini', 'gpu_server'] as const;

export type NodeType = (typeof NODE_TYPES)[number];

export const NODE_STATUSES = ['online', 'warning', 'busy', 'degraded', 'offline', 'maintenance', 'rendering'] as const;

export type NodeStatus = (typeof NODE_STATUSES)[number];

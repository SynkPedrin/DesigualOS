export const EXECUTION_STATUSES = [
  'pending',
  'queued',
  'running',
  'completed',
  'failed',
  'timeout',
  'cancelled',
] as const;

export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const EXECUTION_COMPLEXITIES = ['low', 'medium', 'high'] as const;

export type ExecutionComplexity = (typeof EXECUTION_COMPLEXITIES)[number];

export const QUEUE_PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const;

export type QueuePriority = (typeof QUEUE_PRIORITIES)[number];

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ExecutionCost {
  estimated: number;
  actual: number | null;
}

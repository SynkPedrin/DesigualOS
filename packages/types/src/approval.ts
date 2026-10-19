/** Generic business-resource approval (P1-I, 06/10/2026) — separado do
 *  gate de tool-call da IA (packages/database schema/tools.ts
 *  `agent_tools.requires_approval`): um é "a IA pode executar isto?", o
 *  outro é "este recurso de negócio está aprovado?". */
export const APPROVAL_RESOURCE_TYPES = ['brief', 'creative', 'copy', 'task', 'campaign', 'budget', 'publication'] as const;
export type ApprovalResourceType = (typeof APPROVAL_RESOURCE_TYPES)[number];

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'changes_requested'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

import { describe, expect, it, vi } from 'vitest';
import { createVerifiedSeniorTask, MutationBudget } from './senior-operation';

vi.mock('./clickup-client', () => ({
  findMemberByEmail: vi.fn(async () => ({ id: 11, username: 'Sofia Mendes', email: 'sofia@example.test' })),
  resolveMemberByName: vi.fn(async () => ({ status: 'resolved', matchedBy: 'full', member: { id: 11, username: 'Sofia Mendes', email: 'sofia@example.test' } })),
  createTask: vi.fn(async () => ({ id: 'task-1', url: 'https://clickup.test/t/task-1' })),
  getTask: vi.fn(async () => ({ id: 'task-1', name: 'Carrossel IA', status: 'to do', dueDate: 1_000, listId: 'list-1', assignees: [{ id: 11, username: 'Sofia Mendes' }], description: 'briefing', attachments: [] })),
}));

const context = { executionId: 'exe-1', userId: 'user-1', organizationId: 'org-1', agent: 'bento' as const, permissions: [{ resource: 'clickup', action: 'write' }] };
const config = { apiKey: 'test', teamId: 'team-1' };

describe('senior operation create → assign → verify', () => {
  it('returns structured verified success', async () => {
    const result = await createVerifiedSeniorTask(config, context, { listId: 'list-1', name: 'Carrossel IA', description: 'briefing', assigneeName: 'Sofia Mendes', expected: { dueDate: 1_000 } });
    expect(result).toMatchObject({ success: true, verified: true, resourceId: 'task-1', assignedTo: { id: 11 } });
  });
  it('does not claim success without ClickUp permission', async () => {
    const result = await createVerifiedSeniorTask(config, { ...context, permissions: [] }, { listId: 'list-1', name: 'x', description: 'x' });
    expect(result).toMatchObject({ success: false, errorCode: 'permission_denied' });
  });
  it('stops a senior execution at its configured mutation budget', async () => {
    const budget = new MutationBudget(1);
    await createVerifiedSeniorTask(config, context, { listId: 'list-1', name: 'x', description: 'x' }, budget);
    const second = await createVerifiedSeniorTask(config, context, { listId: 'list-1', name: 'y', description: 'y' }, budget);
    expect(second).toMatchObject({ success: false, message: 'Mutation budget exceeded for this execution' });
  });
});

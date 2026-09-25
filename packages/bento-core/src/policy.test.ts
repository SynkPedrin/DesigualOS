import { describe, expect, it } from 'vitest';
import { resolveTargetResourceId, validateBentoAction } from './policy.js';
import { emptyResourceState, type StructuredAction } from './types.js';

const basePolicyCtx = {
  actorHasClickUpWrite: true,
  agentHasClickUpWrite: true,
  mutationsThisExecution: 0,
  maxMutationsPerExecution: 5,
  explicitMultiActionConfirmed: false,
};

function action(over: Partial<StructuredAction> = {}): StructuredAction {
  return {
    intent: 'create_task',
    target: null,
    changes: null,
    requestedCardinality: 1,
    reasoning: 'teste',
    ...over,
  };
}

describe('resolveTargetResourceId (§3 — nunca busca global primeiro)', () => {
  it('usa o resourceId explícito quando existe', () => {
    const state = emptyResourceState();
    const result = resolveTargetResourceId(action({ intent: 'update_task', target: { resourceType: 'CLICKUP_TASK', resourceId: '123' } }), state);
    expect(result).toBe('123');
  });

  it('cai pro foco quando a referência não tem id explícito', () => {
    const state = { ...emptyResourceState(), focusedResource: { resourceType: 'CLICKUP_TASK' as const, resourceId: 'FOCO', title: null } };
    const result = resolveTargetResourceId(action({ intent: 'update_task', target: { resourceType: 'CLICKUP_TASK', resourceId: null } }), state);
    expect(result).toBe('FOCO');
  });

  it('nunca resolve (retorna null) quando não há foco nem seleção única — pede esclarecimento, não busca global', () => {
    const state = emptyResourceState();
    const result = resolveTargetResourceId(action({ intent: 'update_task', target: { resourceType: 'CLICKUP_TASK', resourceId: null } }), state);
    expect(result).toBeNull();
  });
});

describe('validateBentoAction — P0-01 (cardinalidade) e P0-02 (referência) da auditoria', () => {
  it('bloqueia create com cardinalidade planejada acima da pedida', () => {
    // um create_task SEMPRE planeja 1; testamos o caso em que o pedido explicita 0 (leitura mal classificada como create)
    const decision = validateBentoAction(action({ requestedCardinality: 0 }), emptyResourceState(), basePolicyCtx);
    expect(decision.allowed).toBe(false);
    expect(decision.cardinality.blocked).toBe(true);
  });

  it('permite create com cardinalidade 1 pedida e 1 planejada', () => {
    const decision = validateBentoAction(action({ requestedCardinality: 1 }), emptyResourceState(), basePolicyCtx);
    expect(decision.allowed).toBe(true);
  });

  it('bloqueia update sem alvo resolvível — nunca cai pra busca global', () => {
    const decision = validateBentoAction(
      action({ intent: 'update_task', target: { resourceType: 'CLICKUP_TASK', resourceId: null }, requestedCardinality: 0 }),
      emptyResourceState(),
      basePolicyCtx,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('target_unresolved');
  });

  it('bloqueia escrita sem permissão RBAC, mesmo com alvo resolvido', () => {
    const state = { ...emptyResourceState(), focusedResource: { resourceType: 'CLICKUP_TASK' as const, resourceId: 'X', title: null } };
    const decision = validateBentoAction(
      action({ intent: 'update_task', target: { resourceType: 'CLICKUP_TASK', resourceId: null }, requestedCardinality: 0 }),
      state,
      { ...basePolicyCtx, actorHasClickUpWrite: false },
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('permission_denied');
  });

  it('bloqueia ao estourar o orçamento de mutações da execução', () => {
    const decision = validateBentoAction(action({ requestedCardinality: 1 }), emptyResourceState(), {
      ...basePolicyCtx,
      mutationsThisExecution: 5,
      maxMutationsPerExecution: 5,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('mutation_budget_exceeded');
  });

  it('leitura/análise nunca é bloqueada por cardinalidade ou permissão', () => {
    const decision = validateBentoAction(action({ intent: 'analyze_tasks', requestedCardinality: 0 }), emptyResourceState(), {
      ...basePolicyCtx,
      actorHasClickUpWrite: false,
      agentHasClickUpWrite: false,
    });
    expect(decision.allowed).toBe(true);
  });
});

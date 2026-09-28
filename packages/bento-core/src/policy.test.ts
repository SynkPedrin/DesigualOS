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

const estadoComFoco = () => ({
  ...emptyResourceState(),
  focusedResource: { resourceType: 'CLICKUP_TASK' as const, resourceId: 'T1', title: 'Task focada' },
});

describe('D.11/F-17 — operações de responsável (assignee_add/remove/replace)', () => {
  it('"tira o Matheus dela" → update_task + assigneeOperation remove + pessoa → permitido', () => {
    const decision = validateBentoAction(
      action({
        intent: 'update_task',
        target: { resourceType: 'CLICKUP_TASK', resourceId: null },
        changes: { assignee: 'Matheus', assigneeOperation: 'remove' },
        requestedCardinality: 0,
      }),
      estadoComFoco(),
      { ...basePolicyCtx, message: 'não, tira o Matheus dela' },
    );
    expect(decision.allowed).toBe(true);
    expect(decision.resolvedResourceId).toBe('T1');
  });

  it('"coloca o Matheus nela" → assigneeOperation add com pessoa → permitido', () => {
    const decision = validateBentoAction(
      action({
        intent: 'update_task',
        target: { resourceType: 'CLICKUP_TASK', resourceId: null },
        changes: { assignee: 'Matheus', assigneeOperation: 'add' },
        requestedCardinality: 0,
      }),
      estadoComFoco(),
      { ...basePolicyCtx, message: 'coloca o Matheus nela' },
    );
    expect(decision.allowed).toBe(true);
  });

  it('"troca o responsável pra Sofia" → assigneeOperation replace com pessoa → permitido', () => {
    const decision = validateBentoAction(
      action({
        intent: 'update_task',
        target: { resourceType: 'CLICKUP_TASK', resourceId: null },
        changes: { assignee: 'Sofia', assigneeOperation: 'replace' },
        requestedCardinality: 0,
      }),
      estadoComFoco(),
      { ...basePolicyCtx, message: 'troca o responsável pra Sofia' },
    );
    expect(decision.allowed).toBe(true);
  });

  it('negativo: "tira o Matheus" SEM pessoa identificada → esclarecimento, nunca noop silencioso', () => {
    const decision = validateBentoAction(
      action({
        intent: 'update_task',
        target: { resourceType: 'CLICKUP_TASK', resourceId: null },
        changes: { assigneeOperation: 'remove' },
        requestedCardinality: 0,
      }),
      estadoComFoco(),
      { ...basePolicyCtx, message: 'tira ele dela' },
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('assignee_unresolved');
  });

  it('assignee sem operação explícita continua válido (default semântico = add, compatível com o executor)', () => {
    const decision = validateBentoAction(
      action({
        intent: 'update_task',
        target: { resourceType: 'CLICKUP_TASK', resourceId: null },
        changes: { assignee: 'Matheus' },
        requestedCardinality: 0,
      }),
      estadoComFoco(),
      basePolicyCtx,
    );
    expect(decision.allowed).toBe(true);
  });
});

describe('D.12/F-18 — sem conteúdo material vira esclarecimento, NUNCA placeholder', () => {
  it('T11 exato: comment_task com placeholder "observação não especificada" → bloqueado', () => {
    const decision = validateBentoAction(
      action({
        intent: 'comment_task',
        target: { resourceType: 'CLICKUP_TASK', resourceId: null },
        changes: { comment: 'observação não especificada' },
        requestedCardinality: 0,
      }),
      estadoComFoco(),
      { ...basePolicyCtx, message: 'coloca essa observação naquela demanda' },
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('content_missing');
  });

  it('variação: comment_task sem campo comment nenhum → bloqueado', () => {
    const decision = validateBentoAction(
      action({ intent: 'comment_task', target: { resourceType: 'CLICKUP_TASK', resourceId: null }, changes: null, requestedCardinality: 0 }),
      estadoComFoco(),
      { ...basePolicyCtx, message: 'comenta isso nela' },
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('content_missing');
  });

  it('variação: comment_task com comentário só de espaços → bloqueado', () => {
    const decision = validateBentoAction(
      action({
        intent: 'comment_task',
        target: { resourceType: 'CLICKUP_TASK', resourceId: null },
        changes: { comment: '   ' },
        requestedCardinality: 0,
      }),
      estadoComFoco(),
      { ...basePolicyCtx, message: 'coloca uma observação nessa task' },
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('content_missing');
  });

  it('variação: update_task de briefing sem nenhum campo concreto → bloqueado', () => {
    const decision = validateBentoAction(
      action({ intent: 'update_task', target: { resourceType: 'CLICKUP_TASK', resourceId: null }, changes: null, requestedCardinality: 0 }),
      estadoComFoco(),
      { ...basePolicyCtx, message: 'atualiza o briefing dela' },
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('content_missing');
  });

  it('"adiciona no briefing: incluir legendas acessíveis" → conteúdo material presente → permitido', () => {
    const decision = validateBentoAction(
      action({
        intent: 'update_task',
        target: { resourceType: 'CLICKUP_TASK', resourceId: null },
        changes: { description: 'incluir legendas acessíveis' },
        requestedCardinality: 0,
      }),
      estadoComFoco(),
      { ...basePolicyCtx, message: 'adiciona no briefing: incluir legendas acessíveis' },
    );
    expect(decision.allowed).toBe(true);
  });

  it('comment_task com texto real → permitido', () => {
    const decision = validateBentoAction(
      action({
        intent: 'comment_task',
        target: { resourceType: 'CLICKUP_TASK', resourceId: null },
        changes: { comment: 'cliente pediu pra trocar o CTA' },
        requestedCardinality: 0,
      }),
      estadoComFoco(),
      { ...basePolicyCtx, message: 'comenta na task: cliente pediu pra trocar o CTA' },
    );
    expect(decision.allowed).toBe(true);
  });
});

describe('C.2/F-02/F-05 — invariante anti UPDATE→CREATE na camada policy', () => {
  it('"adiciona o Matheus também" com foco existente NUNCA vira create → bloqueado pra esclarecimento', () => {
    const decision = validateBentoAction(
      action({ intent: 'create_task', changes: { title: 'Matheus' } }),
      estadoComFoco(),
      { ...basePolicyCtx, message: 'adiciona o Matheus também' },
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('create_blocked_update_signal');
  });

  it('verbo de edição + referente explícito bloqueia mesmo sem foco no estado', () => {
    const decision = validateBentoAction(
      action({ intent: 'create_task', changes: { title: 'observação' } }),
      emptyResourceState(),
      { ...basePolicyCtx, message: 'coloca essa observação naquela demanda' },
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('create_blocked_update_signal');
  });

  it('"cria uma task nova de revisão" (sinal explícito de criação) continua criando, mesmo com foco', () => {
    const decision = validateBentoAction(
      action({ intent: 'create_task', changes: { title: 'revisão' } }),
      estadoComFoco(),
      { ...basePolicyCtx, message: 'cria uma task nova de revisão' },
    );
    expect(decision.allowed).toBe(true);
  });

  it('sem ctx.message a guarda fica desligada (fail-open documentado — caller antigo)', () => {
    const decision = validateBentoAction(
      action({ intent: 'create_task', changes: { title: 'Matheus' } }),
      estadoComFoco(),
      basePolicyCtx,
    );
    expect(decision.allowed).toBe(true);
  });

  it('create com título normalizado idêntico a recentCreatedResources → possibleDuplicate sinalizado, execução continua liberada', () => {
    const state = {
      ...emptyResourceState(),
      recentCreatedResources: [{ resourceType: 'CLICKUP_TASK' as const, resourceId: 'T9', title: '  Post X  ' }],
    };
    const decision = validateBentoAction(
      action({ intent: 'create_task', changes: { title: 'post x' } }),
      state,
      { ...basePolicyCtx, message: 'cria a task post x' },
    );
    expect(decision.allowed).toBe(true);
    expect(decision.possibleDuplicate).toBe(true);
  });

  it('título diferente dos recursos recentes → possibleDuplicate false', () => {
    const state = {
      ...emptyResourceState(),
      recentCreatedResources: [{ resourceType: 'CLICKUP_TASK' as const, resourceId: 'T9', title: 'Post X' }],
    };
    const decision = validateBentoAction(action({ intent: 'create_task', changes: { title: 'Post Y' } }), state, basePolicyCtx);
    expect(decision.allowed).toBe(true);
    expect(decision.possibleDuplicate).toBe(false);
  });
});

/**
 * 28/09/2026, com a Tammy: "altere o status dessa task para urgente" virou
 * changes.priority (certo) e a policy respondeu "não identifiquei o que devo
 * alterar" — porque `priority` não contava como mudança material. É a MESMA
 * falha que o status tinha, repetida por um campo novo nascer sem entrar na
 * lista. Este bloco existe pra que o próximo campo não repita: cada um dos
 * campos que o plano carrega tem que autorizar a escrita sozinho.
 */
describe('todo campo do plano conta como pedido de mudança', () => {
  const alvo = { resourceType: 'CLICKUP_TASK' as const, resourceId: 'T1' };

  function permite(changes: NonNullable<StructuredAction['changes']>) {
    return validateBentoAction(
      action({ intent: 'update_task', target: alvo, changes, requestedCardinality: 0 }),
      emptyResourceState(),
      basePolicyCtx,
    ).allowed;
  }

  it.each<[string, NonNullable<StructuredAction['changes']>]>([
    ['prioridade (o caso da Tammy)', { priority: 'urgente' }],
    ['data de início', { startDate: '2026-10-05' }],
    ['estimativa', { timeEstimate: '2h' }],
    ['tag aplicada', { addTags: ['urgente-cliente'] }],
    ['tag removida', { removeTags: ['rascunho'] }],
    ['campo personalizado', { customFields: { Etapa: 'Aprovação' } }],
    ['checklist', { checklistItems: ['revisar texto', 'exportar'] }],
    ['dependência', { dependsOnTaskId: 'T9' }],
    ['dependência inversa', { dependencyOfTaskId: 'T9' }],
    ['status (o destravamento anterior)', { status: 'concluída' }],
  ])('%s autoriza a escrita sozinho', (_nome, changes) => {
    expect(permite(changes)).toBe(true);
  });

  it('pedido sem NENHUM campo continua pedindo esclarecimento', () => {
    expect(permite({})).toBe(false);
  });

  it('e tag/checklist vazios não são pedido', () => {
    expect(permite({ addTags: [], checklistItems: [] })).toBe(false);
  });
});

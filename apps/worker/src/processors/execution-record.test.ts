import { describe, expect, it } from 'vitest';
import {
  answerFromExecutionState,
  detectExecutionStatusQuestion,
  executionStateFromGuardMetadata,
  parseExecutionRecord,
  sameExecutionAlreadyDone,
  type ExecutionRecord,
} from './execution-record';

const REC: ExecutionRecord = {
  executionId: 'exec-1',
  operation: 'briefing_assign',
  taskIds: ['t1', 't2', 't3'],
  targetPerson: { name: 'Pedro', memberId: 123, username: 'Pedro Gabriel' },
  successIds: ['t1', 't2', 't3'],
  failedIds: [],
  timestamp: '2026-09-24T15:30:00.000Z',
  verification: [{ taskId: 't1', assigneeVerified: true, briefingVerified: true }],
  selectionReason: 'tasks_due_today',
  titles: { t1: 'Post feed', t2: 'Landing', t3: 'Roteiro reels' },
};

describe('detectExecutionStatusQuestion', () => {
  it('reconhece as formas reais de perguntar o estado', () => {
    expect(detectExecutionStatusQuestion('já lançou pro pedro no clickup?')).toBe(true);
    expect(detectExecutionStatusQuestion('já fez?')).toBe(true);
    expect(detectExecutionStatusQuestion('deu certo?')).toBe(true);
    expect(detectExecutionStatusQuestion('qual falhou?')).toBe(true);
    expect(detectExecutionStatusQuestion('quais falharam?')).toBe(true);
    expect(detectExecutionStatusQuestion('quem ficou responsável mesmo?')).toBe(true);
    // Regressão do aceite (24/09/2026): "tá" perde o acento no plano() e não
    // casava — a pergunta ia parar no serviço remoto sem memória.
    expect(detectExecutionStatusQuestion('quem tá responsável agora?')).toBe(true);
    expect(detectExecutionStatusQuestion('foi pro clickup?')).toBe(true);
  });

  it('não sequestra pedido novo nem status de agente', () => {
    expect(detectExecutionStatusQuestion('lança essas pro Pedro')).toBe(false);
    expect(detectExecutionStatusQuestion('o Jarbas terminou?')).toBe(false);
    expect(detectExecutionStatusQuestion('quais tasks vencem hoje?')).toBe(false);
    expect(detectExecutionStatusQuestion('me conta quem é o Pedro')).toBe(false);
    expect(detectExecutionStatusQuestion('')).toBe(false);
  });
});

describe('answerFromExecutionState', () => {
  it('YES completo: todas confirmadas', () => {
    const r = answerFromExecutionState({ kind: 'executed', record: REC }, 'já lançou pro pedro no clickup?');
    expect(r).toMatch(/^✅ Sim\./);
    expect(r).toContain('3 tasks');
    expect(r).toContain('Pedro Gabriel');
    expect(r).toContain('releitura');
  });

  it('PARTIAL: conta sucessos e nomeia falhas com motivo', () => {
    const parcial: ExecutionRecord = {
      ...REC,
      successIds: ['t1', 't2'],
      failedIds: [{ id: 't3', title: 'Roteiro reels', reason: 'ClickUp recusou a escrita (403)' }],
    };
    const r = answerFromExecutionState({ kind: 'executed', record: parcial }, 'já lançou?');
    expect(r).toMatch(/^⚠️ Parcialmente/);
    expect(r).toContain('2 de 3');
    expect(r).toContain('Roteiro reels');
    expect(r).toContain('403');
  });

  it('NO: nada foi alterado', () => {
    const nada: ExecutionRecord = {
      ...REC,
      successIds: [],
      failedIds: [
        { id: 't1', title: 'Post feed', reason: 'sem autorização de escrita' },
        { id: 't2', title: 'Landing', reason: 'sem autorização de escrita' },
        { id: 't3', title: 'Roteiro reels', reason: 'sem autorização de escrita' },
      ],
    };
    const r = answerFromExecutionState({ kind: 'executed', record: nada }, 'deu certo?');
    expect(r).toMatch(/^❌ Não\./);
    expect(r).toContain('nenhuma das 3 tasks foi alterada');
  });

  it('"qual falhou?" lista só as falhas', () => {
    const parcial: ExecutionRecord = {
      ...REC,
      successIds: ['t1'],
      failedIds: [
        { id: 't2', title: 'Landing', reason: 'timeout' },
        { id: 't3', title: 'Roteiro reels', reason: 'timeout' },
      ],
    };
    const r = answerFromExecutionState({ kind: 'executed', record: parcial }, 'qual falhou?');
    expect(r).toContain('2 de 3 com problema');
    expect(r).toContain('Landing');
    expect(r).toContain('Roteiro reels');
    // Sem falha: resposta é "nenhuma falhou", nunca uma lista inventada
    expect(answerFromExecutionState({ kind: 'executed', record: REC }, 'qual falhou?')).toMatch(/^✅ Nenhuma\./);
  });

  it('"quem ficou responsável?" responde a pessoa do registro', () => {
    const r = answerFromExecutionState({ kind: 'executed', record: REC }, 'quem ficou responsável mesmo?');
    expect(r).toContain('Pedro Gabriel');
    expect(r).toContain('3 tasks');
  });

  it('bloqueio anterior responde NÃO com o motivo, sem fingir', () => {
    const r = answerFromExecutionState({ kind: 'not_executed', action: 'blocked_write_authz', reason: 'fora da autorização de produção do Bento' }, 'já lançou?');
    expect(r).toMatch(/^🔒 Não\./);
    expect(r).toContain('Nada foi criado nem modificado');
    expect(r).toContain('fora da autorização');
  });

  it('bloqueio com operação retida diz QUANTAS tasks continuam iguais e pra quem era', () => {
    const r = answerFromExecutionState(
      { kind: 'not_executed', action: 'blocked_write_authz', reason: 'esta conta não tem permissão de escrita no ClickUp', taskCount: 11, targetName: 'Pedro' },
      'já fez?',
    );
    expect(r).toBe('🔒 Não. As 11 tasks (destino: Pedro) continuam sem alteração: esta conta não tem permissão de escrita no ClickUp.');
  });
});

describe('executionStateFromGuardMetadata', () => {
  it('lê o formato estruturado novo (execucao)', () => {
    const estado = executionStateFromGuardMetadata({ guard: 'bento-action', action: 'selection_mutation', execucao: REC });
    expect(estado).toEqual({ kind: 'executed', record: REC });
  });

  it('traduz recibo histórico de create_tasks', () => {
    const estado = executionStateFromGuardMetadata({
      guard: 'bento-action',
      action: 'create_tasks',
      tasks: [
        { task_id: 'a1', title: 'Task A', status: 'created', assignee: 'Gui' },
        { task_id: 'b2', title: 'Task B', status: 'failed', error: 'ClickUp 500' },
      ],
    });
    expect(estado?.kind).toBe('executed');
    if (estado?.kind === 'executed') {
      expect(estado.record.successIds).toEqual(['a1']);
      expect(estado.record.failedIds).toEqual([{ id: 'b2', title: 'Task B', reason: 'ClickUp 500' }]);
      expect(estado.record.targetPerson?.username).toBe('Gui');
    }
  });

  it('traduz bloqueio de escrita pra not_executed', () => {
    expect(
      executionStateFromGuardMetadata({ guard: 'bento-action', action: 'blocked_client_unresolved', write_reason: 'cliente não resolvido' }),
    ).toEqual({ kind: 'not_executed', action: 'blocked_client_unresolved', reason: 'cliente não resolvido' });
  });

  it('qualquer recibo do guard sem escrita autorizada é NÃO honesto (regressão QA3, 24/09/2026)', () => {
    // "já lançou?" depois de pessoa não encontrada NUNCA pode cair no remoto
    const estado = executionStateFromGuardMetadata({ guard: 'bento-action', action: 'assignee_nao_encontrado', write_authorized: false });
    expect(estado?.kind).toBe('not_executed');
    if (estado?.kind === 'not_executed') expect(estado.reason).toContain('não foi encontrada');
  });

  it('update singular sem verified explícito NÃO é sucesso', () => {
    const estado = executionStateFromGuardMetadata({ guard: 'bento-action', action: 'update_assignee', task_id: 'x1' });
    expect(estado?.kind).toBe('executed');
    if (estado?.kind === 'executed') expect(estado.record.successIds).toEqual([]);
  });

  it('ignora metadata sem guard de ação', () => {
    expect(executionStateFromGuardMetadata({ fast_path: 'small_talk' })).toBeNull();
    expect(executionStateFromGuardMetadata({})).toBeNull();
  });

  it('parseExecutionRecord rejeita lixo', () => {
    expect(parseExecutionRecord(null)).toBeNull();
    expect(parseExecutionRecord({ executionId: 'x' })).toBeNull();
  });
});

describe('sameExecutionAlreadyDone (trava de mutação duplicada)', () => {
  it('mesma operação, mesmo conjunto, mesma pessoa, zero falhas = já feito', () => {
    expect(sameExecutionAlreadyDone(REC, { operation: 'briefing_assign', taskIds: ['t1', 't2', 't3'], memberId: 123 })).toBe(true);
    // Subconjunto também já está coberto
    expect(sameExecutionAlreadyDone(REC, { operation: 'briefing_assign', taskIds: ['t1'], memberId: 123 })).toBe(true);
  });

  it('qualquer diferença reexecuta', () => {
    expect(sameExecutionAlreadyDone(REC, { operation: 'assign', taskIds: ['t1'], memberId: 123 })).toBe(false);
    expect(sameExecutionAlreadyDone(REC, { operation: 'briefing_assign', taskIds: ['t1', 't9'], memberId: 123 })).toBe(false);
    expect(sameExecutionAlreadyDone(REC, { operation: 'briefing_assign', taskIds: ['t1'], memberId: 999 })).toBe(false);
    const comFalha: ExecutionRecord = { ...REC, successIds: ['t1', 't2'], failedIds: [{ id: 't3', title: 'x', reason: 'y' }] };
    expect(sameExecutionAlreadyDone(comFalha, { operation: 'briefing_assign', taskIds: ['t1', 't2', 't3'], memberId: 123 })).toBe(false);
  });
});

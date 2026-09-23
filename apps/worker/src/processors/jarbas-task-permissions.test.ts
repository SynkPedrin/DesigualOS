import { describe, expect, it } from 'vitest';
import { hasPermission, type ResolvedPermission } from '@desigual-os/auth';

/**
 * jarbas-task-permissions.test.ts — RBAC de atribuição de tarefa ao Jarbas
 * (§23-24/§39).
 *
 * Não existe framework de permissão novo aqui — `hasPermission` é a MESMA
 * função real que já governa toda a RBAC do sistema
 * (packages/auth/src/rbac.ts, usada por Bento/Otto via
 * `seniorToolContext.permissions`). O que este arquivo fixa é só a
 * CONVENÇÃO DE NOME de capability pro domínio do Jarbas — resource
 * `'jarbas'`, ações `'read' | 'assign' | 'analysis' | 'propose_action' |
 * 'approve_action'` — pra qualquer código futuro que for wire-ar o
 * dispatch de AgentTask numa rota real chamar exatamente esta função, sem
 * reinventar checagem de permissão.
 */

const JARBAS_ASSIGN: ResolvedPermission = { resource: 'jarbas', action: 'assign' };
const JARBAS_READ: ResolvedPermission = { resource: 'jarbas', action: 'read' };
const JARBAS_PROPOSE: ResolvedPermission = { resource: 'jarbas', action: 'propose_action' };
const CLICKUP_WRITE: ResolvedPermission = { resource: 'clickup', action: 'write' };
const MASTER_WILDCARD: ResolvedPermission = { resource: '*', action: '*' };

describe('capability jarbas:assign — quem pode atribuir uma análise ao Jarbas', () => {
  it('gestor autorizado (permissão explícita jarbas:assign) -> allow', () => {
    expect(hasPermission([JARBAS_ASSIGN], 'jarbas', 'assign')).toBe(true);
  });

  it('master (wildcard */*), herdado do papel, também permite', () => {
    expect(hasPermission([MASTER_WILDCARD], 'jarbas', 'assign')).toBe(true);
  });

  it('colaborador sem NENHUMA permissão de jarbas -> deny, mesmo com outras permissões', () => {
    expect(hasPermission([CLICKUP_WRITE], 'jarbas', 'assign')).toBe(false);
  });

  it('ter jarbas:read não implica jarbas:assign — capabilities são independentes', () => {
    expect(hasPermission([JARBAS_READ], 'jarbas', 'assign')).toBe(false);
  });

  it('lista de permissões vazia -> deny (nunca permissão por omissão/prompt)', () => {
    expect(hasPermission([], 'jarbas', 'assign')).toBe(false);
  });
});

describe('capability jarbas:propose_action — distinta de jarbas:assign', () => {
  it('quem pode atribuir não necessariamente pode propor mutação', () => {
    expect(hasPermission([JARBAS_ASSIGN], 'jarbas', 'propose_action')).toBe(false);
  });

  it('quem tem jarbas:propose_action explícita, pode', () => {
    expect(hasPermission([JARBAS_PROPOSE], 'jarbas', 'propose_action')).toBe(true);
  });
});

describe('nenhuma permissão é concedida só por texto de prompt (§24: "No permission based only on prompt text")', () => {
  it('a checagem é sempre contra a lista de permissões resolvida do usuário, nunca contra a mensagem', () => {
    // Estrutural: hasPermission nunca recebe a mensagem do usuário como
    // argumento — não existe caminho de código onde o TEXTO decide a
    // permissão. Este teste documenta a garantia via assinatura, não
    // apenas via comportamento.
    expect(hasPermission.length).toBe(3); // (permissions, resource, action) — nunca (message, ...)
  });
});

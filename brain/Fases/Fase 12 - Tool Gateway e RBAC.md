---
tags: [fase, desigual-os]
fase: 12
status: parcial
---

# Fase 12 - Tool Gateway + RBAC

## Escopo

Gateway central com matriz de permissões (dados, não hardcode), aprovação humana para ações críticas, cadeia de verificação de acesso.

## O que já está pronto

RBAC de usuário (`requireAuth` + `requirePermission(resource, action)`, [[Fase 13 - Auth e Auditoria]]) já existe e já está em uso de verdade: `POST /studio/jobs` exige `studio:write`, testado com um usuário `colaborador` real (tem a permissão, seedada) e a matriz de ferramentas por agente (`agent_tools`, seção 6.6) está seedada desde a Fase 1.

## O que falta

- **Tool Gateway em si**: um ponto central que os Node Agents consultam antes de chamar uma ferramenta externa de verdade (ClickUp, Meta, etc), checando `agent_tools`. Hoje a matriz existe como dado, mas nada a lê em runtime ainda, porque nenhum agente chama ferramenta externa de verdade (todas as integrações de Jarbas/Suzy são mock, [[Fase 05 - Jarbas Node]]/[[Fase 06 - Suzy Node]]).
- **Aprovação humana** pra ações críticas (publicar Instagram, mudar orçamento Meta, deletar tarefa): `agent_tools.requires_approval` já existe como coluna (Studio→Instagram já seedado como `true`), mas não existe o fluxo de fato (`REQUIRES_APPROVAL` → usuário confirma → executa).
- `requirePermission` só está em uso numa rota (`/studio/jobs`); as outras rotas de negócio (`/chat`, `/executions`) ainda não checam permissão por recurso, só autenticação.

## Arquivos relevantes

`apps/api/src/auth/middleware.ts` (`requirePermission`, já existe desde a Fase 13), `packages/database/src/schema/agents-infra.ts` (`agentTools`), aplicado em `apps/api/src/studio/routes.ts`.

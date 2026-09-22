# Bento & Otto — Operational Autonomy Report

Estado desta etapa: fundação do primeiro write path implementada; agentes ainda não certificados para autonomia operacional.

## ClickUp

O inventário encontrou `createTask`, `updateTask`, `getTask`, `getTeamMembers`, resolução por email/nome, comentários, anexos, subtasks via operação existente, verificação de task e deduplicação por nome. O caminho pré-existente `createAttributedTask` permanece compatível para fluxos atuais.

Foi criado `createVerifiedSeniorTask` em `packages/tool-gateway/src/senior-operation.ts`. Ele recebe contexto confiável com `executionId`, `userId`, `organizationId`, permissions e agente; resolve o responsável por email ou nome; recusa nome ambíguo/inexistente; cria; relê via `getTask`; compara nome, responsável e prazo; e só retorna `success: true, verified: true` depois da conferência.

Falhas retornam `success: false`, código, mensagem e retryable. O resultado nunca transforma uma falha de ClickUp ou divergência de read-back em confirmação positiva.

## Mutation control

`MutationBudget` limita mutações por execução. O padrão é `MAX_MUTATIONS_PER_EXECUTION=10`, configurável e limitado a 100. O contexto de execução mantém a organização fornecida pelo runtime; a função não aceita tenant vindo do modelo.

## Bento

Create task com responsável: PASS em teste unitário do executor estruturado.

Assignment ambiguity/not found: IMPLEMENTADO e não testado contra API ClickUp real nesta etapa.

Read-after-write: PASS em teste com `createTask`/`getTask` simulados; API real bloqueada por ausência de credenciais de sandbox.

Briefing, análise macro, delegation multi-step e handoff: NOT TESTED.

## Otto

O mesmo executor está disponível para `agent: 'otto'`, com contrato idêntico e sem alterar o comportamento do node Otto. Create creative task, briefing criativo, assignment e handoff Otto→Bento: NOT TESTED.

## Feature flags

Foram adicionadas `AGENT_LOOP_BENTO_V2`, `AGENT_LOOP_OTTO_V2`, `AGENT_LOOP_SUZY_V2` e `AGENT_LOOP_JARBAS_V2`. Flags específicas têm precedência sobre a flag legada, e Jarbas permanece sempre bloqueado. Nenhuma flag foi ativada.

## Verification

- Tool gateway: 72 testes passaram.
- Monorepo typecheck: 18/18 pacotes passaram.
- Monorepo test: passou; API 103 testes, worker 492 testes; 3 testes PostgreSQL condicionais ficaram skipped sem banco de QA no comando agregado.
- Build: 6 tarefas passaram.
- O fluxo real ClickUp não foi executado: não havia credencial de sandbox disponível. Portanto a prova cobre contrato, falha, permissão e verificação com doubles controlados, não uma task externa real.

## Gate

`create → assign → verify` está implementado como primitiva segura e testada. Bento/Otto continuam `NOT READY` para a classificação `OPERATIONAL_AGENT` porque ainda falta conectar essa primitiva ao runtime de tools com contexto tenant real, executar ClickUp sandbox, provar idempotência contra timeout pós-criação, e testar os cenários E2E de Bento, Otto e handoff.

---
tags: [moc, desigual-os]
status: living-document
---

# Cérebro do Desigual OS

Este vault é a memória viva do projeto **Desigual OS**: o sistema operacional de IA da Agência Desigual (Orchestrator + AI Router + Node Agents). Ele documenta decisões, arquitetura, progresso por fase e pendências. Não é o vault de conhecimento de nenhum agente (Bento, Jarbas, Suzy, Studio); aqueles ficam locais em cada máquina e nunca são sincronizados aqui (ver [[01 - Regras de Ouro]], regra 1).

## Mapa do projeto

- [[01 - Regras de Ouro]]
- [[02 - Stack Tecnologica]]
- [[03 - Estrutura do Monorepo]]
- [[04 - Glossario de Componentes]]
- [[05 - Modelo de Dados]]
- [[06 - Contratos de API]]
- [[07 - Design System]]
- [[99 - Pendencias]]

## Agentes

- [[Bento]]
- [[Jarbas]]
- [[Suzy]]
- [[Studio]]

## Fases de execução

- [[Fase 01 - Core e Database]]
- [[Fase 02 - Node Protocol e Node Agent base]]
- [[Fase 03 - Node Registry, Discovery e Health]]
- [[Fase 04 - Bento Node]]
- [[Fase 05 - Jarbas Node]]
- [[Fase 06 - Suzy Node]]
- [[Fase 07 - Studio Node e GPU Worker]]
- [[Fase 08 - AI Router]]
- [[Fase 09 - Queue e Orchestrator]]
- [[Fase 10 - Workflow Engine]]
- [[Fase 11 - Context Engine e Token Cost Engine]]
- [[Fase 12 - Tool Gateway e RBAC]]
- [[Fase 13 - Auth e Auditoria]]
- [[Fase 14 - Frontend]]
- [[Fase 15 - Security Hardening]]
- [[Fase 16 - Testing]]
- [[Fase 17 - Production Deployment]]
- [[Fase Extra - Pedidos do Usuario 2026-09-01]]

## Decisões de arquitetura

Pasta [[Decisoes]] espelha `docs/architecture/decisions/` do monorepo assim que ele existir. Cada ADR é criado nos dois lugares ao mesmo tempo.

## Como este vault é mantido

Toda vez que uma fase do plano mestre é concluída, a nota correspondente em `Fases/` é atualizada com status, arquivos criados e decisões tomadas. Toda decisão de arquitetura relevante vira uma nota em `Decisoes/`. Isso mantém uma trilha legível do "porquê" por trás do sistema, sem depender só do histórico de git.

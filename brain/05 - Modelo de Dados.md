---
tags: [database, drizzle, desigual-os]
---

# Modelo de Dados (PostgreSQL via Drizzle)

Fonte: prompt mestre, seção 8. Banco hospedado no Supabase, ver [[0001 - Supabase Completo]] (o schema e as migrations em si não mudam por causa disso). Migrations versionadas em `database/migrations/`, seeds em `database/seeds/`. Todas as tabelas com `id` (uuid), `created_at`, `updated_at`. Soft delete onde fizer sentido.

## Grupos de tabelas

- **Identidade e acesso:** users, roles, permissions, user_roles
- **Clientes:** clients, client_users, client_brand_kits
- **Agentes e infraestrutura:** agents, nodes, node_capabilities, agent_tools
- **Conversa e execução:** conversations, messages, conversation_context, router_decisions, execution_plans, executions, execution_steps
- **Filas:** jobs, job_attempts
- **Ferramentas:** tool_calls, tool_results
- **Custos:** token_usage, model_usage, cost_records, economy_records
- **Conhecimento:** knowledge_sources, knowledge_documents, knowledge_chunks, embeddings, memories
- **ClickUp (espelho operacional):** clickup_workspaces, clickup_spaces, clickup_lists, clickup_tasks
- **Studio:** studio_projects, studio_assets, studio_jobs, studio_brand_kits
- **Workflows:** workflows, workflow_steps
- **Observabilidade:** audit_logs, notifications, system_events, health_checks

## Campos mínimos notáveis

`executions`: execution_id, user_id, client_id, agent, intent, status, started_at, completed_at, tokens_input, tokens_output, estimated_cost, actual_cost.

`audit_logs`: id, user_id, action, agent, client_id, timestamp, result, metadata.

Implementado na [[Fase 01 - Core e Database]].

---
tags: [glossario, desigual-os]
---

# Glossário de Componentes

Fonte: prompt mestre, seção 3.

| Componente | Responsabilidade |
|---|---|
| Desigual OS | Interface, usuários, clientes, histórico, operação |
| AI Router | Descobrir quem deve resolver a tarefa (intent, agente, tools, plano) |
| Orchestrator | Planejar e coordenar execuções e workflows multi agente |
| Node Registry | Descobrir e manter o estado das máquinas (3 Macs + RTX) |
| Node Agent | Servidor local em cada máquina, executa comandos e reporta saúde |
| Context Engine | Montar o contexto mínimo necessário para cada execução |
| Token Engine | Estimar, medir e registrar consumo e custo de tokens |
| Tool Gateway | Controle central de acesso às integrações (ClickUp, Meta, etc) |
| Queue | Filas por agente com prioridade, retry, timeout, circuit breaker |
| Studio / GPU Worker | Execução de jobs de imagem e vídeo na RTX 5090 |
| Auth / RBAC | Usuários, papéis, permissões, acesso a clientes/agentes/tools |
| Audit System | Rastreabilidade de todas as ações |
| Health Monitor | Saúde de cada node via heartbeat |

Relacionado: [[05 - Modelo de Dados]], [[06 - Contratos de API]].

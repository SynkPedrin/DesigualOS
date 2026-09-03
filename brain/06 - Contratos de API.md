---
tags: [api, contratos, desigual-os]
---

# Contratos de API Principais

Fonte: prompt mestre, seção 9. Toda entrada/saída validada com Zod. Auth por JWT (usuário) ou node token (máquina).

```
# Conversa (entrada principal do usuário)
POST /chat
  body: { message, client_id?, agent_hint? }   # AUTO|BENTO|JARBAS|SUZY|STUDIO

# Execuções
GET  /executions
GET  /executions/:id

# Studio
POST /studio/jobs
GET  /studio/jobs/:id
GET  /studio/assets?client_id=

# Nodes / infraestrutura
POST /nodes/register
POST /nodes/:id/heartbeat
GET  /nodes
GET  /health/infrastructure

# Custos e analytics
GET  /costs/overview?range=
GET  /costs/by-agent
GET  /costs/by-client
GET  /costs/by-user
GET  /analytics/usage

# Admin
GET/POST/PATCH /users
GET/POST/PATCH /clients
GET  /audit
```

Canal WebSocket `/ws`: eventos `execution.progress`, `execution.completed`, `node.status`, `studio.job.progress`, `agent.thinking`.

Relacionado: [[04 - Glossario de Componentes]], [[Fase 09 - Queue e Orchestrator]].

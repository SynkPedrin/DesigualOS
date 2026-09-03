---
tags: [fase, desigual-os]
fase: 5
status: concluida
---

# Fase 05 - Jarbas Node

## Escopo

Tools de performance para [[Jarbas]], mock inicial de Meta/Google Ads.

## Decisão: reaproveitar o Node Agent genérico

`nodes/desigual-node` (Fase 2 e 4) já é agnóstico de agente: `AGENT_NAME` no `.env` decide se aquela instância representa Bento, Jarbas ou Suzy. Não existe "jarbas-node" separado; é o mesmo binário. Validado de verdade: subi uma instância com `AGENT_NAME=jarbas`, `CAPABILITIES=meta_ads,google_ads,clickup`, e ela se registrou e apareceu corretamente no Orchestrator como agente `jarbas`.

O mock de Meta/Google Ads em si não é código do Node Agent, é dado do Tool Gateway (matriz `agent_tools`, já seedada desde a Fase 1: Jarbas tem `meta_ads`/`google_ads` write). A execução de fato de uma chamada mockada de tool entra na [[Fase 12 - Tool Gateway e RBAC]], quando existir alguma rota que dispare tool calls de verdade.

## Definition of Done

`POST /execute` retorna resultado estruturado com `usage` (mesmo código validado na Fase 04, agora confirmado também com `AGENT_NAME=jarbas`).

## Arquivos criados

Nenhum novo; reaproveita `nodes/desigual-node` inteiro.

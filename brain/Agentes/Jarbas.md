---
tags: [agente, jarbas, desigual-os]
node_id: NODE_JARBAS_01
machine: mac_mini
---

# Jarbas

Performance e tráfego: Meta Ads, Google Ads, Analytics, CPL, CPA, CTR, ROAS, criativos, relatórios.

## Node

Mac Mini próprio, OpenClaw + tools de performance. Integrações Meta/Google inicialmente mockadas na [[Fase 05 - Jarbas Node]].

## Capabilities declaradas no registro

Ligadas a `campaign_analysis` e `campaign_creation` no [[AI Router|Router]] (ver [[04 - Glossario de Componentes]]).

## Permissões (Tool Gateway)

Meta READ/WRITE, Google Ads, ClickUp, Studio.

## Timeout de fila

180s. Ver [[Fase 09 - Queue e Orchestrator]].

## Aprovação humana obrigatória

Alterar orçamento no Meta exige confirmação do usuário antes de executar (fluxo `REQUIRES_APPROVAL`).

Implementado na [[Fase 05 - Jarbas Node]].

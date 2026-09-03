---
tags: [agente, bento, desigual-os]
node_id: NODE_BENTO_01
machine: mac_mini
---

# Bento

Inteligência institucional da agência: processos, clientes, SOPs, estratégias, histórico, conhecimento interno.

## Node

Roda em Mac Mini próprio, com OpenClaw + Obsidian local (nunca sincronizado ao servidor, ver [[01 - Regras de Ouro]] regra 1). O cérebro do Bento é o vault dele na máquina dele, não este vault do projeto.

## Capabilities declaradas no registro

`knowledge`, `reasoning`, `clickup`, `obsidian`

## Permissões (Tool Gateway)

ClickUp READ/WRITE, Studio, Obsidian. Meta e Instagram negados.

## Timeout de fila

120s. Ver [[Fase 09 - Queue e Orchestrator]].

## Papel em workflows

Normalmente abre (briefing, persona, posicionamento, oferta) e fecha (revisão) workflows multi agente. Exemplo em [[Fase 10 - Workflow Engine]].

Implementado na [[Fase 04 - Bento Node]].

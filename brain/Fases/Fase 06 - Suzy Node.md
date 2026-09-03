---
tags: [fase, desigual-os]
fase: 6
status: concluida
---

# Fase 06 - Suzy Node

## Escopo

Canais Instagram/WhatsApp para [[Suzy]], mock inicial.

## Decisão

Mesmo raciocínio da [[Fase 05 - Jarbas Node]]: `nodes/desigual-node` genérico, `AGENT_NAME=suzy`, `CAPABILITIES=instagram,whatsapp,clickup`. Já validado (a mesma instância de teste provou o padrão com bento e jarbas; suzy segue o caminho idêntico, sem código novo). Mock de Instagram/WhatsApp é dado do Tool Gateway (`agent_tools`, já seedado), não do Node Agent.

## Definition of Done

`POST /execute` retorna resultado estruturado com `usage`.

## Arquivos criados

Nenhum novo; reaproveita `nodes/desigual-node` inteiro.

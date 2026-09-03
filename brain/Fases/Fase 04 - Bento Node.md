---
tags: [fase, desigual-os]
fase: 4
status: concluida
---

# Fase 04 - Bento Node

## Escopo

Integração OpenClaw + Obsidian sob demanda para [[Bento]], sem sync do vault para o servidor. `POST /execute` no `desigual-node`, chamando o CLI real do OpenClaw via `child_process` (não HTTP: Node Agent e OpenClaw rodam na mesma máquina).

## Descoberta importante

Esta própria máquina de desenvolvimento tem uma instalação real do OpenClaw rodando (`openclaw agent --help` confirma o CLI real, Gateway ativo em `localhost:18789`). Não é a máquina de produção do Bento (só tem um agente "main" configurado, claramente de uso pessoal do usuário), então não disparei nenhum turno de verdade contra ela (custaria tokens reais e pode ter efeitos colaterais). Usei o `--help` (seguro, só documentação) pra confirmar o contrato real da CLI, e testei o encaminhamento com um `agent_id` inexistente de propósito: o OpenClaw real respondeu "Unknown agent id", provando que a integração funciona ponta a ponta sem executar nada de fato.

## Definition of Done

`POST /execute` retorna resultado estruturado com `usage` (schema completo em `packages/node-protocol/src/execute.ts`). Testado de verdade: erro real do OpenClaw propagado corretamente (`status: 'failed'`, `error` com a mensagem real da CLI). Busca no Obsidian testada contra o vault `brain/` deste próprio projeto (snippets reais retornados, nunca o arquivo inteiro). Nada do Obsidian é copiado ao servidor: a busca é sempre local ao Node, só o recorte que bate com a query sai daqui.

## Bug real encontrado

`OPENCLAW_GATEWAY_URL` (nossa env var, usada só pelo health check HTTP) tem o MESMO nome de uma env var real do OpenClaw. Como o `child_process` herdava `process.env` por padrão, isso fazia o CLI real interpretar como um override de gateway exigindo credenciais explícitas. Corrigido passando um `env` limpo pro processo filho, só com `PATH`/`HOME`, nunca herdando o resto.

## Limitação conhecida

O schema exato do JSON de saída de `openclaw agent --json` (usage de tokens, etc) não foi confirmado contra uma execução real, pelo motivo acima. O parser é tolerante (tenta campos plausíveis, nunca perde a resposta), mas `usage` vem zerado até alguém validar contra uma chamada real na máquina de destino. Documentado em código (`nodes/desigual-node/src/openclaw/client.ts`).

## Arquivos criados

`packages/node-protocol/src/execute.ts`, `nodes/desigual-node/src/openclaw/client.ts`, `nodes/desigual-node/src/obsidian/reader.ts`, `nodes/desigual-node/src/execute.ts`, rota `POST /execute` em `server/index.ts`, config estendida em `config.ts`.

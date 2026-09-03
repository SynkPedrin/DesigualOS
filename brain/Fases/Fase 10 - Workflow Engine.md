---
tags: [fase, desigual-os]
fase: 10
status: concluida
---

# Fase 10 - Workflow Engine (multi agente)

## Escopo

Execução de workflows ordenados ([[Bento]] → [[Jarbas]] → [[Studio]] → [[Bento]]), `execution_steps` e `workflow_steps`, comunicação sempre via Orchestrator (regra 5 de [[01 - Regras de Ouro]]): cada etapa é um job de fila separado, o worker encadeia a próxima ao terminar a anterior, nunca os agentes falando direto entre si.

## Definition of Done

Testado de ponta a ponta com infraestrutura real (Orchestrator, worker, BullMQ, Postgres reais; só os 3 nodes finais foram substituídos por um servidor HTTP mínimo que responde `/execute` na hora, especificamente pra não gastar chamadas reais de OpenClaw enquanto valido a lógica de orquestração, que é 100% código nosso). "Crie uma campanha completa para a Clínica X" rodou o workflow inteiro (bento → jarbas → studio → bento) com um único `execution_id`, cada etapa recebendo a resposta da etapa anterior encadeada na mensagem, `GET /executions/:id` mostrando as 4 etapas com status e output, tokens somados corretamente das 4 etapas no total da execution (40 input, 80 output, batendo com 4 × 10/4 × 20 simulados).

## Bug real encontrado

Na primeira rodada, o total de tokens da execution ficava zerado quando o workflow completava (só o caminho de agente único agregava tokens; a última etapa do workflow não somava as linhas de `token_usage` das etapas anteriores). Corrigido: ao fechar a última etapa, soma todas as linhas de `token_usage` daquela execution antes de gravar o total.

## Arquivos criados

`packages/orchestrator/src/workflow-service.ts`, `packages/orchestrator/src/result.ts`, `packages/orchestrator/src/dispatch.ts` (ponto único que `POST /chat` chama, decide entre agente único e workflow), `apps/worker/src/processors/execute-job.ts` reescrito pra encadear etapas.

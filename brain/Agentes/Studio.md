---
tags: [agente, studio, desigual-os]
node_id: NODE_STUDIO_01
machine: gpu_server
gpu: RTX 5090
---

# Studio

Criação multimídia local: imagens, carrosséis, vídeos, reels, upscale. Único agente que roda em PC com GPU, não em Mac Mini.

## Node

`studio-node`, funciona por JOBS assíncronos, não request síncrono. Fluxo: Orchestrator → Redis Queue → Studio Node → GPU Worker → RTX 5090 → asset_url.

## Capabilities declaradas no registro

`image_generation`, `video_generation`, `image_editing`, `upscale`

## Permissões (Tool Gateway)

GPU, Storage, ClickUp, Instagram POST (opcional, com aprovação).

## Timeout de fila

900s (o mais longo, geração de mídia é pesada). Ver [[Fase 09 - Queue e Orchestrator]].

## Heartbeat estendido

Além de cpu/ram/disk, envia `gpu_utilization`, `vram`, `temperature`, `power`, `fan`, `queue_depth`, `active_job`. Estado extra possível: `RENDERING`.

## Asset Management

Tabela `studio_assets`: id, client_id, user_id, project_id, type, filename, storage_url, created_at, agent, prompt, model, metadata. Cada cliente tem Brand Kit (logo, cores, fontes, tom de voz, referências, dimensões) injetado automaticamente no job.

## Pendente

Logo do Studio ainda não recebido (ver [[99 - Pendencias]]).

Implementado na [[Fase 07 - Studio Node e GPU Worker]].

---
tags: [fase, desigual-os]
fase: 17
status: nao-iniciada
---

# Fase 17 - Production Deployment

## Escopo

docker-compose de produção, docs de deploy, guia de instalação do Node Agent em cada máquina (3 Macs + RTX), configuração Tailscale, runbook de operação.

## Definition of Done

Documentação permite subir servidor central e registrar um node novo sem tocar no núcleo.

## Status (2026-09-01): decisões tomadas, execução adiada pra amanhã

Perguntei o essencial pro deploy real e o usuário confirmou:

- **Tailscale**: já configurado, as 4 máquinas (3 Mac Minis de Bento/Jarbas/Suzy + o PC da RTX 5090 do Studio) já estão na mesma tailnet.
- **OpenClaw**: parcial, só algumas das 3 máquinas dos agentes já têm o OpenClaw configurado de verdade. Isso bloqueia parte do teste real do `POST /execute` (Fase 04) até completar nas outras.
- **Onde o Orchestrator roda**: não vai ser nem nesta máquina de dev nem numa das 4 existentes. Vai ser um **VPS separado**, que o usuário já tem contratado e com acesso SSH.
- **Como configurar o VPS**: perguntei se eu entro via SSH e configuro direto ou se escrevo um guia pra ele rodar. Ele preferiu **deixar essa decisão e a execução pra amanhã**. Nada foi feito no servidor ainda, nem a pergunta foi respondida.

## Pra retomar amanhã

1. Perguntar de novo: SSH direto por mim, ou guia escrito?
2. Se for SSH direto: pedir host/usuário/porta (e caminho da chave, se não for a padrão do usuário).
3. Sequência de deploy no VPS: Docker + Redis, clonar/copiar o monorepo (ou só `apps/api` + `apps/worker` + os `packages/*` que eles dependem), `.env` de produção (variáveis já mapeadas em `.env.example`), Tailscale no VPS (entrar na mesma tailnet dos 4 nodes), Nginx + TLS na borda (regra de ouro 3: nada exposto publicamente sem TLS/autenticação).
4. Depois do Orchestrator no ar: instalar `nodes/desigual-node` nos 3 Mac Minis reais (não fakes) e `nodes/studio-node` no PC da RTX, apontando `ORCHESTRATOR_URL` pro VPS.
5. Terminar de configurar OpenClaw nas máquinas que ainda faltam.

## Arquivos relacionados

`.env.example` (já documenta todas as variáveis de produção necessárias), `nodes/desigual-node/.env.example`, `nodes/studio-node/.env.example`.

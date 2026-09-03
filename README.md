# Desigual OS

Sistema operacional de IA da Agência Desigual. Orchestrator central + AI Router + Node Agents rodando em máquinas físicas próprias (3 Mac Minis: Bento, Jarbas, Suzy; 1 PC com RTX 5090: Studio).

## Regras de ouro (invioláveis)

1. Não altere os cérebros dos agentes. Os Obsidian Vaults de Bento, Jarbas e Suzy ficam locais em cada máquina, nunca sincronizados para o servidor central.
2. Não substitua os agentes existentes. OpenClaw e os agentes já existem nas máquinas. O Orchestrator é uma camada de coordenação por cima, não uma reescrita deles.
3. Nenhuma máquina fica exposta publicamente. Toda comunicação passa por rede privada (Tailscale) e autenticação de node.
4. O Orchestrator nunca acessa o filesystem dos Macs diretamente. Ele conversa apenas com o Node Agent instalado em cada máquina, via HTTPS/WebSocket.
5. Toda comunicação entre agentes passa pelo Orchestrator. Agentes nunca conversam diretamente entre si.
6. Chaves de API nunca chegam ao frontend. Segredos vivem no servidor.
7. Toda ação relevante gera `execution_id` e entra em `audit_logs`.
8. O sistema é modular e extensível. Adicionar um quinto agente é registrar node, capabilities, tools e regras, nunca reconstruir o núcleo.

## Stack

Ver `docs/architecture/decisions/` para o histórico de decisões, incluindo o ADR 0001 sobre o uso do Supabase (Postgres, Auth e Storage gerenciados).

- Orchestrator: Node.js + TypeScript, Fastify, WebSocket, BullMQ + Redis, Drizzle ORM sobre Postgres (Supabase), Zod, Pino
- Node Agent: Node.js + TypeScript, Fastify, integração OpenClaw (Macs) e GPU runtime (RTX)
- Frontend: Next.js + React + TypeScript, Tailwind + shadcn/ui, TanStack Query + Zustand
- Auth e Storage: Supabase
- Infra: Docker, Tailscale, Nginx

## Estrutura

```
apps/api        Orchestrator HTTP + WebSocket
apps/worker      Consumidores BullMQ
apps/web         Frontend Next.js
packages/        Bibliotecas compartilhadas (router, orchestrator, database, etc.)
nodes/           Node Agents (desigual-node para Macs, studio-node para RTX)
database/        Migrations e seeds
infrastructure/  Docker, Nginx, Tailscale, monitoramento
docs/            Documentação técnica e ADRs
```

Documentação de arquitetura viva (memória do projeto, atualizada por fase) fica no vault Obsidian em `brain/`, aberto localmente como pasta no app Obsidian.

## Desenvolvimento

```bash
cp .env.example .env   # preencher com as chaves reais, nunca commitar
pnpm install
docker compose up -d   # sobe Redis (Postgres, Auth e Storage são do Supabase)
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

## Plano de execução

O sistema é construído em 17 fases numeradas. Ver `brain/00 - Indice.md` para o mapa completo e o status de cada fase.

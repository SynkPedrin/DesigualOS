# CURRENT_STATE — Estado Atual do Projeto

Data: 16/10/2026 · Branch: `feat/openwa-whatsapp-integration` (HEAD `0193395`).

## 1. O que está no ar (HEAD)

| Item | Local | Estado |
|---|---|---|
| Bento no WhatsApp (gateway completo) | `apps/api/src/bento-whatsapp/*` | merged (commits `31eded8`, `0193395`) |
| Bento — schema próprio | `packages/database/src/schema/bento-whatsapp.ts` | merged |
| Cliente HTTP do OpenWA (fora da Bento) | `packages/tool-gateway/src/openwa-client.ts` | novo nesta sessão |
| Vendor `openwa` no provider resolver | `packages/tool-gateway/src/communication-provider-resolver.ts` | novo nesta sessão |
| Leitura do OpenWA (cliente) | `apps/api/src/openwa-integration/client.ts` | novo nesta sessão |
| Ingestão assíncrona (contatos/chats/histórico) | `apps/api/src/openwa-integration/sync.ts` | novo nesta sessão |
| Rotas internas (`/openwa/state`, `/openwa/sync`) | `apps/api/src/openwa-integration/routes.ts` | novo nesta sessão |
| Registro de rotas | `apps/api/src/server.ts` | novo registro |
| Testes do provider OpenWA | `packages/tool-gateway/src/openwa-client.test.ts` | novo (6 testes) |
| Testes do telefoneDoChat | `apps/api/src/openwa-integration/sync.test.ts` | novo (3 testes) |
| Sincronização da frente Evolution | `apps/api/src/communications/*` | pré-existente, sem alterações |

## 2. O que foi testado e passou

- `pnpm --filter @desigual-os/tool-gateway typecheck` — OK.
- `pnpm --filter @desigual-os/tool-gateway exec vitest run` — OK (26 testes:
  20 preexistentes do provider + 6 novos do OpenWA; nenhum quebrou).
- `pnpm --filter @desigual-os/api typecheck` — OK.
- `pnpm --filter @desigual-os/api exec vitest run src/bento-whatsapp` — OK
  (44 testes do gateway; os 44 já passavam antes do merge).
- `pnpm --filter @desigual-os/api exec vitest run` (suite completa) — OK:
  63 arquivos, 568 testes, 41 pularam por necessidade pré-existente.
- `pnpm --filter @desigual-os/api exec vitest run src/openwa-integration` —
  OK (3 testes novos).

## 3. O que está incompleto / pendente

| Item | Observação | Responsável |
|---|---|---|
| Teste real com OpenWA (conexão, QR, sync) | Sem instância real acessível nesta sessão; o cliente segue o contrato documentado em `OpenWA-main/docs/06-api-specification.md`. | responsável por produção |
| Webhook/socket inbound do OpenWA | O OpenWA empurra eventos via Socket.IO; a fronteira da Inbox hoje consome histórico por GET (sincronização assíncrona). Integrar o consumidor de eventos exigiria conexão contínua e infraestrutura nova. | desigualos-c1 |
| Mídia em `threadMessages.attachmentUrl` | A frente Evolution nunca preenche `attachmentUrl` (coluna existe, não é escrita). O sync do OpenWA também não baixa mídia; o visualizador de imagens/áudios recebe nada hoje. | desigualos-c1 |
| Grupos importados | `contactId` é obrigatório em `conversationThreads`; um grupo tem vários autores, então grupos são ignorados na ingestão. | desigualos-c1 |
| Estado da conexão em tempo real | `GET /openwa/state` consulta o OpenWA sob demanda; não há subscription de eventos de conexão. | desigualos-c1 |
| Painel de conexão do Bento | O commit `0193395` trouxe a UI de vínculo do Bento, mas fica num worktree antigo. Confirmar se a UI referenciada pelas rotas está registrada no `server.ts` desta branch. | responsável |
| Auditoria de sync (`whatsapp.sync`) | Rota `/openwa/sync` registra a ação; métricas/alertas de job agendado ainda não existem. | desigualos-c1 |
| Job agendado | A sincronização é disparada manualmente (`POST /openwa/sync`). Agendamento automático (cron) não foi implementado. | desigualos-c1 |

## 4. Divergências conhecidas (registradas por decisão)

- `OpenWA-main/` é um checkout do projeto inteiro dentro do monorepo. Não é
  código do Desigual OS e não participa do build (excluído do `turbo`).
- O contrato do OpenWA (documentação) diverge do código em pontos
  documentados em `apps/api/src/bento-whatsapp/openwa/contract.ts`:
  `sessionId` no envelope, ausência de `participant` no `message.received`,
  `author` em vez de `participant` em grupos.
- Os containers Supabase locais em execução pertencem a outros trabalhos
  (Aliento); não foram alterados.

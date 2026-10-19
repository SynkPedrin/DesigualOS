# NEXT_TASKS — Próximas Tarefas

Data: 16/10/2026 · Branch: `feat/openwa-whatsapp-integration`.

## Prioridade imediata (desigualos-c1 / backend)

1. **Conexão real com OpenWA.** Subir a instância local (`OpenWA-main`) e
   validar, manualmente: criar sessão, gerar QR, escanear com número de teste,
   `GET /openwa/state` refletindo a sessão conectada. Depois cadastrar o conector
   `vendor: openwa` em `organization_connectors` e disparar
   `POST /openwa/sync`.
2. **Agendamento da sincronização.** Transformar o disparo manual em um job
   periódico (cron) respeitando o limite de 10 mensagens por chat e a política
   de não sobrecarregar o OpenWA.
3. **Mídia em `threadMessages.attachmentUrl`.** Escrever a coluna
   (`attachmentUrl`) quando o sync baixa mídia, e expor o download. Hoje a
   coluna existe mas nunca é preenchida — inclusive na frente Evolution.
4. **Grupos autorizados.** Mapear grupos para conversas do Inbox exigiria
   migração do modelo de `conversationThreads` (contato único). Escolher até
   que ponto: ignorar (decisão atual) ou um modelo dedicado.
5. **Indicadores de conexão em tempo real.** `GET /openwa/state` já consulta o
   OpenWA; faltam subscription de eventos (`session.status`, etc.).
6. **Handoff humano ↔ IA visível na interface.** O status `waiting_agency`
   existe, mas não há flag explícita de "atendimento humano em andamento".
   Adicionar estado e a ação correspondente.

## Médio prazo

7. **Testes de equivalência Web/WhatsApp para a frente OpenWA.** O suíte de
   Bento (`equivalencia.test.ts`) cobre a frente do Bento. Estender para a
   frente da Inbox: mesma pergunta via web e via WhatsApp, mesmo Brain, mesmas
   permissões.
8. **Reconciliação de eventos perdidos.** A fronteira atual sincroniza por GET
   periódico; a reconciliação é perda de eventos que chegam entre dois polls.
   Otimizar o intervalo e registrar a janela coberta.
9. **Documentação de produção.** Rodapé operacional: rollback do conector,
   política de exclusão de vínculos, limites de retenção de mensagens
   importadas.

## Longo prazo / decisões com o responsável

10. **Trocar `evolution` por `openwa` como fornecedor padrão.** A produção
    hoje usa Evolution (decisão registrada em
    `evolution-client.ts`). Trocar exige teste de equivalência com os
    clientes existentes e aprovação de `desigualos-c1`.
11. **Migrar a interface de vínculo do Bento.** O commit `0193395` traz a UI
    de vínculo feita em um worktree antigo; verificar se está registrada no
    `server.ts` desta branch e unificar.
12. **Painel administrativo do Bento no WhatsApp.** Status da sessão, QR code,
    revogação de vínculos, métricas de throughput — listado no plano
    original, mas depende da sessão de produção.

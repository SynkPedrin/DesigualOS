# INBOX_ARCHITECTURE — A Frente do Inbox

Este documento descreve o modelo de dados e as rotas da frente de atendimento,
e onde a integração OpenWA se encaixa. Leia também
`docs/WHATSAPP_INTEGRATION.md` para a parte do fornecedor.

## 1. Modelo de dados (contrato existente)

As tabelas vivem em `packages/database/src/schema/communications.ts`:

| Tabela | Papel |
|---|---|
| `contacts` | Contato externo (telefone + nome) importado ou cadastrado. |
| `conversationThreads` | Thread de atendimento: um contato, um canal (`whatsapp`), status e dono. |
| `threadMessages` | Mensagem dentro da thread: direção, remetente, conteúdo, idempotência externa, entrega. |
| `organizationConnectors` | Conectores por organização (fornecedor + credenciais). |

Regras já travadas por testes:

- `threadMessages` é única por `(channel, externalMessageId)`: webhook ou sync
  nunca duplica a mesma mensagem.
- A direção `inbound`/`outbound` distingue quem chegou e quem enviou.
- `listThreads` não expõe conversas de outro colaborador/organização.
- A thread exige um único `contactId`: um grupo com vários autores não cabe
  (decisão registrada em `docs/CURRENT_STATE.md`).

## 2. Rotas (contrato já existente)

Todas sob `/inbox`, autenticadas por sessão:

- `GET /inbox/threads` — lista com filtro de status/assignee/paginação.
- `GET /inbox/threads/:id` — detalhe.
- `GET /inbox/threads/:id/messages` — histórico paginado.
- `POST /inbox/threads/:id/messages` — envio (direto pelo Inbox; entrega pela
  frente de WhatsApp escolhida pelo conector).
- `PATCH /inbox/threads/:id/assign` — atribuir thread.
- `POST /webhooks/whatsapp` — webhook público da frente Evolution (assinatura
  validada; fora do hook de auth).

A tela de Inbox (`apps/web/src/app/(shell)/inbox/`) já renderiza threads com
`channel === 'whatsapp'`, indicadores de não lidas, atribuição e envio sem
reload. Não foi alterada nesta fase.

## 3. Integração com o OpenWA

A integração entra por **leitura** (`openwa-integration/`) e **envio**
(`CommunicationProvider` com vendor `openwa`):

| Precisa | Como |
|---|---|
| Enviar mensagem pelo Inbox | Já existente — `POST /inbox/threads/:id/messages` resolve o provider. |
| Enviar mídia pelo Inbox | Mesma rota; o provider OpenWA suporta imagem/áudio/documento. |
| Receber mensagens do OpenWA | Sincronização assíncrona (job disparável) → `threadMessages`. |
| Contatos/chats/histórico | `GET /openwa/sync` dispara a ingestão; `GET /openwa/state` mostra o estado. |

A ingestão grava nos modelos acima, então a interface não precisa saber qual
fornecedor entregou a mensagem. Ver
`docs/WHATSAPP_INTEGRATION.md` §3.

## 4. Atendimento humano × Bento

O modelo de estado já existe (`waiting_client`, `waiting_agency`, `open`,
`archived`):

- `waiting_agency`: o Bento aguarda resposta do colaborador humano —
  normalmente porque uma ação de escrita precisa de confirmação.
- `waiting_client`: o colaborador humano precisa responder a uma pergunta.
- A atribuição (`assign`) define quem está atendendo.
- Não existe ainda flag explícita de "atendimento humano em andamento":
  o atendente assume a thread atribuída. Adicionar o estado
  `human_serving` é tarefa registrada em `docs/NEXT_TASKS.md`.

## 5. Riscos e limitações conhecidas

- **Mídia não é gravada**: a coluna `attachmentUrl` de `threadMessages` nunca
  é preenchida (nem pela frente Evolution, nem pelo sync do OpenWA). Áudios e
  imagens recebidos ficam invisíveis na interface.
- **Grupos são ignorados na ingestão** (modelo exige contato único).
- **Histórico limitado**: só os últimos 10 mensagens por conversa são
  importados.
- **Sem subscription de eventos**: a entrada atual é por sincronização assíncrona;
  eventos em tempo real do OpenWA só são consumidos pela frente do Bento
  (`bento-whatsapp`).
- **Sem agendamento automático**: `POST /openwa/sync` é disparado manualmente.

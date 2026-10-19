# WHATSAPP_INTEGRATION — Bento no WhatsApp e OpenWA

Este documento descreve a integração de WhatsApp em duas frentes que coexistem
na mesma plataforma, sempre reutilizando o Brain existente — nunca um segundo
agente.

- **Frente 1 — Bento no WhatsApp** (`apps/api/src/bento-whatsapp/`): o próprio
  agente Bento responde por WhatsApp.
- **Frente 2 — OpenWA + Inbox** (`apps/api/src/openwa-integration/`): a infraestrutura
  OpenWA conecta números corporativos, e a Inbox os consome.

## 1. Arquitegura

```
WHATSAPP BUSINESS
       |
       V
OPENWA            (OpenWA-main/, checkout local)
       |
       V
┌──────────────────────────────────────────────┐
│ BENTO WHATSAPP GATEWAY   (bento-whatsapp)   │  Frente 1 — Bento responde
│   - identidade por código                  │
│   - autorização por usuário               │
│   - turno compartilhado com a web        │
└──────────────────────────────────────────────┘
       |
       V
┌──────────────────────────────────────────────┐
│ OPENWA INTEGRATION   (openwa-integration)  │  Frente 2 — Inbox consome
│   - leitura: chats/contatos/histórico     │
│   - ingestão assíncrona                 │
│   - envio já resolvido pelo resolver de   │
│     CommunicationProvider               │
└──────────────────────────────────────────────┘
       |
       V
IDENTITY RESOLVER → AUTHORIZATION → BRAIN EXISTENTE
```

O gateway não contém inteligência. Ele apenas decide "quem chega", "o que é
solicitado" (texto cru) e "para onde entregar". Toda interpretação, consulta a
ferramentas e escrita operacional acontecem no Brain, exatamente como na
interface web.

## 2. Frente 1 — Bento no WhatsApp

Fluxo por mensagem recebida:

1. O OpenWA empurra o evento (webhook/Socket.IO) para o backend.
2. `bento-whatsapp/inbound.ts` valida o evento e deduplica por identificador.
3. `bento-whatsapp/identity.ts` extrai o telefone do remetente e resolve o
   vínculo (código de uso único enviado pelo número).
4. `bento-whatsapp/store.ts` associa o número ao colaborador interno, com
   confirmação autenticada na web.
5. `bento-whatsapp/gateway.ts` carrega o turno com a identidade do
   colaborador (usuário, organização, permissões) e executa o Brain existente.
6. A resposta é formatada naturalmente (`format.ts`) e entregue pelo OpenWA.
7. Mensagens repetidas ou enviadas pelo próprio Bento são ignoradas; todo envio
   carrega `Idempotency-Key`.

Pontos de segurança já implementados: identidade derivada somente do número
vincular (nunca de `pushName`/foto), permissões do colaborador aplicadas pelo
backend, auditoria de ações, isolamento por conversa e por organização.

## 3. Frente 2 — OpenWA e a Inbox

### 3.1 Provider

O `CommunicationProvider` (contrato de `tool-gateway`) é resolvido por
conector organizacional. O vendor `openwa` entra como terceiro ramo além de
`evolution` e `wapi`:

- credenciais: `baseUrl`, `apiKey`, `sessionId` (UUID da sessão da organização);
- métodos: `sendText`, `sendImage`, `sendAudio`, `sendDocument`, `health`.

O envio já está plugado em `POST /inbox/threads/:id/messages` — a rota do
Inbox que entrega a resposta humana. Nenhuma outra rota precisa mudar.

### 3.2 Leitura e ingestão

```
GET /api/sessions/:sessionId/chats      → lista de conversas
GET /api/sessions/:sessionId/contacts  → lista de contatos
GET /api/sessions/:sessionId/messages  → histórico (últimos N por chat)
```

A fronteira `openwa-integration` expõe, internamente:

- `GET /openwa/state` — conexão configurada e estado da sessão
  (com `sessionId`, status, número, pushName). Não expõe a API key.
- `POST /openwa/sync` — dispara a ingestão (assíncrona):
  1. lista contatos e importa/cria os que ainda não existem;
  2. lista chats e processa o histórico dos últimos 10 mensagens de cada chat;
  3. grava em `threadMessages`, `conversationThreads` e `contacts` — os mesmos
     modelos usados pelo webhook da Evolution API. Idenpotência por
     `(channel, externalMessageId)`;
  4. falhas por chat viram apontamento no resumo, sem abortar o resto.

Grupos são retornados pelo OpenWA mas ignorados na importação (o modelo
exige contato único). Status/broadcast são ignorados por padrão.

### 3.3 Estado e reconexão

`GET /openwa/state` consulta o OpenWA sob demanda. Não há subscription de
eventos de conexão (fora do escopo desta fase). A interface web já mostra
`CREATING_SESSION`/`WAITING_QR`/`CONNECTED` conforme disponível e trata
desconexão informando o problema — a UI existente cobre o estado mínimo.

## 4. Identidade e autorização

- No Bento: o vínculo é por código de uso único, enviado pelo próprio número e
  confirmado na sessão web autenticada. Ver
  `bento-whatsapp/identity.ts` e `bento-whatsapp/store.ts`.
- Nas permissões: o turno recebe o usuário/organização do solicitante. Tudo o
  que a interface web permite consultar ou escrever, o WhatsApp também
  permite — nunca um superusuário compartilhado.
- No Inbox: `/inbox/threads` usa as permissões de `communications`; apenas
  colaboradores autorizados veem conversas de outros.
- O backend é sempre a autoridade; nada do frontend confia em `userId` ou
  `organizationId` enviado pela própria chamada.

## 5. Segurança

- API key do OpenWA nunca sai do backend (não é enviado ao frontend).
- Webhook/Socket.IO do OpenWA é validado quando chega (assinatura, quando
  configurada) — usado no gateway do Bento (`openwa/signature.ts`).
- Downloads e uploads respeitam permissão por conversa.
- Mensagens recebidas do WhatsApp são entradas não confiáveis: instruções nelas
  nunca sobrescrevem políticas de segurança nem concedem permissões.
- Rate limiting e idempotência existentes no Fastify continuam aplicados.

## 6. Testes

| Teste | Onde | Status |
|---|---|---|
| Cliente OpenWA (envio, headers, erros) | `packages/tool-gateway/src/openwa-client.test.ts` | TESTADO COM MOCK — executado |
| Envio pelo provider `openwa` (resolver) | `packages/tool-gateway/src/communication-provider.test.ts` | TESTADO COM MOCK — executado |
| Gateway do Bento (recepção, identidade, idempotência) | `apps/api/src/bento-whatsapp/gateway.test.ts` | TESTADO COM MOCK — executado |
| Equivalência Web ↔ WhatsApp (Brain) | `apps/api/src/bento-whatsapp/equivalencia.test.ts` | TESTADO COM MOCK — executado |
| Sincronização OpenWA (mapeamento, contatos, histórico) | `apps/api/src/openwa-integration/sync.test.ts` | TESTADO COM MOCK — executado |
| Envio por `POST /inbox/threads/:id/messages` com OpenWA | suíte de `communications` | TESTADO COM MOCK — executado |
| Prova real com OpenWA (sessão, QR, sync) | — | NÃO VERIFICADO — sem instância acessível nesta sessão |

## 7. Ativação (resumo)

- Em homologação: conector `vendor: openwa` cadastrado (com API key e
  `sessionId` testados), `GET /openwa/state` OK, `POST /openwa/sync` OK, Inbox
  mostra conversas importadas.
- Em produção: exige aprovação de `desigualos-c1`; a sessão real só é
  conectada por pessoa com acesso ao WhatsApp Business do número.

## 8. Deploy (desigual-os.vercel.app)

Checklist para o deploy do frontend em `https://desigual-os.vercel.app/` com a
frente OpenWA funcionando (QR de conexão):

1. **Web (Vercel):** as variáveis `NEXT_PUBLIC_API_MODE` e `NEXT_PUBLIC_API_URL`
   precisam estar no projeto Vercel com valores live:

   ```
   NEXT_PUBLIC_API_MODE=live
   NEXT_PUBLIC_API_URL=https://api.citavel.ai
   ```

   Sem `NEXT_PUBLIC_API_MODE=live`, o deploy inteiro roda em modo mock —
   `src/mocks/handlers.ts` — e o fluxo de QR nunca chega ao backend real.

2. **API (VPS):** no `.env` de produção (`docker compose -f docker-compose.prod.yml
   --env-file .env up -d --build`):
   - `WHATSAPP_OPENWA_ENABLED=true`
   - `WHATSAPP_OPENWA_ADMIN_ONLY=true` (homologação: só master)
   - `OPENWA_BASE_URL=http://openwa:2785` — a API roda em container; de dentro
     dele `127.0.0.1` é o próprio container da API, não o OpenWA.
   - `OPENWA_ADMIN_API_KEY=<chave admin do OpenWA>`
   - `OPENWA_WEBHOOK_URL=http://api:3001/openwa/webhook` — rede interna do
     compose; `api` já está em `SSRF_ALLOWED_HOSTS` do OpenWA. A URL pública
     também funciona, mas depende do VPS conseguir chamar o próprio IP.
   - `API_PUBLIC_URL=https://api.citavel.ai`
   - `BENTO_WHATSAPP_ENABLED=true`

3. **OpenWA:** container `openwa-api` no ar (health OK em `:2785`), com sessões
   criadas pelo backend via `POST /api/sessions` + chave scoped + webhook.

4. **QR:** com a API e o OpenWA no ar, `POST /openwa/sessions` cria a sessão,
   `start` → `qr_ready`, `GET /openwa/sessions/:id/qr` devolve o PNG; a tela de
   Integrações renderiza o `<img>` com o data URL.

5. **Fluxo manual pós-deploy:** escanear o QR com o celular do operador.

6. **O que acontece depois do QR (19/10/2026):** a tela acompanha o status;
   quando a sessão fica `ready` (pelo webhook ou pela própria consulta da
   tela/listagem, o que chegar primeiro) um job entra na fila
   `queue-whatsapp` do worker. Ordem do job: conversas (mais recentes
   primeiro, 4 em paralelo, últimas 10 mensagens de cada) → fotos de perfil
   (lote de 50; o whatsapp-web.js não manda foto na agenda) → agenda (só
   contatos salvos ou com nome). As conversas aparecem na Inbox enquanto o
   resto chega.

7. **Isolamento:** conversa de uma sessão OpenWA só aparece na Inbox do dono
   da sessão — nem master vê o WhatsApp do colega. Conversas sem sessão
   (Evolution/W-API, da empresa) continuam visíveis para a equipe.


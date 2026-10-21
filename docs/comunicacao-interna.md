# Comunicação interna

Conversa da equipe dentro do DesigualOS: um **#Geral** por organização e
**conversas privadas** entre colaboradores, com arquivos, menções, reações e
tempo real. Não é a Inbox. A Inbox é cliente no WhatsApp; aqui é colega com
colega. Os dois módulos não compartilham tabela, rota nem tela.

## Onde está cada parte

| Parte | Arquivo |
|---|---|
| Tabelas | `packages/database/src/schema/internal-chat.ts`, migrações `0077_comunicacao_interna.sql` e `0078_comunicacao_hub.sql` |
| Regras de acesso, mensagens, paginação | `apps/api/src/internal-chat/service.ts` |
| Rotas HTTP, eventos ao vivo, notificações | `apps/api/src/internal-chat/routes.ts` |
| Arquivos (validação, disco, download) | `apps/api/src/internal-chat/arquivos.ts` |
| Online/ausente | `apps/api/src/internal-chat/presenca.ts` (Redis, 90 s) |
| Itens compartilhados (tarefa, cliente, quinzena, mídia, relatório, alerta) | `apps/api/src/internal-chat/objetos.ts` |
| Criar tarefa no ClickUp a partir de mensagem | `apps/api/src/internal-chat/tarefas.ts` |
| Pedido ao Jarbas/Bento | `apps/api/src/internal-chat/assistente.ts` |
| Entrega ao vivo | `chat.event` em `apps/api/src/ws/routes.ts`, entregue só a `recipient_ids` |
| Tela | `apps/web/src/app/(shell)/comunicacao/page.tsx`, `apps/web/src/components/comunicacao/` |
| Dados da tela e eventos | `apps/web/src/hooks/use-internal-chat.ts` |

## Communication Hub 2.0 (21/10/2026)

| Tipo de conversa | Quem lê | Observação |
|---|---|---|
| `general` (#Geral) | membro ativo da organização | um por organização |
| `channel` público | membro ativo da organização | entra ao abrir ou escrever; nome único |
| `channel` privado | só convidados | some de "procurar canais" |
| `group` | só participantes | 3 a 50 pessoas; para mais, use canal |
| `direct` | as duas pessoas | uma por par |
| `discussion` | quem pode ver o objeto (cliente, quinzena) **nesta** organização | uma por objeto; conferido a cada acesso |

- **Thread** (`thread_root_id`): a resposta não entra na linha principal nem
  conta como não lida. Avisa quem participa da thread e quem escreveu a
  original.
- **Fixar** (até 50 por conversa) e **salvar** (por pessoa). A mensagem salva
  some da lista quando a pessoa perde acesso à conversa.
- **Menções, busca e biblioteca de arquivos** aplicam a regra de leitura dentro
  da consulta, não num filtro depois.
- **Não perturbe** (`internal_chat_preferences.dnd_until`): nenhuma
  notificação da Comunicação até a hora escolhida. Silenciar uma conversa cala
  o recado comum; menção, resposta e thread chegam mesmo assim.
- **Itens compartilhados** (`internal_message_objects`): a mensagem guarda o
  ponteiro e um resumo do momento do envio. Compartilhar **não** dá acesso:
  - o resumo só aparece para quem pode ver o item;
  - o evento ao vivo vai sem resumo, e cada leitor busca
    `GET /internal-chat/objects/:id` com a própria permissão.
  - Mídia exige o módulo `meta_ads`, Relatórios o `relatorios`, Quinzenas o
    `demandas`.
- **Criar tarefa**: idempotente por `(pessoa, idempotency_key)`. O card só entra
  depois que o ClickUp devolveu o id, e uma falha nunca mostra "criada".
  - Escreve na lista do cliente com `authorizedForProduction`, porque é uma
    pessoa que confirmou o formulário (como no Pipeline).
  - A cerca `CLICKUP_TEST_LIST_ID` continua valendo para a escrita autônoma do
    Bento.
- **Agentes**: não existe agente novo. "Analisar com Jarbas" (mídia) e
  "Resumir com Bento" (tarefa, conversa, thread) viram um turno na conversa de
  agente **da própria pessoa**, e a resposta não volta para o canal.
  - O conteúdo de colegas vai cercado como DADO, nunca como instrução: é a
    proteção contra prompt injection.
  - Agente nenhum lê conversa sem alguém ter pedido. Alicia é pessoa, não
    agente.
- **Formatação**: `**negrito**`, `_itálico_`, `~~riscado~~`, `` `código` ``,
  bloco com três crases e listas com `- ` ou `1. `. Tudo é renderizado como
  texto, sem HTML.

## Regras que o servidor garante

- **Quem lê o quê.** O #Geral é lido por quem tem vínculo ativo na
  organização. Uma privada é lida só pelas duas pessoas. Qualquer outro caso
  responde **404**, nunca 403, para não confirmar que a conversa existe. Vale
  para mensagens, arquivos, reações, leitura e digitação.
- **Organização.** Toda consulta filtra pela organização do pedido. Pessoa de
  outra empresa não enxerga nem o #Geral alheio.
- **Admin e agentes de IA não leem conversas privadas.** Nenhum papel abre
  privada de terceiros, e a Comunicação não alimenta memória nem contexto de
  agente.
- **Envio idempotente.** Cada envio leva um `clientMessageId`. Repetir o mesmo
  envio (rede caiu, "tentar de novo") devolve a mesma mensagem com HTTP 200,
  sem duplicar. Mensagem nova devolve 201.
- **Editar e apagar** só a própria mensagem. Apagar é lógico (a mensagem vira
  "Mensagem apagada" para todos) e remove do disco os arquivos anexados. Fica
  registrado na auditoria (`internal_chat.message_deleted`).

## Arquivos

Aceitos: PNG, JPG/JPEG, WEBP, GIF, PDF, DOC/DOCX, XLS/XLSX, CSV, PPT/PPTX, TXT,
MP4, MOV, WEBM e ZIP. Cada arquivo passa por três checagens: extensão, tipo
declarado e **assinatura real** (os primeiros bytes). Um executável renomeado
para `.pdf` é recusado.

- Ficam em disco **privado** (`INTERNAL_CHAT_FILES_DIR`). Em produção é o
  volume Docker `internal_chat_files`, montado na API em
  `/data/internal-chat-files`.
- Não existe URL pública. O download passa por
  `GET /internal-chat/attachments/:id` com login, e a mesma checagem de acesso
  da conversa.
- Só imagem, vídeo e PDF abrem dentro do navegador. Esses vão com
  `X-Content-Type-Options: nosniff` e `Content-Security-Policy: sandbox`. O
  resto sempre baixa.
- Vídeo aceita `Range`, então dá para avançar sem baixar o arquivo inteiro.
- O tamanho é checado **enquanto o arquivo chega**, não depois. Um arquivo
  grande demais é cortado no limite e não chega a ocupar o disco.

| Variável | Padrão | O que faz |
|---|---|---|
| `INTERNAL_CHAT_FILES_DIR` | `~/.desigualos/internal-chat-files` | Pasta dos arquivos |
| `INTERNAL_CHAT_MAX_IMAGE_MB` | 25 | Limite por imagem |
| `INTERNAL_CHAT_MAX_DOCUMENT_MB` | 50 | Limite por documento |
| `INTERNAL_CHAT_MAX_ARCHIVE_MB` | 25 | Limite por ZIP |
| `INTERNAL_CHAT_MAX_VIDEO_MB` | 100 (produção: 250) | Limite por vídeo |
| `INTERNAL_CHAT_ORG_QUOTA_MB` | 20480 | Espaço total por organização |
| `INTERNAL_CHAT_ALLOWED_EXTENSIONS` | todas acima | Restringe a lista, separada por vírgula |

Em produção o vídeo vai até **250 MB** (20/10/2026): o `docker-compose.prod.yml`
define `INTERNAL_CHAT_MAX_VIDEO_MB=250` e o nginx da API
(`/etc/nginx/sites-available/desigual-os-api` na VPS) aceita
`client_max_body_size 260m`. A rota de upload já usa o maior limite da tabela,
e não o limite global de 25 MB do multipart. Para subir mais, os dois números
sobem juntos. Se subir só a variável, o nginx corta antes com 413.

Arquivo grande ocupa disco na VPS, que é dividida com outros serviços. Em
20/10/2026 o disco estava em 93% por causa de 78 GB de cache de build do
Docker. A limpeza segura é `docker builder prune -f --keep-storage 15GB`, que
só apaga cache e não mexe em contêiner nenhum.

## Tempo real

Mensagem nova, edição, reação, remoção, leitura e "digitando" saem como
`chat.event` pelo WebSocket que já existia. O servidor de WebSocket entrega o
evento **só** a quem está em `recipient_ids`. Quando o socket cai e volta, a
tela busca tudo de novo, porque o servidor não reenvia evento perdido. O
polling de 60 s fica de rede de segurança.

A notificação no sino (`chat.direct`, `chat.mention`, `chat.reply`) não é
criada para quem leu a conversa nos últimos 20 s, porque essa pessoa está
olhando para ela. Conversa silenciada não notifica mensagem comum, mas ainda
notifica menção e resposta direta.

## Módulo

`comunicacao` está em `MODULOS_DE_TODOS`. Ou seja, vem ligado para todo
colaborador, e o editor de workspace mostra o módulo travado, porque conversar
com a equipe não depende de cargo. Para desligar, é preciso mudar o código
(passo 1 de "Como desfazer").

## Testes

- **Servidor contra Postgres real** (11 testes: acesso, isolamento entre
  empresas, IDOR, idempotência, paginação, arquivos):
  `TENANT_TEST_DATABASE_URL=postgres://… pnpm --filter @desigual-os/api exec vitest run src/internal-chat`
- **Tela** (eventos ao vivo, contador, sem duplicar):
  `pnpm --filter @desigual-os/web exec vitest run src/hooks/use-internal-chat.test.ts`
- **No navegador**: `apps/web/tests/e2e/comunicacao.spec.ts` (duas pessoas) e
  `comunicacao-hub.spec.ts` (quatro: Ana, Bruno e Dani na mesma empresa, Caio
  em outra). Use o build de produção (`next build` + `next start`), porque o
  servidor de desenvolvimento é lento demais com a máquina carregada.
  Roda contra uma pilha **local**, nunca contra produção:
  1. Postgres descartável com as migrações e o `db:seed`, mais três usuários
     (`ana@e2e.test` e `bruno@e2e.test` na mesma organização, `caio@e2e.test`
     em outra).
  2. Um Supabase Auth falso que assina JWT ES256 e serve
     `/auth/v1/token`, `/auth/v1/user` e o JWKS.
  3. API com `SUPABASE_URL` apontando para ele, e web em modo live.
  4. `E2E_COMUNICACAO=1 E2E_BASE_URL=http://localhost:<porta-web> pnpm exec playwright test tests/e2e/comunicacao.spec.ts --project=chromium`

  Atenção: a `.env` da raiz pode ser um symlink para a `.env` de produção.
  Antes de subir a API local, troque por uma `.env` só com valores locais, e
  depois devolva o symlink.

## Como desfazer

O módulo é aditivo: não altera nenhuma tabela nem rota que já existia.

1. **Esconder sem apagar nada:** tire `'comunicacao'` de `MODULOS_DE_TODOS` e
   de `WORKSPACE_MODULES` em `packages/types/src/workspace.ts` e publique API e
   web. O item some e a API responde 403. Mensagens e arquivos continuam
   guardados.
2. **Voltar o código:** reverta o merge da branch `feat/communication-hub`
   (Hub 2.0) e, se for o caso, o de `feat/comunicacao-interna`.
   As tabelas podem ficar, porque nada mais as lê.
3. **Apagar os dados** (irreversível; exige decisão explícita): remova as
   tabelas `internal_message_reactions`, `internal_message_attachments`,
   `internal_messages`, `internal_conversation_members` e
   `internal_conversations`, nessa ordem, mais o volume `internal_chat_files`.
   As tabelas do Hub (`internal_message_objects`, `internal_saved_messages`,
   `internal_chat_preferences`, `internal_task_creations`) saem antes de
   `internal_messages`.

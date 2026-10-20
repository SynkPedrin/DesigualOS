# Comunicação interna

Conversa da equipe dentro do DesigualOS: um **#Geral** por organização e
**conversas privadas** entre colaboradores, com arquivos, menções, reações e
tempo real. Não é a Inbox. A Inbox é cliente no WhatsApp; aqui é colega com
colega. Os dois módulos não compartilham tabela, rota nem tela.

## Onde está cada parte

| Parte | Arquivo |
|---|---|
| Tabelas | `packages/database/src/schema/internal-chat.ts`, migração `0077_comunicacao_interna.sql` |
| Regras de acesso, mensagens, paginação | `apps/api/src/internal-chat/service.ts` |
| Rotas HTTP, eventos ao vivo, notificações | `apps/api/src/internal-chat/routes.ts` |
| Arquivos (validação, disco, download) | `apps/api/src/internal-chat/arquivos.ts` |
| Online | `apps/api/src/internal-chat/presenca.ts` (Redis, 90 s) |
| Entrega ao vivo | `chat.event` em `apps/api/src/ws/routes.ts`, entregue só a `recipient_ids` |
| Tela | `apps/web/src/app/(shell)/comunicacao/page.tsx`, `apps/web/src/components/comunicacao/` |
| Dados da tela e eventos | `apps/web/src/hooks/use-internal-chat.ts` |

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
MP4, MOV e ZIP. Cada arquivo passa por três checagens: extensão, tipo
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
| `INTERNAL_CHAT_MAX_DOCUMENT_MB` | 25 | Limite por documento |
| `INTERNAL_CHAT_MAX_ARCHIVE_MB` | 25 | Limite por ZIP |
| `INTERNAL_CHAT_MAX_VIDEO_MB` | 100 | Limite por vídeo |
| `INTERNAL_CHAT_ORG_QUOTA_MB` | 20480 | Espaço total por organização |
| `INTERNAL_CHAT_ALLOWED_EXTENSIONS` | todas acima | Restringe a lista, separada por vírgula |

O vídeo começa em 100 MB porque o nginx da API aceita até 110 MB por
requisição. A rota de upload já usa o maior limite da tabela, e não o limite
global de 25 MB do multipart. Para subir o vídeo, aumente o
`client_max_body_size` do nginx na VPS **junto** com
`INTERNAL_CHAT_MAX_VIDEO_MB`. Se subir só a variável, o nginx corta antes com
413. Conferido em 20/10/2026: 60 MB passam inteiros; 101 MB voltam 413 em
menos de 0,1 s, sem sobra no disco.

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
- **Duas pessoas no navegador** (`apps/web/tests/e2e/comunicacao.spec.ts`).
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
2. **Voltar o código:** reverta o merge da branch `feat/comunicacao-interna`.
   As tabelas podem ficar, porque nada mais as lê.
3. **Apagar os dados** (irreversível; exige decisão explícita): remova as
   tabelas `internal_message_reactions`, `internal_message_attachments`,
   `internal_messages`, `internal_conversation_members` e
   `internal_conversations`, nessa ordem, mais o volume `internal_chat_files`.

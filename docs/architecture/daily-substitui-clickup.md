# Daily Tasks no lugar do ClickUp

Decisão de 28/10/2026: o Daily Tasks passa a ser a tela de tarefas da operação (a tela "Tarefas", espelho do ClickUp,
foi retirada e `/tasks` redireciona para `/daily-tasks`). Enquanto o ClickUp existir, os dois lados mostram a mesma
coisa. No dia de desligar o ClickUp, a operação já está no Daily.

## O que existe

| Peça | Onde | O que faz |
|---|---|---|
| Carga inicial | `packages/work-engine/src/clickup-import.ts` | Importa espaços, status, listas, campos, tarefas, responsáveis, checklists, comentários, anexos e tempo de um snapshot. Idempotente, vincula por `work_external_mappings`. |
| **Entrada** (ClickUp → Daily) | `apps/api/src/clickup/sincronia-daily.ts` | Webhook (qualquer evento `task*`) + varredura a cada 60 s. Relê a tarefa e aplica pelo MESMO importador, em modo `aoVivo`. |
| **Saída** (Daily → ClickUp) | `apps/api/src/clickup/escrita-daily.ts` | Lê a trilha `work_activity_events` com cursor durável e empurra para o ClickUp. |
| Aviso ao vivo | evento WS `work.mudou` | Quando a entrada aplica algo, as telas abertas do Daily se refazem. Só o aviso, sem dado. |
| Diagnóstico | `GET /work/admin/clickup-sync`, `POST .../varrer`, `POST .../tarefa`, `POST .../empurrar` | Só administrador da plataforma. |

Nenhuma migração: o cursor da saída é uma linha de `work_external_mappings` (tipo `cursor`).

## Entrada: o que fica igual

Modo `aoVivo` do importador: o que o ClickUp tirou, sai do Daily também (responsável removido, item de checklist
desmarcado ou apagado, dependência desfeita, comentário apagado). Tarefa apagada no ClickUp é **arquivada** no Daily,
nunca apagada. Subtarefa traz o pai antes. Lista que não pertence a nenhuma empresa daqui é ignorada.

Só LÊ o ClickUp. Cache de 10 min para espaço, lista, campos e membros: cada tarefa custa 2 chamadas.

## Saída: o que vai e o que não vai

Vai: criar tarefa (em lista que veio do ClickUp), título, descrição (markdown), status (pelo nome), prioridade, prazo
(como "só dia"), início, estimativa, etiquetas, responsáveis (por e-mail igual) e comentários novos.

Não vai, de propósito: apagar, arquivar e mover (nada destrutivo sai daqui); anexos e campos personalizados (sem
escrita simples ainda); tarefa de lista que só existe no Daily (fica só aqui).

Comentário sai com a conta do sistema e o nome de quem escreveu na frente ("Ana: texto"). No Daily ele continua com
o texto original (o vínculo marca `origem: daily`).

## Por que os dois lados juntos

Sincronia só de entrada perde edição: alguém marca "pronto" no Daily, outra pessoa comenta no ClickUp, a leitura
seguinte devolve o status antigo. Por isso, **a leitura espera** (`SincroniaAdiada`) enquanto houver evento do Daily
daquela tarefa ainda não enviado, e só então aplica.

## Falhas

- Passageira (rede, 5xx, 429): a saída PARA e retoma do mesmo evento no ciclo seguinte. Nada se perde.
- Definitiva (4xx, cerca de teste): registrada e pulada, para um evento ruim não trancar os seguintes.
- Os freios de sempre valem: `BENTO_WRITE_ENABLED=false` desliga toda escrita no ClickUp; `CLICKUP_WRITE_SCOPE_LIST_ID`
  restringe a uma lista de teste. A saída não pede `authorizedForProduction`.

## Como ligar (tudo desligado por padrão)

| Variável | Efeito |
|---|---|
| `DAILY_SYNC_CLICKUP=on` | liga a entrada (webhook + varredura) |
| `DAILY_SYNC_CLICKUP_ESCRITA=on` | liga a saída |

Ordem recomendada:

1. **Webhook**: confirmar que o webhook do ClickUp assina eventos de tarefa (não só `taskCommentPosted`). A varredura
   cobre o que faltar, com até 60 s de atraso.
2. **Ensaio na lista de teste**: `CLICKUP_WRITE_SCOPE_LIST_ID=<lista de QA>` + as duas flags. A saída só escreve lá.
3. Conferir `GET /work/admin/clickup-sync` e uma tarefa de ponta a ponta nos dois sentidos.
4. Tirar a cerca. Abrir para a operação.

## Estado em produção

**Ligada nos dois sentidos desde 28/10/2026 ~12:05** (`DAILY_SYNC_CLICKUP=on` e `DAILY_SYNC_CLICKUP_ESCRITA=on` no `.env` da
VPS; cópia anterior em `.env.bak-pre-daily-sync-20261028`). Sem cerca de lista de teste: a saída escreve no ClickUp real.
API `c131b28` (imagem fina; rollback `desigual-os-api:rollback-ec25938`), front `ad55b7f`. Desligar: remover as duas linhas
e `docker compose -f docker-compose.prod.yml --env-file .env up -d --no-deps --no-build api` — NA VPS, nunca no `.env` do
Mac (no Mac a API local passaria a escrever no ClickUp de produção).

## Dia de desligar o ClickUp (ainda não feito)

- O Pipeline e a ficha do cliente hoje leem o ClickUp direto; passam a ler o Daily.
- O Pipeline hoje escreve o status no ClickUp ao mover o cartão (e o Daily recebe pela entrada). Sem ClickUp, escreve no Daily.
- As rotas `/clickup/*` que alimentam Hoje, Gestão da equipe e os agentes passam a consultar o Daily.
- Anexos e campos personalizados: escrita de volta, se ainda fizer sentido até lá.

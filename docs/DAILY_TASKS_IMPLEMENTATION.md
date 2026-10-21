# Daily Tasks — implementação (checkpoint técnico)

> Documento de CONTINUIDADE. Quem retomar a missão lê isto primeiro, depois `git log feat/daily-tasks`.
> Atualizado a cada incremento. Não substitui o código nem os testes.

- **Branch:** `feat/daily-tasks` (worktree em `../DesigualOS-daily-tasks`). **Nunca** commitar na `main` por aqui.
- **Estado:** em andamento. Nada foi publicado, nenhuma migração foi aplicada em produção, nenhum deploy foi feito.
- **Produção/homologação:** exige autorização específica. Ver "Como publicar" no fim.

## Princípios fixos
1. Motor **nativo e independente do ClickUp**. Nada em `work_*` referencia o ClickUp; vínculos externos ficarão em `work_external_mappings`.
2. Toda tabela tem `organization_id` e toda consulta filtra por ele. Id de outra empresa = 404 (igual a inexistente).
3. Duas travas de acesso, ambas no backend: **flag da empresa + lista de autorizados** e **papel de administrador**.
4. Regra de negócio no pacote `packages/work-engine`; as rotas (`apps/api/src/work`) só validam, autorizam e traduzem erro.
5. Cliente é relação por `client_id` (cadastro existente), nunca nome.
6. Migrações só ADITIVAS.

## Mapa de arquivos
| Camada | Caminho |
|---|---|
| Schema | `packages/database/src/schema/work.ts` |
| Migração | `database/migrations/0079_daily_tasks_foundation.sql` (renumerar na integração se a `main` já tiver usado a 0079) |
| Motor | `packages/work-engine/src/{access,hierarchy,statuses,tasks,activity,errors,context}.ts` |
| API | `apps/api/src/work/{guard,routes}.ts` |
| Testes motor | `packages/work-engine/src/engine.integration.test.ts` (34, Postgres real) |
| Testes API | `apps/api/src/work/routes.integration.test.ts` (13, Postgres real) |

## Como rodar os testes de integração
Precisam de um Postgres **local** (o arquivo recusa qualquer host que não seja `127.0.0.1`). Banco usado nesta sessão:
container `chat-qa-pg` (porta 55433), banco `dt_qa`, com todas as migrações aplicadas (`DATABASE_URL=... pnpm --filter @desigual-os/database db:migrate`).
```bash
export DATABASE_URL=postgresql://<user>:<senha>@127.0.0.1:55433/dt_qa
pnpm --filter @desigual-os/work-engine exec vitest run
pnpm --filter @desigual-os/api exec vitest run src/work
```
Sem `DATABASE_URL` local, esses arquivos são PULADOS (não falham).

## Incrementos
| # | Incremento | Estado |
|---|---|---|
| 1 | Fundação: flag, schema, domínio, APIs, permissões | **IMPLEMENTED + testes reais** (back-end). Menu/UI: ver abaixo |
| 2 | Gestão básica: espaços, pastas, projetos, listas, tarefas, subtarefas, status, responsáveis, prioridade, prazos | **IMPLEMENTED + testes reais** (back-end) |
| 3 | Colaboração: comentários, anexos, menções, checklists, dependências | NOT_IMPLEMENTED |
| 4 | Visualizações: lista, kanban, calendário, gantt/timeline | NOT_IMPLEMENTED |
| 5 | Produtividade: Meu Trabalho, caixa, time tracking, aprovações, workload, views salvas | NOT_IMPLEMENTED |
| 6 | Configuração: campos personalizados, templates, recorrência | NOT_IMPLEMENTED |
| 7 | Automações | NOT_IMPLEMENTED |
| 8 | Integrações (Comunicação, Clientes, Mídia, agentes, adaptador ClickUp) | NOT_IMPLEMENTED |
| 9 | Analytics | NOT_IMPLEMENTED |
| 10 | Hardening | NOT_IMPLEMENTED |

## Decisões arquiteturais
- **Flag no banco** (`work_feature_flags`, por empresa), não em env: dá para ligar/desligar sem redeploy. Nasce **desligada**. Quem liga é o administrador de plataforma (`master`) via `PUT /work/admin/flag`; estar na lista é obrigatório até para `master`.
- **Administrador** = papel de plataforma `master` OU papel de empresa em {owner, admin, master, super_admin, provider_owner, provider_admin} (mesma lista de `podeConfigurar`).
- **Número legível** `DT-<n>` por empresa via `work_counters` (upsert atômico), seguro sob criação paralela (testado com 12 simultâneas).
- **Idempotência** de criação por `Idempotency-Key` com lock consultivo (`pg_advisory_xact_lock`) por (empresa, usuário, chave). Descoberto por teste: sem o lock, duas criações simultâneas com a mesma chave disputavam o INSERT e uma quebrava.
- **Concorrência otimista**: `version` na tarefa; `expectedVersion` recusado com a versão atual. `SELECT … FOR UPDATE` na atualização.
- **Status por espaço**; remover status em uso exige destino (migra as tarefas, com atividade); FK `restrict` impede apagar em silêncio.
- **Transições**: sem regra cadastrada para um status de origem = livre.
- **Subtarefa**: mesma lista da mãe; profundidade máxima 5 (`MAX_SUBTASK_DEPTH`); ciclo detectado por CTE recursiva; mover leva a subárvore e recalcula profundidade.
- **Lote**: resultado por tarefa, nunca tudo-ou-nada silencioso.
- Mover tarefa **entre espaços** é recusado por enquanto (fluxos de status distintos); precisa de estratégia de mapeamento.

## Testes executados (esta sessão)
- Motor: 34/34 contra Postgres real, 5 execuções seguidas verdes. Mutação conferida: remover o filtro de empresa de `getTask` faz o teste de isolamento falhar.
- API: 13/13 contra Postgres real. Mutação conferida: desligar a guarda faz 3 testes falharem.

## Bloqueios / pendências conhecidas
- Nenhum bloqueio externo até aqui.
- Ainda não existe UI (menu "Daily Tasks — Beta" e telas): próximo passo.
- Migração 0079 ainda **não aplicada** no banco de produção.

## Como publicar (exige autorização explícita do responsável)
1. Rebase sobre `origin/main`; renumerar a migração se houver colisão no journal.
2. Rodar suíte completa, typecheck, lint e build.
3. Backup do banco; aplicar migração aditiva.
4. Deploy de API e worker na VPS; front na Vercel (exportação limpa do commit, ver `docs/architecture/media-command-center.md`).
5. Ligar a flag só para os administradores autorizados.

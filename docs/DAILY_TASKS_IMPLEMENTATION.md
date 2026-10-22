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
| 1 | Fundação: flag, schema, domínio, APIs, permissões | **IMPLEMENTED + testes reais** (back-end). Menu "Daily Tasks — Beta" só aparece com `/work/access` allowed (sidebar e ⌘K); layout com abas (só as prontas são links) |
| 2 | Gestão básica: espaços, pastas, projetos, listas, tarefas, subtarefas, status, responsáveis, prioridade, prazos | **IMPLEMENTED + testes reais** (back-end); UI básica: árvore Espaço→Lista, criar espaço/lista/tarefa, mudar status (typecheck + 80 testes web; **não validada em navegador** com flag ligada) |
| 3 | Colaboração: comentários, anexos, menções, checklists, dependências | **IMPLEMENTED + testes reais** (motor, rotas, gaveta da tarefa). Menções `@[Nome](id)` validadas por empresa; anexos são links (importados do ClickUp); **upload de arquivo novo: NOT_IMPLEMENTED** |
| 4 | Visualizações: lista, kanban, calendário, gantt/timeline | **IMPLEMENTED** Lista, Quadro (arrastar muda status), Calendário, Tabela, Gantt. Validadas no Chromium com dados importados; sem teste automatizado de UI |
| 5 | Produtividade: Meu Trabalho, caixa, time tracking, aprovações, workload, views salvas | **IMPLEMENTED + testes reais**: Meu Trabalho, Caixa de Entrada (não lidas, menções), cronômetro/lançamento manual, visões salvas, carga por pessoa nos relatórios. **Aprovações: NOT_IMPLEMENTED** (a tela de Aprovações do sistema continua a antiga) |
| 6 | Configuração: campos personalizados, templates, recorrência | **IMPLEMENTED + testes reais**: campos (texto, número, data, lista, caixa...), status por espaço, modelos de tarefa (com subtarefas/checklists), duplicar, recorrência diária/semanal/mensal |
| 7 | Automações | **IMPLEMENTED + testes reais**: 7 gatilhos, condições, 8 ações, log de execuções, sem encadeamento (mutação comprova), lock entre instâncias. Relógio no processo da API (`WORK_SCHEDULER=off` desliga) |
| 8 | Integrações (Comunicação, Clientes, Mídia, agentes, adaptador ClickUp) | **IMPLEMENTED (API + motor, testes reais)**: tarefa por origem externa idempotente (`POST /work/tasks/from-source`), resumo por cliente, ferramentas de agente (`workTools`) com o mesmo portão. **Botões na UI de Comunicação/Mídia/Clientes: NOT_IMPLEMENTED** (telas de outras sessões não foram tocadas). **Adaptador ClickUp contínuo/bidirecional: NOT_IMPLEMENTED** (só importação por snapshot; nada é escrito no ClickUp) |
| 9 | Analytics | **IMPLEMENTED + teste real**: totais, por status, por pessoa, prioridade, fluxo semanal, ciclo médio, tempo por pessoa |
| 10 | Hardening | **PARCIAL**: portão (flag + administrador) e isolamento por empresa testados em todas as rotas novas; idempotência; sem transação longa com pool pequeno (deadlock achado e corrigido); mutações provando guardas. **Falta**: teste de carga, limite de taxa por rota, UI automatizada, revisão de permissões por papel mais fino que "administrador" |

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

## Importação do ClickUp (checkpoint)

- Fluxo: `cu_snapshot` (leitura da API do ClickUp, só GET) → arquivos JSON fora do repositório → `packages/work-engine/src/clickup-import.ts` (escrita, idempotente via `work_external_mappings`). CLI: `clickup-import-cli.ts --snapshot <dir> --org <uuid> --user <uuid> [--aplicar]` (sem `--aplicar` é ensaio, transação desfeita).
- Vínculos: usuário por **e-mail igual**, cliente por **nome normalizado igual** (sem aproximação; teste com mutação comprova). O que não casa vai para o relatório e para `work_external_mappings.meta`.
- Medido no ClickUp da Desigual: 4 espaços, 12 pastas, 78 listas, 8.599 tarefas (1.147 abertas, 7.452 concluídas/fechadas; 6.991 subtarefas), 60 checklists, 70 dependências, 13 campos personalizados.
- Importado só no banco LOCAL de QA. Produção: NÃO aplicado (migrações 0079/0080 e importação aguardam autorização).
- Não importado: Docs, Goals, Views, automações e templates do ClickUp; tempo registrado (a API respondeu 403 — o token não tem esse escopo); comentários/anexos de tarefas fechadas ainda sendo baixados (detalhe por tarefa, ~100 req/min).

## Estado em 22/10/2026

- Importação do ClickUp (banco local de QA): 4 espaços, 12 pastas, 78 listas, 8.599 tarefas, ~5,8 mil comentários, ~1,3 mil anexos (links), 60 checklists, 70 dependências, 13 campos, 15 fotos de colaborador. Tempo registrado: o ClickUp devolveu 403 (token sem escopo).
- Migrações 0079, 0080, 0081 (só criam tabelas). **Nenhuma aplicada em produção.** Atenção: outra sessão também usa o número 0079 (anúncios) — resolver o journal na hora de integrar à main.
- Logos de cliente e fotos de colaborador: o front usa `client-logos.ts` (mesmo mapa do app, por nome IGUAL) e `users.avatar_url`.

## Atualização 22/10/2026 — operação completa e integrações

- **Notificações**: cada evento relevante (atribuição, menção, comentário, mudança de status, prazo próximo/vencido, automação "avisar") vira aviso no sino do sistema (`notifications`, link `/daily-tasks?task=<id>`), só para a pessoa certa e só de empresa com o módulo ligado. Lembretes de prazo rodam no relógio da API.
- **Caixa de Entrada unificada**: tarefas + mensagens não lidas e menções da Comunicação + avisos do sistema (abas Tudo/Tarefas/Comunicação/Menções/Sistema). Badge no menu lateral.
- **CRUD completo**: editar/apagar comentário (só o autor), checklist e itens, anexos por link, dependências (sem ciclo), arquivar/restaurar/excluir definitivamente (só arquivado), renomear/arquivar/excluir espaço-pasta-lista, mover tarefa entre listas (menu ou arrastar para a lista na árvore).
- **Calendário**: painel do dia, criar tarefa no dia, arrastar reagenda. **Meu Trabalho**: seletor de pessoa. **Automações**: receitas, edição, resumo ao vivo, "executar agora", gatilhos novos (prazo próximo, mudança de lista) e ações (avisar, mover).
- **Integração com a Comunicação**: na ação "criar tarefa" de uma mensagem, quem tem o Daily Tasks liberado ganha a opção de criar a tarefa lá (idempotente por mensagem). Mudança mínima em `components/comunicacao/modais.tsx` (conflito possível com a sessão do Hub ao integrar).
- **Conflito de edição**: ao receber 409 o front busca a versão atual e reaplica UMA vez a mudança pedida (uma automação logo após criar a tarefa causava falha silenciosa).
- Não feito: aprovações; upload de arquivo novo; botões equivalentes na Mídia e na ficha de Clientes (a API `from-source`/resumo por cliente existe); preferências de notificação por pessoa.

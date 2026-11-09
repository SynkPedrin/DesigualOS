# Publicar o Daily Tasks (ordem importa)

Estado: tudo pronto e testado na branch `feat/daily-tasks` (já contém `origin/main` de 22/10/2026). Falta só publicar.

1. **Migrações (só criam tabelas; nenhuma apaga ou altera tabela existente):**
   `pnpm --filter @desigual-os/database db:migrate` com a `DATABASE_URL` de produção.
   Aplica `0081_daily_tasks_foundation`, `0082_daily_tasks_collab_import`, `0083_daily_tasks_produtividade_automacoes`
   (28 tabelas `work_*`). Conferido em 22/10/2026: produção está em `1792602000000` e não tem nenhuma tabela `work_*`.
2. **Liberar para os administradores:** como `master`, em Daily Tasks → Configurações, ligar "Daily Tasks ligado para os
   administradores desta empresa" (ou `PUT /work/admin/flag { enabled: true, allowedUserIds: [] }`). Lista vazia = todo administrador.
3. **API (VPS 191.252.203.180):** `free -m` antes (com < 2 GB disponíveis não buildar lá — ver nota de 21/10/2026).
   O bundle da API é JS puro: `RELEASE_SHA=<sha> pnpm --filter @desigual-os/api build` localmente e imagem fina só com `dist/` +
   `package.json` + `Brain-Marketing/` evita `pnpm install` na VPS. Depois `git pull` em `/opt/desigual-os` e
   `docker compose -f docker-compose.prod.yml up -d --no-build --no-deps api`. O worker NÃO muda.
4. **Front (Vercel):** `git archive <sha> | tar -x -C <dir>`, copiar `.vercel`, `vercel deploy --prod --yes --archive=tgz`.
   Antes: `git fetch && git log origin/main -3` e `vercel ls desigual-os` (outra sessão pode ter publicado).
5. **Importar o ClickUp (opcional, depois de 1–4):** `clickup-import-cli.ts --snapshot <dir> --org <uuid da Desigual> --user <uuid> [--aplicar]`
   (sem `--aplicar` é ensaio). Vincula pessoas por e-mail e clientes por nome IGUAL; preenche foto só de quem não tem.
6. **Verificar:** `GET /work/access` com conta administradora → `allowed: true`; conta de colaborador → 403.

## Depois de publicar a rodada de 23/10/2026 (arquivos, aprovação, Comunicação)

Sem migração nova. A API ganhou rotas; o front, componentes. Publicar API primeiro, front depois.

- **Copiar anexos antigos do ClickUp para o servidor** (hoje são só link e expiram): como `master`, em lotes e repetível:
  `POST /work/admin/copy-clickup-attachments {"dryRun": true}` (conta) e depois `{"limit": 50}` até `restantes` zerar.
  Só baixa de servidores do ClickUp, passa pela mesma validação da Comunicação e deixa como link o que for recusado.
  Roda DENTRO do container da API (o volume `internal_chat_files` é de lá).
- **Tempo registrado do ClickUp: importado em 23/10/2026** (1.025 lançamentos, ~359 h; 99% é de uma pessoa que já saiu, sem
  conta no sistema, então ficam só com o nome). O endpoint de equipe (`/team/{id}/time_entries`) responde 403
  (`TIMEENTRY_059`) para este token, mas `GET /task/{id}/time` funciona: varre-se as tarefas com `time_spent > 0` (696) e
  monta-se `time_entries.json` (`{id, task:{id}, user, start, end, duration, billable, description}`) ao lado de um
  `team.json`. O importador é idempotente: reaplicar não duplica.
- **Aprovação de tarefa** usa a fila do módulo Aprovações (`approval_requests`, tipo `task`): sem tabela nova.

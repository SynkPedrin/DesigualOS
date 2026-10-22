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

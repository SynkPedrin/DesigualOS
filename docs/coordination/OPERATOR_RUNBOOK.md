# OPERATOR RUNBOOK — DESIGUAL OS V1, CANÁRIO TAMMY

Preparado a partir de `CANARY_RELEASE_MANIFEST.md`. Local RC pronto em:

- Branch: `desigual-v1-tammy-canary` (worktree local em
  `/Users/pedro/desigual-v1-tammy-canary`)
- **CANARY_RELEASE_SHA: `a2f50b4`**
- **PREVIOUS_RELEASE_SHA: `c9becc8`** (main, tip antes desta missão — é o que
  já está em produção hoje, já que o relatório de lançamento anterior
  registra que o web nunca foi de fato deployado a partir daqui)

Tudo abaixo depende de acesso que esta sessão local não tem (servidor remoto,
pm2, banco de produção). Nenhum destes passos foi executado ou simulado como
PASS — são instruções pro operador rodar.

## A — Preflight remoto

No servidor de destino:

```bash
# confirmar branch/SHA que será deployado bate com o release local
git fetch origin
git log -1 --oneline  # comparar com CANARY_RELEASE_SHA depois do push/merge pra origin
```

Antes de tudo: decidir como `desigual-v1-tammy-canary` chega no servidor —
este repositório não tem pipeline de CD (ver seção F). Sem isso definido, os
passos abaixo assumem que o operador vai fazer `git push`/`git pull` manual
ou sync equivalente ao processo já usado no lançamento anterior (documentado
em `docs/audits/DESIGUAL_OS_OPERATION_LAUNCH_REPORT.md` como manual/local).

## B — Migração 0038, presença/aplicação

Esta branch de release **inclui** `database/migrations/0038_jarbas_persistent_tasks.sql`
(entrou junto com o merge do Jarbas approved base — não estava em `main`
antes). No servidor:

```bash
# ver o que já foi aplicado (ajustar caminho/comando pro que o projeto usa
# de fato — não há comando de "status" dedicado neste repo, só apply)
cat database/migrations/meta/_journal.json | tail -20
```

- Se o servidor já está em `0038` ou além: nada a fazer, seguir.
- Se o servidor está em `0037` ou anterior: **decidir explicitamente** se
  0038 entra neste deploy. Ela cria uma tabela nova
  (`agent-tasks`/`agent_tasks`, ver `packages/database/src/schema/agent-tasks.ts`)
  — aditiva, não deveria tocar dado existente, mas isso precisa ser
  confirmado lendo o SQL antes de aplicar, não assumido:

```bash
cat database/migrations/0038_jarbas_persistent_tasks.sql
```

Aplicar só depois de ler. Comando do projeto pra aplicar migração:

```bash
pnpm --filter @desigual-os/database db:migrate
```

Isto **aplica**, não é dry-run — não existe comando de simulação neste
repositório. Rodar em janela de manutenção ou script de aplicação
já testado, não direto contra produção sem plano de rollback do schema.

## C — Jarbas V2 `:3112` saúde

```bash
pm2 list
pm2 describe jarbas-v2-readonly   # ou o nome real do processo no servidor
curl -sf http://127.0.0.1:3112/health || echo "3112 UNHEALTHY"
```

Não reiniciar/recarregar esse processo como parte deste deploy (seção 17 da
missão original) — só observar.

## D — `META_WRITE_ENABLED=false`

```bash
# no ambiente/processo do Jarbas V2 remoto (não neste repositório):
pm2 env jarbas-v2-readonly | grep META_WRITE_ENABLED
# ou, se for arquivo de env direto:
grep META_WRITE_ENABLED <caminho-do-.env-do-jarbas-v2>
```

Esperado: `false`. Se `true` ou ausente-e-o-código-tratar-ausência-como-true,
**não prosseguir** — isso é fora do escopo desta missão consertar.

## E — Legado `:3102` intocado

```bash
pm2 list | grep -i 3102
# confirmar que nenhum comando de deploy/restart desta missão tocou nele
```

Nenhum passo deste runbook referencia `:3102`. Se algum script de deploy
genérico do servidor reinicia "todos os processos", isolar esse processo da
lista antes de rodar.

## F — Comandos canônicos de deploy

**Não descobertos neste repositório.** Não existe `ecosystem.config.js`, não
existe `scripts/deploy*`, não existe pipeline de CD (`.github/workflows/ci.yml`
é só gate de qualidade: install → build → typecheck → lint → test, não
deploy). O relatório de lançamento anterior (`f973ddc`,
`docs/audits/DESIGUAL_OS_OPERATION_LAUNCH_REPORT.md`) registra que o deploy
anterior foi manual/local (API e worker reiniciados diretamente na máquina;
web nunca chegou a ser deployado, bloqueado em `git push origin main`).

**O que falta pra preencher esta seção:** o procedimento real usado da
última vez que API/worker foram reiniciados em produção (comandos exatos,
gerenciador de processo, se é `pm2 restart`/`systemctl`/outro). Pergunte a
quem fez esse deploy anterior, ou documente aqui assim que descoberto — não
inventar um mecanismo novo.

## G — Saúde pós-deploy

```bash
curl -sf https://<host>/api/version
curl -sf https://<host>/api/health   # ou rota equivalente do dashboard de Health
```

Esperado: sem erro 5xx, sem "undefined%" (é exatamente o que `c9becc8`
corrigiu — se voltar a aparecer, é regressão).

## H — Login Tammy

Usar a conta já autorizada da Tammy. Confirmar:

- login funciona
- sessão persiste em reload
- organização/permissões corretas (Tammy não deve ter papel `master` — ver
  gate do Jarbas na seção D do manifesto)

## I — Clients smoke

Abrir `/clients` → lista carrega, sem tela branca, sem erro de console
fatal → abrir um cliente → voltar → trocar de cliente.

## J — Cliente A → chat → Bento

Dentro do workspace do cliente A, pedir ao Bento algo específico daquele
cliente (ex.: status de uma task real). Confirmar que o contexto de cliente
usado é o A, não vaza nome/task/briefing de outro cliente.

## K — Otto smoke

Pelo UI deployado (não script standalone): pedir uma legenda, um creative
brief, e um carrossel ou estático. Confirmar: resposta aparece, cliente
correto, sem placeholder solto, `human_review_required` aplicado.

## L — Studio viewport live smoke (gate final do Studio)

Sidebar → Studio → Canva → projeto real. Desktop ≥1440x900.

1. Zoom manual pra 45%
2. Redimensionar a janela pra menor
3. Verificar: artboard alcançável, borda inferior alcançável, borda direita
   alcançável, zoom continua em 45%, pan reancorou (não pulou de volta pro
   centro)
4. Fit to View funciona
5. 100% funciona
6. Sidebar continua acessível
7. Controles inferiores continuam acessíveis

Se tudo passar: `STUDIO VIEWPORT = PASS`. Se falhar: reverter só o commit
`50d3f5b` deste release (não o resto), documentar `STUDIO LIMITED / KNOWN
ISSUE`, seguir com o resto do canário.

## M — Troca de cliente / isolamento de tenant

Cliente A → workspace → chat. Trocar pro Cliente B. Confirmar: nada do
Cliente A (nome, task, briefing, IDs, memória de agente) aparece no
contexto do Cliente B.

## N — Rollback

```bash
# identificar o processo/branch atualmente rodando em produção antes deste
# deploy e voltar pra ele — como o deploy real usa procedimento manual não
# documentado (ver seção F), o rollback também depende de descobrir esse
# procedimento primeiro.
git log -1 --oneline c9becc8   # PREVIOUS_RELEASE_SHA, pra conferência
```

Sem o mecanismo de deploy da seção F documentado, "rollback pronto" nesta
missão significa: sabemos exatamente qual SHA voltar (`c9becc8`), mas o
comando operacional de voltar depende do mesmo procedimento manual que falta
documentar. **Isto é um item em aberto, não fingir READY.**

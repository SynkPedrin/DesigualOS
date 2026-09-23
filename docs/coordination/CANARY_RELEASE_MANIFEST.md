# DESIGUAL OS V1 — CANARY RELEASE MANIFEST (Tammy Operational Test)

Data: 23/09/2026
Escopo: canário operacional interno (Tammy + Pedro/admin), não release global.

Este documento existe porque a missão original assumia estado de infraestrutura
(migração 0038 aplicada, sombra Jarbas em `jarbas-v2-readonly:3112`) que **não
existe neste checkout local de `main`**. Investigação (três agentes,
read-only, sem merge/checkout/deploy) confirmou onde cada peça realmente está.
Decisão do usuário: tratar o alvo real de deploy (com 0038 e a sombra Jarbas)
como um servidor remoto fora do alcance desta sessão local — o operador
executa deploy/pm2/migração lá, usando este manifesto como fonte da verdade
de quais SHAs/branches integrar.

## Estado real vs. premissa da missão

| Premissa da missão | Realidade em `main` (local, HEAD `c9becc8`) |
|---|---|
| Migração Jarbas 0038 já aplicada | Não existe em `main`. Journal para em `0037_restrict_public_data_api`. `0038` só existe nos worktrees `jarbas-senior-intelligence` / `jarbas-senior-v1`. |
| Sombra `jarbas-v2-readonly` em `:3112`, `META_WRITE_ENABLED` | Nenhuma referência em `main` (docs, `.env.example`, config). Só existe nos worktrees jarbas-senior-*. `pm2` nem está instalado nesta máquina — não dá para verificar processo vivo daqui. |
| "Procedimento canônico de deploy existente" | Não há `ecosystem.config.js`, nem script de deploy, nem pipeline de CD. `.github/workflows/ci.yml` é só gate de qualidade (install → build → typecheck → lint → test). Deploys anteriores foram manuais; o relatório de lançamento anterior (`f973ddc`) registra que o web **nunca foi de fato deployado** (bloqueado em `git push origin main`, deliberadamente não feito). |

**Implicação:** o alvo real de deploy (com 0038 aplicada e a sombra rodando) é
um ambiente remoto que este checkout não vê. As seções de deploy efetivo,
verificação de pm2/porta 3112 e aplicação/rollback de migração devem ser
executadas pelo operador nesse ambiente — este manifesto cobre o que é
verificável a partir do repositório: SHAs aprovados, ancestralidade,
isolamento de client, e o que falta rodar (build/test/smoke).

## Componentes

| Componente | Branch/Worktree | SHA | Veredito | Incluído | Motivo |
|---|---|---|---|---|---|
| **CORE / HEALTH** | `main` | `c9becc8` | Aprovado | Sim | Última correção é saúde de infra honesta (não "undefined%"); base de tudo abaixo. |
| **BENTO** | `main` | `5bb5b3c` | Aprovado | Sim | Continuação same-day do RC congelado em `afd24c3` (doc `f973ddc`, P0=0). `03accbc`+`5bb5b3c` promovem allowlist fixa → autorização estrutural por capacidade/organização, achado em aceite de release via browser real (23/09), com testes novos (`bento-action-execution.test.ts`, `write-scope.test.ts`). `c9becc8` (após) é fix de web/health, não-Bento. |
| **OTTO** | `otto-elite-quality` (worktree `/Users/pedro/DesigualOS-otto-elite`) | `61ab05a` (`61ab05af4a1181156a383b353f87b07a8993cba8`) | Aprovado | Sim | "READY FOR OPERATIONAL TEST — OTTO V1". Toca só `packages/otto/src/creative/schemas.ts(.test)`. Diff vs. merge-base com main (`53f0804`) tem **0 arquivos** com "cinema"/"endrigo" no nome — Cinema Impossível e skill do Endrigo confirmados intocados. |
| **JARBAS (infra only)** | `jarbas-senior-v1` (worktree) | `280f47a` (`280f47a2e0a61c00ab223bded056c00d76339000`) | Aprovado, mas **NÃO integrar handoff de chat natural** | Parcial / condicional | "JARBAS ENGINE APPROVED BASE" (handoff real usa `PostgresAgentTaskStore`). `jarbas-senior-intelligence` (`85aa671`) é **ancestral** de `280f47a` (0 commits à frente) — nada de trabalho em progresso não-mesclado a excluir. `worktree-bento-jarbas-senior-hardening` (`e9ee157`) também é ancestral de `280f47a` — já incorporado. Ou seja: não há trabalho "em andamento" órfão para vazar; a única decisão é **não expor** o handoff de chat ao Tammy (feature flag off), não uma questão de SHA. |
| **STUDIO viewport fix** | `main` (working tree, não commitado) | — (sem SHA — mudança não commitada em `apps/web/src/components/studio/canva/canvas-stage.tsx`) | **Não verificável como está** | Condicional | Só existe como diff local não commitado em `main`; não existe em nenhum outro branch/worktree/histórico. Antes de incluir: precisa ser commitado, passar build/typecheck/test, e passar o smoke manual real de viewport (zoom 45%, resize, Fit to View etc. — requer navegador, não disponível nesta sessão). Se falhar ou não puder ser verificado: **reverter/excluir**, documentar `STUDIO LIMITED / KNOWN ISSUE`, não bloquear o resto do canário. |
| **MIGRAÇÃO DB (0038 + sombra Jarbas :3112)** | remoto (fora deste checkout) | N/A | **Fora do alcance desta sessão** | Verificar no ambiente remoto | Não existe em `main` local. Operador deve confirmar no servidor alvo: `0038` aplicada, `jarbas-v2-readonly` saudável em `:3112`, `META_WRITE_ENABLED=false`, antes de liberar o canário. |

## Ordem de integração recomendada

1. `main` (`c9becc8`) — base, já contém CORE/HEALTH + BENTO aprovado até `5bb5b3c`.
2. Cherry-pick/merge `61ab05a` (Otto V1) de `otto-elite-quality` sobre `main`.
3. Jarbas: **não mesclar chat natural**. Se infraestrutura Jarbas (`280f47a`) for necessária como dependência de runtime, integrar apenas o necessário, mantendo o handoff atrás de feature flag desligada.
4. Studio: só depois de commitar o fix local, rodar `pnpm typecheck && pnpm build && pnpm test` limpos, e um smoke manual real de viewport. Falhou ou não deu pra testar → excluir do canário, não bloquear o resto.
5. Regressão final: suíte completa (`web`, `api`, `worker`, `agent-runtime`, `orchestrator`, `tool-gateway`, `database`, `types`, Otto, Bento).

## O que esta sessão NÃO pode fazer

- Deploy efetivo (sem mecanismo de CD no repo; sem acesso ao servidor remoto).
- Checagem de `pm2`/porta `:3112` ao vivo (pm2 não instalado localmente; alvo real é remoto).
- Aplicar ou verificar status da migração `0038` (não existe neste checkout).
- Smoke de UI real no navegador (login → Clients → chat → Bento → Otto → Studio) — requer ferramenta de automação de navegador não disponível nesta sessão.

Essas etapas ficam para o operador, no ambiente remoto, usando este manifesto
como lista do que integrar e por quê.

---

## ATUALIZAÇÃO — integração local concluída (23/09/2026, mesma sessão)

O que estava "condicional" acima foi resolvido:

### Studio: isolado, testado, aprovado localmente

O diff de viewport (ResizeObserver + `clampPan` em resize pós-zoom manual) era
a ÚNICA mudança suja em `main` — nada mais precisou ser isolado. Virou commit
único na branch `studio-viewport-release-fix`:

**STUDIO_SHA: `50d3f5bebb536f76af8e4447708c090d6e6d2d8c`**

Gates locais, todos PASS: `tsc --noEmit` (limpo), `eslint` (limpo), build
`next build` (26/26 rotas, incluindo `/clients`, `/chat`, `/studio`,
`/login`), 40/40 testes unitários relevantes (`viewport-math.test.ts`,
`use-canva-editor.persistence/reorder/escala/group.test.tsx`). Smoke visual
real em navegador (zoom 45%, resize, Fit to View) **continua PENDENTE —
gate do operador**, não reivindicado como PASS aqui.

### Integração: worktree limpo, merge por ordem de dependência

Worktree `desigual-v1-tammy-canary` (`/Users/pedro/desigual-v1-tammy-canary`),
criado a partir de `main` (`c9becc8`). Ordem de merge (todos `--no-ff`,
histórico preservado):

1. Otto V1 `61ab05a` → conflito zero de código; único conflito foi
   `.gitignore` (regras não sobrepostas de ambas as branches, mescladas
   semanticamente, nenhuma removida).
2. Jarbas approved base `280f47a` → merge limpo, sem conflito. Trouxe junto
   `database/migrations/0038_jarbas_persistent_tasks.sql` — **isto muda o
   estado anterior deste documento**: a migração 0038 passa a fazer parte
   desta branch de release. O operador precisa checar no ambiente remoto se
   `0038` já está aplicada lá ou se precisa ser aplicada como parte deste
   deploy (ver runbook, seção B).
3. Studio `50d3f5b` → merge limpo, sem conflito.

**CANARY_RELEASE_SHA: `a2f50b4`** (branch `desigual-v1-tammy-canary`, árvore
de trabalho limpa — nada commitado a partir de estado sujo).

### Gate de segurança do Jarbas — verificado por leitura de código, não assumido

`packages/agent-runtime/src/bento-jarbas-handoff.ts` faz a detecção de intenção
(regex determinística, sem LLM/rede). Quem liga isso ao caminho real do Bento
é `apps/worker/src/processors/jarbas-handoff.ts`, importado por
`bento-action-guard.ts`. Três camadas independentes impedem o handoff de
chegar à Tammy sem querer:

1. **Permissão** — `canAssignJarbasTask` exige `hasPermission(ctx, 'jarbas',
   'assign')` ou coringa `*`/`*`. Nenhum papel do código concede isso por
   padrão; só o papel `master`, atribuído em `packages/auth/src/provisioning.ts`
   quando o e-mail está em `MASTER_USER_EMAILS` — variável de ambiente que o
   operador controla.
2. **Mapa de conta Meta** — mesmo com permissão, `resolveMetaAccountId` está
   *hardcoded* para sempre devolver `null` (comentário no próprio arquivo:
   o mapa clientId→accountId não existe neste repositório). O handoff nunca
   consegue completar; a resposta é sempre "ainda não tenho a conta mapeada".
3. **Config de ambiente** — exige `JARBAS_V2_URL` e `AGENTES_ASK_TOKEN`; sem
   os dois, bloqueia com mensagem honesta.

Nenhuma mudança de código foi feita — já está desligado por padrão para
qualquer papel que não seja `master`, e funcionalmente inerte mesmo para
`master` até o mapa de contas existir. Recomendação pro operador: não colocar
o e-mail da Tammy em `MASTER_USER_EMAILS` neste ambiente de canário, por
defesa em profundidade (mesmo sabendo que a camada 2 já bloqueia sozinha).

Nenhum caminho de escrita no Meta existe neste código (`buildProposedAction`
sempre retorna proposta com `requiresApproval: true`, nunca executa).
`META_WRITE_ENABLED` não é referenciado neste repositório — é config do
serviço Jarbas V2 remoto, fora deste checkout.

### Cinema Impossível / Endrigo — reverificado pós-integração

`git diff --name-only c9becc8..a2f50b4 | grep -iE "cinema|endrigo"` → **0
arquivos**. Único hit de texto encontrado era um comentário pré-existente em
`packages/otto/src/creative/schemas.ts:82`, já presente em `main` antes de
qualquer merge desta missão — não é referência nova.

### Gates locais completos — todos PASS (com `.env` de dev copiado pro
worktree; o arquivo é ignorado pelo git e não acompanha `git worktree add`)

| Gate | Resultado |
|---|---|
| `pnpm typecheck` (turbo, 18 pacotes) | 18/18 PASS |
| `pnpm lint` (turbo, 18 pacotes) | 18/18 PASS, 0 erros (17 warnings pré-existentes de unused-var/import-style, nenhum em código tocado por esta missão) |
| `pnpm build` (turbo, 18 pacotes) | 18/18 PASS — `apps/web` gera as 26 rotas, incluindo todas as release-críticas |
| `orchestrator` test | 16/16 arquivos, 159/159 testes |
| `web` test | 19/19 arquivos, 212/212 testes |
| `api` test | 15/15 arquivos (+1 skip pré-existente que exige Postgres real), 103/103 testes |
| `worker` test | 38/38 arquivos, 655/655 testes — inclui `jarbas-handoff.test.ts` e `bento-action-execution.test.ts` |
| `agent-runtime` test | 12/12 arquivos, 175/175 testes |
| `tool-gateway` test | 7/7 arquivos, 95/95 testes — inclui `write-scope.test.ts` |
| `database` test | 2/2 arquivos, 5/5 testes |
| `types` test | 2/2 arquivos, 22/22 testes |
| `otto` test | 23/23 arquivos, 398/398 testes |

Nenhuma falha foi suprimida ou ignorada. A única fragilidade de ambiente
encontrada (módulo nativo `canvas` falhando o rebuild no `pnpm install`, por
divergência de versão do Node no rebuild automático de gyp) é pré-existente,
não bloqueou nenhum teste, e não está relacionada a nenhuma mudança desta
missão.

### Veredito local

**LOCAL RC READY — OPERATOR DEPLOY NEXT.** Ver `OPERATOR_RUNBOOK.md` (mesma
pasta) para os passos remotos que esta sessão não pode executar.

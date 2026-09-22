# DESIGUAL OS — TAMMY RC GATE

Data: 21/09/2026  
Resultado: **NOT READY FOR TAMMY**

## Bento Quality

| Teste | Status | Evidência |
|---|---|---|
| Operação real | BLOCKED | Não executado contra uma conversa Tammy habilitada. |
| Mudanças desde ontem | BLOCKED | Não executado com fonte temporal real. |
| Pessoa ↔ cliente | BLOCKED | Não executado no runtime V2. |
| Follow-up / top 3 | BLOCKED | Não executado com dados operacionais reais. |
| Briefing multi-turn | BLOCKED | Não executado contra a conta de teste. |
| Criação contextual | BLOCKED | O guard legado cria tasks; a primitiva sênior ainda não é o executor do runtime. |

## Otto Quality

| Teste | Status | Evidência |
|---|---|---|
| Recuperação da campanha correta | BLOCKED | Endpoint/runtime V2 não foi habilitado para Tammy. |
| Copy específica | BLOCKED | Sem execução comportamental registrada. |
| Feedback “ficou genérico” | BLOCKED | Sem comparação V1/V2 registrada. |
| Continuidade de contexto | BLOCKED | Sem execução multi-turn registrada. |
| Task criativa verificada | BLOCKED | Sem execução real Otto registrada. |

## ClickUp Real — QA exclusivamente

Área criada sem tocar em demandas de produção:

- Espaço: `QA DESIGUAL OS` (`90148778682`)
- Pasta: `QA DESIGUAL OS` (`901413603806`)
- Lista: `Lista QA` (`901421333717`)
- Task: `[QA] Tammy RC — Bento Task`
- Task ID: `86bc44ahf`
- Responsável: Tammy (`88409653`)
- Prazo lido: 22/09/2026
- Briefing: persistido e confirmado por GET
- Verificação: PASS — nome, responsável e prazo-calendário

O primeiro POST real foi feito pelo `createVerifiedSeniorTask`, com contexto de execução, usuário, organização, permissões e agente Bento. Um retry posterior encontrou a mesma task e retornou o mesmo ID; não houve segunda task.

## Runtime

- Credencial ClickUp: PASS, carregada da configuração existente; nenhum segredo foi versionado.
- Área de QA: PASS.
- `create → read-back → verify`: PASS na primitiva real.
- Idempotência por título/lista antes do POST: PASS na repetição real.
- Rollout Tammy: OFF.
- `TAMMY_RC_ENABLED`: `false`.
- Suzy/Jarbas V2: permanecem desligados.
- Conexão da primitiva ao executor efetivo Bento/Otto: **BLOCKED**; o caminho atual do worker ainda usa `createManyTasks`/`createAttributedTask` no guard legado.

## Briefing Quality

O briefing QA real contém contexto, objetivo, entregável, responsável, prazo e critério de conclusão. Foi relido no ClickUp sem perda.

## Errors

Foi encontrado e corrigido um problema de verificação de prazo: o ClickUp normaliza prazo como data-calendário, enquanto a primeira chamada comparava o instante de fim do dia. A verificação da primitiva passou a comparar a granularidade `day` quando o prazo é operacional.

## Regression

- `pnpm typecheck`: PASS antes da última alteração de idempotência; precisa ser repetido após este patch.
- `pnpm test`: PASS antes da última alteração de idempotência; teste unitário da primitiva PASS após o patch.
- `pnpm build`: PASS antes da última alteração de idempotência; precisa ser repetido após este patch.
- `lint`: sem erro conhecido; precisa ser repetido no fechamento.

## Gate

**NOT READY FOR TAMMY**

Motivos objetivos: runtime Bento/Otto ainda não consome a primitiva estruturada; suíte comportamental real ainda não foi executada; rollout controlado ainda não foi configurado com o usuário/organização no ambiente de execução.

# Studio — arquitetura do pipeline autônomo de qualidade

Medições desta página foram feitas em **16/09/2026** contra a GPU real de
produção (`100.107.198.50`, Windows, RTX 4090 24GB, 96GB RAM, ComfyUI 0.33.4,
FLUX.2 Dev `flux2_dev_fp8mixed.safetensors`). Onde não houve medição, está
escrito que não houve.

---

## 1. O que já existia antes desta mudança

O fluxo real, lido do código (não suposto):

```
Studio UI
  → POST /studio/jobs            apps/api/src/studio/routes.ts   (auth + idempotência 15s)
  → linha em studio_jobs + BullMQ 'studio-jobs'   (Redis)
  → studio-node                  nodes/studio-node/src/index.ts  (concurrency 1, lock 25min)
      deriveCreativeSpec  → resolveReferencePlan → compileFlux2Prompt
      → ComfyUI FLUX.2    → compositing sharp (texto/logo)
      → Supabase Storage  → studio_assets
  → publishWsEvent('studio.job.progress') → UI
```

**O achado que motivou este trabalho:** o maquinário de qualidade já estava
escrito e não era chamado por ninguém.

| Módulo | Situação encontrada |
|---|---|
| `src/visual-qa.ts` | Completo. **Zero importadores.** Usava a API do Claude, não modelo local |
| `src/workflow-router.ts` | Completo. Importado **só pelo próprio teste** |
| `src/finish.ts` (`selectFinishStrategy`) | Completo. **Nunca chamado** |

Ou seja: crítica, roteamento de workflow e finish/upscale não estavam
faltando — estavam desligados. Não havia loop, contagem de tentativas,
melhor candidato nem gate.

Em contrapartida, muita coisa já existia e **foi reaproveitada, não
reescrita**: `WORKFLOW_REGISTRY` + `MODEL_REGISTRY` (com cascata
`enabled:false`), `CreativeSpec` (o "VisualPlan"), o PromptCompiler
(`compileFlux2Prompt`), papéis/fidelidade de referência, fingerprint de
idempotência, resume de prompt do ComfyUI após crash, e
`STUDIO_JOB_STATUSES` — que **já declarava** `planning`, `quality_check`,
`refining`, `post_processing`. O `use-studio-jobs.ts` do front já faz polling
de qualquer status não-terminal. O front estava pronto; o worker é que nunca
emitia esses estágios.

---

## 2. A restrição que define a arquitetura: VRAM

A ideia intuitiva — "sobe um VLM local na GPU e critica a imagem ali mesmo" —
**não se sustenta nesta máquina**. Medido:

| Condição | Geração FLUX.2 | Chamada do crítico |
|---|---|---|
| FLUX.2 quente, GPU limpa | **36,4 s** | — |
| FLUX.2 frio (precisa carregar) | **389,3 s** | — |
| `qwen3.6:35b-a3b` co-residente | **110,1 s (3×)** | 40,4 s (vs 4,5 s na GPU limpa) |

Com o FLUX.2 residente, o ComfyUI enxerga **6,4 GB livres** dos 24 GB (o
modelo ocupa ~17,6 GB). O `qwen3.6:35b-a3b` quer **20,7 GB**. Não cabem.
Ao subir o 35B ao lado, a VRAM livre do ComfyUI caiu para **0,08 GB** e a
geração seguinte triplicou. Mesmo o `ministral-3:3b` ocupa **5,5 GB em
runtime** (não os 2,9 GB do arquivo) e também degradou a geração.

**Decisão:** o crítico roda em **compute separado**. `CRITIC_OLLAMA_URL`
aponta por padrão para o `127.0.0.1:11434` do processo do worker, não para o
Ollama da caixa da GPU. Apontar para a GPU continua suportado, mas é uma
troca consciente de tempo de geração por qualidade de crítica.

> Nota de instrumentação: o `vram_free` do `/system_stats` do ComfyUI
> **não** é confiável para detectar disputa — ele reportou 20,54 GB livres
> enquanto o Ollama segurava 20,73 GB no mesmo card de 24 GB. Para medir
> contenção de verdade, use `nvidia-smi` (device-wide) ou meça o
> comportamento (tempo de geração), que foi o que se fez aqui.

---

## 3. Escolha do modelo crítico

Não existe um servidor "Qwen3-VL" no parque. O que existe:

| Modelo | Onde | Visão | Veredito medido |
|---|---|---|---|
| `ministral-3:3b` | GPU box | sim | **Não serve.** Genérico; deu `anatomy 9.0` numa imagem com mãos quebradas; chegou a responder que a imagem "is an actual photograph (not AI-generated)" e se recusar a criticar |
| `qwen3.6:35b-a3b` | GPU box | sim (MoE A3B) | **Melhor crítico.** Localizou os defeitos reais. Mas 20,7 GB → inviável co-residente |
| `qwen3.5:9b` | Mac (outra máquina) | sim | **Escolhido.** Empatou score a score com o 35B no retrato e acertou a lateralidade que o 35B errou. Zero disputa com a GPU |

> `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` existe na caixa da GPU, mas
> é o **text encoder do vídeo MiniMax H3** dentro do ComfyUI, não um servidor
> de inferência. Não é candidato a crítico.

### Limites conhecidos do crítico (medidos, não teóricos)

1. **Erra `text_integrity` com confiança alta.** Nenhum dos três modelos
   percebeu que a placa "Residencial HABIANA" de um asset real estava
   truncada/deformada; o 9B afirmou que estava *"perfectly legible and
   correctly spelled"*. Por isso `text_integrity` **não entra no gate** —
   texto de verdade continua sendo compositing (`text-overlay.ts`).
2. **Erra o rótulo de região.** O 35B classificou quatro defeitos seguidos
   de mão/pé como `region: "product"` numa imagem sem produto nenhum. Daí
   existir `normalizeProblemRegion()`, que reclassifica pela descrição.
3. **Erra lateralidade** (esquerda/direita). Região serve para rotear
   correção; o lado **não** serve para posicionar máscara automática.
4. **Não é uniforme entre imagens.** O 9B empatou com o 35B no retrato e
   **perdeu** os defeitos de mão na foto de família. Uma passada boa não
   valida o crítico.
5. **É determinístico** a `temperature: 0` — scores idênticos em repetições.
   É isso que torna um gate por threshold possível.
6. `think: false` é obrigatório: com thinking ligado o modelo gasta o
   orçamento de tokens no canal de raciocínio e devolve `response` vazio.

---

## 4. Arquitetura implementada

```
Studio UI
  → POST /studio/jobs
  → BullMQ 'studio-jobs'
  → studio-node  ──────────────────────────────────────────┐
       CreativeSpec → ReferencePlan → PromptCompiler       │
       │                                                    │
       ▼  STUDIO_AUTONOMOUS_QA=true e type='image'          │
     ┌──────────────── qa-loop.ts ─────────────────┐        │
     │  tentativa N                                 │        │
     │   → generate()      [ComfyUI, RTX 4090]      │        │
     │   → critiqueImage() [VLM, OUTRA máquina]     │        │
     │   → decideQuality() [regra determinística]   │        │
     │        approve      → sai                    │        │
     │        local_edit   → diretiva + regera      │        │
     │        regenerate   → seed nova + regera     │        │
     │        accept_best  → melhor candidato       │        │
     └──────────────────────────────────────────────┘        │
       │                                                     │
       ▼  flag off  → caminho antigo, inalterado ────────────┘
     compositing → Storage → studio_assets (+ laudo em metadata.qa)
  → WS 'studio.job.progress' (rendering | quality_check | refining | completed)
```

### Arquivos

| Arquivo | Papel |
|---|---|
| `nodes/studio-node/src/visual-critic.ts` | Crítico plugável: `ollama` (local, outra máquina) ou `anthropic` (adapta o `visual-qa.ts` existente). Schema JSON via `format` do Ollama |
| `nodes/studio-node/src/decision-engine.ts` | Gate determinístico, thresholds por perfil, roteamento de correção, melhor candidato |
| `nodes/studio-node/src/qa-loop.ts` | Loop tentativa → crítica → decisão → correção; MAX_ATTEMPTS; cancelamento; fallback |
| `nodes/studio-node/scripts/import-comfyui-outputs.ts` | Traz para o Studio toda imagem gerada na GPU, inclusive fora de job |

### Thresholds

Vivem em `decision-engine.ts` (`THRESHOLDS_BY_PROFILE`), **não em env var**:
mudar um deles muda o que a casa considera entregável, e isso tem que
aparecer em diff e code review.

| Perfil | overall | artifact | aderência | composição | região |
|---|---|---|---|---|---|
| draft | 5,0 | 3,0 | 5,0 | 4,0 | 3,0 |
| standard | 7,0 | 5,0 | 7,0 | 6,0 | 5,0 |
| master | 8,0 | 6,5 | 8,0 | 7,0 | 6,5 |

**O veredito do modelo não decide nada.** Medido: o 35B e o 9B deram scores
idênticos para a mesma imagem e recomendações **opostas**
(`requires_regeneration` true vs false). Se o gate seguisse o campo do
modelo, o comportamento do Studio dependeria de qual modelo estava
carregado. Sobre os números os dois concordam; é sobre eles que se decide.

Um defeito `high` numa região localizável reprova a peça **mesmo com overall
acima do threshold** — é exatamente o defeito que o olho do cliente encontra
primeiro.

---

## 5. Ciclo de vida da GPU

- **Serialização**: `concurrency: 1` no worker BullMQ continua sendo o lock
  de GPU. Já havia medição anterior de que `concurrency: 2` trava o
  `SamplerCustomAdvanced` (24 min parado, sem erro).
- **O crítico não disputa a GPU** por construção (seção 2).
- **Custo dominante é residência, não pixels**: 36,4 s quente vs 389,3 s
  frio. Alternar entre família FLUX e família H3 (vídeo) é o que expulsa os
  pesos e cria o reload.
- **Atenção ao `lockDuration`**: é de 25 min. Uma geração cold de duas
  passadas medida nesta sessão levou **1510 s (25 min)** sozinha. Com o loop
  fazendo até 3 tentativas, um job pode passar bem disso. O BullMQ renova o
  lock sozinho enquanto o processo está vivo, mas **isto não foi testado sob
  o loop completo** — ver seção 8.

---

## 6. Fallback

| Situação | Comportamento |
|---|---|
| Crítico indisponível | Entrega a geração que **já existe** (GPU já foi gasta), grava `qa.critic_unavailable` com o motivo e **não gera de novo**. Nunca inventa score |
| ComfyUI fora | `describeFailure()` traduz para mensagem legível; job vai a `failed` com motivo |
| Job cancelado | Para antes do próximo ciclo; status `cancelled`, não `failed` |
| Linha do job apagada | Worker descarta **sem gerar** (antes gerava às cegas) |
| `UltimateSDUpscale` ausente | `finish_master_v1` fica `blocked` no registry — confirmado ao vivo, `/object_info/UltimateSDUpscale` devolve `{}` |

---

## 7. Cancelamento

Dois caminhos, porque o custo é diferente:

- **Job na fila** → `removeQueuedStudioJob()` tira do Redis; a GPU nunca é
  tocada.
- **Job rodando** → marca `cancelled` no banco; o worker para no próximo
  checkpoint do loop. Não se arranca um job ativo do worker sem corromper o
  lock do BullMQ.

Antes desta mudança, `DELETE /studio/jobs/:id` apagava a linha mas **deixava
o job no Redis** — o worker pegava depois, não achava linha e **gerava assim
mesmo**, queimando GPU real numa peça que ninguém veria, e inserindo
`studio_assets` órfãos. Corrigido nos dois lados (fila + defesa no worker).

---

## 8. O que foi validado AO VIVO (17/09/2026, fase 2)

Tudo abaixo rodou contra a GPU real, o Redis real, o Postgres real e, onde
indicado, pelo **navegador** com login de verdade (`studio-test@`, papel
colaborador, senha pelo formulário - sem token fabricado e sem service key).

| Item | Evidência |
|---|---|
| Login real pelo formulário | `tests/e2e/studio-front-validation.spec.ts`; screenshots em `tests/e2e/shots/` |
| Job criado pela interface | `202 POST /studio/jobs` -> `STU-MU4GK4TT4B396E`, `STU-MU4I35VT5AB437`, `STU-MU4JXHX1C0C3E6` |
| Loop de correção REAL | job `STU-MU4I35VT5AB437`: 3 tentativas, diretiva de correção não vazia, lineage persistida |
| MAX_ATTEMPTS | mesmo job: parou em 3, `final_action: accept_best` |
| Melhor candidato | mesmo job: `chosen: 1` de 3 (antes da correção escolhia a 3, a pior) |
| PASS -> upscale -> final QA | job `STU-MU4JXHX1C0C3E6`: approve 8,5 -> upscale `restore` -> final QA `kept: true` em 12,7s -> entregue 2048x1728 |
| Timeout de fila | job `STU-MU4GF4BD55B3A2`: criado pela UI 18:48:45, sem worker, `failed` às 18:52:03 com "No available Studio worker." |
| Rollback pela flag | job `STU-MU4K5NFAA2A6B2` com `STUDIO_AUTONOMOUS_QA=false`: nenhum estágio de QA emitido, `metadata.qa = null` |
| Lock do BullMQ não duplica | job de 15s com `lockDuration` de 3s processado **1x** (renovação automática confirmada) |
| Recuperação de worker morto | job retomado e concluído depois do lock expirar; o prompt do ComfyUI foi **resumido**, não regerado |
| Fallback do crítico | `CriticUnavailableError` no final QA entregou a peça aprovada sem upscale, sem falhar o job |

## 9. Bugs encontrados NA PRÓPRIA implementação (e corrigidos)

Achados por execução real, não por revisão de código:

1. **Correção vazia virava sorteio.** Job `STU-MU4GK4TT4B396E`: a tentativa 1
   reprovou só por `anatomy`, a região alvo virou `body` (sem texto de foco)
   e nenhum problema era `high` - a diretiva saiu **vazia**. O loop regerou
   com o MESMO prompt e seed nova. O sorteio **piorou** a peça: inseriu mãos
   deformadas (`hands: 3`) numa imagem que não tinha mão nenhuma.
   Corrigido: `buildCorrectionDirective` devolve `null` e o loop **para** em
   vez de regerar às cegas.

2. **`anatomy` agregado reprovava peça boa.** O mesmo job: `anatomy: 4.0`
   convivendo com `hands: 10` e `face: 10`, numa foto de produto cuja única
   anatomia visível (um tornozelo) estava correta. Corrigido: o agregado só
   reprova quando `hands` ou `face` também reprovam.

3. **Melhor candidato entregava a pior peça.** As três tentativas empataram
   em `overall` (7,5) e `artifact` (8); o desempate por "tentativa mais nova"
   escolheu a 3, com defeito `high` de dedos fundidos, em cima da 1, limpa.
   Corrigido: desempata por menos dano concreto, depois por mão/rosto.

4. **Final QA morria com HTTP 400.** Job `STU-MU4JNHW41060D7`: as duas
   imagens iam cruas; o PNG de 2048px do upscale somado ao original estourou
   o corpo aceito pelo Ollama. Corrigido: reduz a 1024px/JPEG antes de
   enviar (também corta memória e tempo).

5. **Worker morria em silêncio.** Saía com código 1 sem escrever uma linha -
   o job ficava preso em `rendering` até o lock expirar (25 min).
   Corrigido: handlers de `uncaughtException`/`unhandledRejection` que
   registram o motivo antes de sair. Foram eles que revelaram a causa real
   das mortes seguintes: `EADDRINUSE` na porta 4100 (instância anterior
   ainda viva), não pressão de memória como se supôs primeiro.

## 10. O que continua NÃO validado

| Item | Estado |
|---|---|
| Ganho de qualidade comprovado | **NÃO.** Ver seção 11 |
| A/B/C com 6 cenários e avaliação humana cega | **NÃO EXECUTADO** |
| Referências pelo frontend (upload) | **NÃO TESTADO** |
| Múltiplas referências com papéis distintos | **NÃO TESTADO** |
| Refresh (F5) durante geração | **NÃO TESTADO** |
| Cancelamento pela UI | Backend provado; **botão na UI não testado** |
| ComfyUI offline | **NÃO TESTADO** |
| 2 usuários / isolamento | **NÃO TESTADO** — e ver o achado de segurança abaixo |
| 5 jobs simultâneos (carga) | **NÃO TESTADO** |
| Calibração de thresholds por distribuição | **NÃO FEITA** (amostra pequena demais) |
| Carrossel/vídeo no loop | Fora de escopo desta fase, por decisão |

**Achado de segurança (pré-existente, não introduzido aqui):**
`apps/api/src/lib/access.ts:15` — `hasClientAccess()` é um stub que devolve
`true` para qualquer usuário e qualquer cliente. Todo endpoint do Studio que
"protege" o cliente com essa função não protege nada: qualquer colaborador
autenticado age sobre qualquer cliente. O teste de isolamento entre usuários
(FRONT 09) não faz sentido antes de isso existir de verdade.

## 11. Qualidade: o que os dados dizem

Comparação A/B no MESMO briefing (frasco de perfume em mármore):

| | Pipeline antigo (flag OFF) | QA loop + upscale (flag ON) |
|---|---|---|
| Entrega | 1328x752 (1,0 MP), com letterbox | 2048x1728 (3,5 MP), sem letterbox |
| Nota do crítico | 7,5 | 8,5 (antes do upscale) |
| Tentativas | 1 | 1 (aprovou de primeira) |
| Tempo total | 400 s | 292 s |
| Upscale + final QA | não existe | `restore`, `kept: true`, 12,7 s |

**Isto NÃO prova ganho de qualidade.** É n=1, com SEED DIFERENTE em cada
lado - ou seja, duas imagens diferentes, não a mesma imagem com e sem
tratamento. O tempo menor do lado ON é artefato de o modelo já estar quente,
não do pipeline. A única diferença estruturalmente atribuível ao pipeline
novo é a resolução final e o laudo persistido.

Pior: no único caso em que o loop de fato iterou (job `STU-MU4I35VT5AB437`),
as notas foram **7,5 -> 7,5 -> 7,0**. O loop não melhorou a peça; entregou a
primeira tentativa. Em outro caso o loop **piorou** a peça antes da correção
do bug 1. Não há, hoje, uma única execução em que a tentativa 2 tenha
superado a 1.

## 12. Falsos positivos/negativos do crítico (qwen3.5:9b), medidos

| Tipo | Caso |
|---|---|
| Falso negativo grave | Declarou a placa truncada "Residencial HABIANA" como *"perfectly legible and correctly spelled"* |
| Falso negativo | Não viu os defeitos de mão na foto de família que o 35B viu |
| Falso positivo | `anatomy: 4.0` com `hands: 10`/`face: 10` numa foto de produto correta |
| Falso negativo | Não apontou o letterbox (tarja preta) na peça do baseline A/B |
| Inconsistência de rótulo | Classificou defeito de mão como `region: "product"` |
| Ponto forte | Determinístico a temp 0; localizou dedos fundidos e orelha assimétrica corretamente |

## 13. Troubleshooting

**Studio não processa nada.** Confira se existe worker consumindo a fila:
`curl -H "Authorization: Bearer $NODE_SECRET" http://<host>:4100/metrics`.
Em 16/09/2026 não havia worker no ar e um job estava parado em `wait` desde
14/09 — nada expira job enfileirado sozinho.

**Geração levou 6 minutos ou mais.** Provável carga fria dos pesos (389 s
medidos). Confira se algo mais ocupou a VRAM no meio (um VLM, um job de
vídeo H3) — `curl http://<gpu>:11434/api/ps`.

**Crítico não responde / resposta vazia.** Confirme `think:false` e que o
modelo tem `vision` em `capabilities`. Modelo sem visão aceita a chamada e
descreve o nada.

**Imagem feita no ComfyUI não aparece na galeria.** É esperado: só job do
Studio grava `studio_assets`. Use:

```bash
pnpm --filter @desigual-os/studio-node exec tsx scripts/import-comfyui-outputs.ts --cliente "Nome"           # simula
pnpm --filter @desigual-os/studio-node exec tsx scripts/import-comfyui-outputs.ts --cliente "Nome" --aplicar # grava
```

Idempotente por `filename` dentro do cliente; rodar de novo não duplica.

---

## 14. Como ligar e desligar

```bash
# nodes/studio-node/.env
STUDIO_AUTONOMOUS_QA=true        # false (default) = pipeline antigo, rollback imediato
STUDIO_QA_MAX_ATTEMPTS=3         # 1 = critica e registra o score, sem refazer
STUDIO_CRITIC_PROVIDER=ollama    # ou 'anthropic' (usa o visual-qa.ts existente)
CRITIC_OLLAMA_URL=http://127.0.0.1:11434   # NÃO o host da GPU (seção 2)
CRITIC_OLLAMA_MODEL=qwen3.5:9b
```

Com a flag desligada o worker se comporta exatamente como antes: mesma
chamada de geração, mesmo metadata (com `qa: null`), nenhum caminho novo.

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

## 8. O que NÃO está validado

Honestidade explícita, na forma que o plano pediu:

| Item | Estado |
|---|---|
| Loop completo com correção real (attempt 1 reprova → attempt 2 melhora) | **NÃO VALIDADO AO VIVO.** A única execução real aprovou na 1ª tentativa (score 9,2). O caminho de correção tem cobertura de teste unitário, não de GPU |
| Crítico em caso difícil (mão/rosto/identidade) ao vivo | **NÃO VALIDADO.** A execução real foi um tênis em fundo cinza — sem anatomia e sem texto, o caso fácil |
| Upscale só após aprovação / final QA | **NÃO IMPLEMENTADO** neste passo. `selectFinishStrategy` continua sem chamador; `finish_master_v1` segue bloqueado por falta do custom node |
| Testes reais pelo frontend (TESTE FRONT 01–10) | **BLOQUEADO**: sem credencial de login. A suíte E2E do repo só testa o portão de auth, não autentica |
| Benchmark A/B (pipeline atual × QA loop) | **NÃO EXECUTADO** |
| `lockDuration` sob loop de 3 tentativas | **NÃO TESTADO** |
| Carrossel/vídeo no loop | **FORA DE ESCOPO** por ora: carrossel tem âncora entre slides e refazer um slide do meio quebra a continuidade |

---

## 9. Troubleshooting

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

## 10. Como ligar e desligar

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

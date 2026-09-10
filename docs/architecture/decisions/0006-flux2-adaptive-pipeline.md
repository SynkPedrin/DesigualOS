# ADR 0006: Motor de imagem migra pra FLUX.2 Dev; pipeline adaptativo (Registry/Profiles/Routers)

## Contexto

O motor de imagem do Studio (`nodes/studio-node/src/comfyui-client.ts`) era hardcoded pra
um único checkpoint FLUX.1-dev (`CheckpointLoaderSimple`), com steps/denoise/guidance
fixos espalhados pelo código, sem noção de profile de qualidade (draft/standard/master),
sem router de workflow, sem finish condicional (o único caminho de upscale era um
`ImageUpscaleWithModel` simples, sempre manual). Um plano de evolução (mensagem de
08/09/2026) pedia uma arquitetura adaptativa completa: CreativeSpec, Workflow Router,
Quality Profiles, Finish Router (FAST/RESTORE/MASTER), Visual/Motion QA, Model/Workflow
Registry, idempotência, e a adoção de um conjunto de workflows de referência (anexados
à mensagem) desenhados pra FLUX.1-dev com T5+CLIP-L, edição por Kontext, e finish via
`UltimateSDUpscale`.

**Checagem ao vivo contra a GPU de produção** (`GET /object_info`,
`100.107.198.50:8188`, ComfyUI 0.33.4) mostrou que `flux1-dev.safetensors`,
`t5xxl_fp16.safetensors`, `clip_l.safetensors` e o modelo de edição Kontext **não estão
instalados** - só `flux2_dev_fp8mixed.safetensors` (+ text encoder Mistral
`mistral_3_small_flux2_bf16.safetensors`) existe pra imagem. `UltimateSDUpscale`
(custom node do finish generativo) também não está instalado.

## Decisões

1. **Motor de imagem: FLUX.2 Dev**, não FLUX.1-dev. `UNETLoader` + `CLIPLoader`
   (`type: "flux2"`) + `VAELoader` no lugar do `CheckpointLoaderSimple` único;
   `EmptyFlux2LatentImage` no lugar de `EmptySD3LatentImage`. T2I usa
   `Flux2Scheduler` + `SamplerCustomAdvanced`; edição usa de um a dez
   `ReferenceLatent` encadeados, conforme os templates oficiais do ComfyUI.
2. **Model Registry** (`model-registry.ts`) e **Workflow Registry**
   (`workflow-registry.ts`) centralizam nome de arquivo/loader/capability/versão -
   `isWorkflowAvailable()` deriva disponibilidade a partir do que está `enabled` no
   Model Registry, não precisa marcar os dois lugares. Entradas `flux1-dev-*` e
   `upscale-clearreality-v1` ficam registradas com `enabled: false` e
   `disabledReason` documentando a checagem real que as desabilitou - não foram
   deletadas, só marcadas indisponíveis.
3. **`comfyui-validate.ts`** confere todo `class_type`/arquivo de modelo `enabled` contra
   `/object_info` real na subida do worker; loga gaps, não aborta a subida (alguns
   workflows ficam intencionalmente bloqueados hoje).
4. **Quality Profiles de 3 níveis** (`quality-profiles.ts`: draft/standard/master)
   substituem o antigo `STEPS_BY_QUALITY` de 2 níveis que colapsava `draft` em
   `standard`. Wire-level (`studio_jobs.quality_preset`) continua
   `draft|standard|high` por compatibilidade com dados já gravados -
   `qualityProfileFromPreset()` mapeia `high` → `master` internamente.
5. **Finish Router** (`finish.ts:selectFinishStrategy`): FAST (resize+sharpen+grão) é o
   caminho padrão; RESTORE (upscale model + resize) só quando a resolução de origem é
   menor que o alvo; MASTER (difusão via `UltimateSDUpscale`) só quando QA sinaliza
   falta de detalhe real - nunca roda automaticamente depois de toda imagem. MASTER
   fica bloqueado no `UltimateSDUpscale` ausente (falha alto e claro ao ser chamado,
   não silenciosamente substituído).
6. **Edição é nativa do FLUX.2 Dev.** O Workflow Router envia referência, variação ou
   edição para `edit_flux2_multireference_v2`; o modelo instalado suporta composição
   multi-reference sem depender do FLUX.1 Kontext. O registro Kontext permanece apenas
   para auditoria e reprodução histórica.
7. **Idempotência de infraestrutura**: `processStudioJob` curto-circuita se
   `studio_jobs.status` já é `completed` (retry do BullMQ não re-gera). Fingerprint de
   geração (`idempotency.ts`) gravado em `studio_assets.metadata` pra auditoria - dedup
   por fingerprint ENTRE jobs diferentes (ex.: dois `POST /studio/jobs` idênticos por
   retry de rede do cliente) não foi implementado na API, só o caso mais comum (mesmo
   jobId reentregue).
8. **Visual QA real** (`visual-qa.ts`) via visão do Claude
   (`@anthropic-ai/sdk`, mesmo padrão do classifier do Router,
   `packages/router/src/classifier.ts`) - falha alto (`VisualQAUnavailableError`) sem
   `ANTHROPIC_API_KEY`, nunca inventa score. Não testado contra a API real (sem chave
   disponível no ambiente de desenvolvimento) nem chamado automaticamente pelo pipeline
   de job ainda - interface pronta, integração fica pendente.
9. **H3 Master** (`video-h3.ts:generateVideoH3Master`) adicionado ao lado do H3 Draft já
   existente (GGUF+turbo) - é o único dos workflows de referência originais que roda sem
   nenhuma adaptação nesta GPU. Staging Keyframe→Draft→Motion QA→Master fica descrito em
   `video-router.ts` (função pura de decisão), mas não wired no processamento real do
   job ainda - Motion QA real (análise de frames de vídeo) não foi implementada.

## Achado de performance (não previsto, medido ao vivo)

Medido step a step via WebSocket do ComfyUI (o evento `progress`; `/history` sozinho não
mostra progresso dentro de um node):

| Config | Resultado |
|---|---|
| 896×1120 (1,0 MP), 24 steps, modelo residente | 87s — 1º step 29,6s, demais **1,92s constante** |
| 1088×1360 (1,48 MP), 10 steps, após troca de shape | 147s — 1º step **108s**, demais ~2,7s |
| Ponta a ponta, modelo residente | **38,5s / 38,9s** |
| Ponta a ponta, modelo precisando recarregar | **500,0s / 500,8s** |

**O custo dominante é a residência do modelo na VRAM, não a resolução nem o step count**
— 500s apareceu tanto em 0,26 MP quanto em 1,0 MP (4× mais pixels, mesmo tempo). O
FLUX.2 Dev ocupa ~18,6GB dos ~24GB do card, e a mesma GPU roda os jobs de vídeo H3, que
carregam outros pesos e o expulsam; alternar entre as duas famílias é o que gera o reload
de ~460s. Isso é precisamente o que a seção 26 do plano (Model Affinity Queue) previa, e
o que `--cache-lru` no ComfyUI atacaria — nenhum dos dois existe hoje.

Custo secundário real: o **primeiro step após trocar de resolução** (108s em 1088×1360),
por alocar shape novo com a VRAM perto do teto. É por isso que o passe de refino ficou
só no `master` (ver `quality-profiles.ts`), em vez de rodar em toda imagem — o que
também é o que a seção 5 do plano pedia ("tornar o refine condicional").

**Correção de rumo registrada**: uma análise anterior desta mesma sessão concluiu que
~1,0 MP era inviável (steps erráticos, 7s→46s) e chegou a recalibrar os profiles pra
0,26 MP. Estava errado — aquelas medições foram feitas com a GPU disputada, inclusive com
um job real de vídeo de produção rodando junto (descoberto depois, inspecionando a fila).
Revertido: 1,0 MP roda com step constante de 1,92s em estado limpo.

## Consequência

O T2I legado foi rodado de ponta a ponta na resolução final (896×1120 → refino
1088×1360). A versão nativa v2 e o fluxo multi-reference passaram por validação de grafo,
tipos e testes automatizados, mas ainda precisam de benchmark visual ao vivo com o
ComfyUI ligado. O de vídeo (H3 Master) tem o grafo validado contra `/object_info` mas não foi
rodado até o fim (a GPU estava ocupada com job real de produção). O de finish generativo
fica bloqueado até alguém instalar `ComfyUI_UltimateSDUpscale`; Kontext é legado e não
é necessário para a edição FLUX.2. O pipeline agora tem infraestrutura real de profile/router/registry/idempotência,
mas o plano de evolução
completo (Visual/Motion QA wired no job, Model Affinity
Queue, benchmark de Sage Attention, frontend de profile semântico) não foi todo
implementado numa sessão só - ver `docs/comfyui-workflows/README.md` seção 5 pra lista
de pendências reais.

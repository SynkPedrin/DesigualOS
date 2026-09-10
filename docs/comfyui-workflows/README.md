# OS Studio — Pipeline ComfyUI (RTX 4090 24 GB / 96 GB RAM)

Grafos em formato **API** (`/prompt`), extraídos do código real que roda em produção
(`nodes/studio-node/src/comfyui-client.ts`, `finish.ts`, `video-h3.ts`) — não retype
manual. Todos validados: JSON íntegro, nenhuma referência de nó pendente.

**Este README documenta o estado REAL confirmado ao vivo contra a GPU de produção em
08-09/09/2026** (`GET /object_info`, `GET /system_stats` em `100.107.198.50:8188`, ComfyUI
0.33.4). Uma versão anterior deste plano assumia FLUX.1-dev (T5+CLIP-L, Kontext,
UltimateSDUpscale) como motor — **isso não é o que está instalado nesta máquina hoje**.
O motor real é **FLUX.2 Dev**. Ver seção 0.

| Arquivo | Função | Status real (08/09/2026) |
|---|---|---|
| `t2i_flux2_native_v2` | Texto → imagem com `Flux2Scheduler` e `SamplerCustomAdvanced` | ✅ concluído ao vivo: 1232×816, 20 steps, seed 20260909, PNG de 1,65 MB |
| `edit_flux2_multireference_v2` | Edição/composição com 1 a 10 `ReferenceLatent` | ⚠️ grafo aceito ao vivo e todos os nós preparatórios executados; imagem final pendente após indisponibilidade do processo remoto durante o sampler |
| `3-imagem-para-video-h3.json` | H3 Draft: GGUF Q3 + LoRA turbo, 8 steps | ✅ roda (era o único caminho de vídeo antes desta sessão; não retestado aqui) |
| `4-upscale.json` | Upscale simples (RealESRGAN, sem difusão) | ✅ roda (não usa FLUX.2, sem o custo de residência de modelo) |
| `5-video-h3-master.json` | H3 Master: unet int8 pruned sem turbo, 25 steps, res_multistep, áudio | ✅ grafo validado contra `/object_info`; **não rodado até o fim nesta sessão** (a GPU estava ocupada com job real de produção) |
| `edit_flux_kontext_v1` | Legado FLUX.1 Kontext | ❌ bloqueado e mantido apenas para reproduzir jobs antigos |
| *(finish master / upscale generativo)* | `UltimateSDUpscale` + refino por difusão | ❌ **bloqueado** — custom node não instalado |

---

## 0. O que mudou: FLUX.1-dev (planejado) vs FLUX.2 Dev (real)

Um levantamento anterior deste plano listava `flux1-dev.safetensors` +
`t5xxl_fp16.safetensors` + `clip_l.safetensors` + `flux1-dev-kontext_fp8_scaled.safetensors`
+ `4x-ClearRealityV1.pth` como os arquivos do motor. Checagem ao vivo contra
`GET /object_info` (`UNETLoader.unet_name`, `DualCLIPLoader.clip_name1/2`,
`UpscaleModelLoader.model_name`) mostrou que **nenhum desses arquivos existe nesta GPU**.
O que existe:

| Papel | Arquivo real instalado | Loader |
|---|---|---|
| Diffusion model (imagem) | `flux2_dev_fp8mixed.safetensors` | `UNETLoader` |
| Text encoder (imagem) | `mistral_3_small_flux2_bf16.safetensors` | `CLIPLoader` (`type: "flux2"`) |
| VAE (imagem) | `flux2-vae.safetensors` | `VAELoader` |
| Diffusion model (vídeo, master) | `minimax_h3_fl2va_pruned_int8_convrot.safetensors` | `UNETLoader` |
| Diffusion model (vídeo, draft) | `MiniMax-H3-FL2VA-Q3_K_M.gguf` (+ `MiniMax-H3-FL2VA-Q4_K_M.gguf`) | `UnetLoaderGGUF` |
| LoRA turbo (vídeo, draft) | `minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors` | `LoraLoaderModelOnly` |
| Text encoder (vídeo) | `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | `CLIPLoader` (`type: "minimax"`) |
| VAE vídeo/áudio | `minimax_h3_video_vae_fp16.safetensors` / `minimax_h3_audio_vae_fp32.safetensors` | `VAELoader` |
| Upscale model | `RealESRGAN_x4.pth`, `4x-UltraSharp.pth`, `4x-AnimeSharp.pth`, `4x_NMKD-Siax_200k.pth`, entre outros | `UpscaleModelLoader` |

Fonte única desse mapeamento: `nodes/studio-node/src/model-registry.ts` (`MODEL_REGISTRY`).
Entradas `enabled: false` nesse arquivo documentam o que os planos anteriores assumiam mas
não está instalado (flux1-dev, T5+CLIP-L, Kontext fp8, ClearRealityV1) — mantidas só como
referência caso alguém instale esses arquivos depois.

FLUX.2 Dev não tem checkpoint único: em vez de um `CheckpointLoaderSimple`, o modelo, o
text encoder e o VAE são três arquivos carregados separadamente (`UNETLoader` +
`CLIPLoader` + `VAELoader`). O latente também muda: `EmptyFlux2LatentImage` no lugar de
`EmptySD3LatentImage`, múltiplos de 16 (igual antes).

---

## 1. Edição nativa e bloqueios legados

### Edição e multi-reference FLUX.2

O FLUX.2 Dev instalado já faz edição e composição no próprio modelo. O Studio encadeia
até dez imagens através de `ReferenceLatent`, descreve o papel de cada referência no
prompt e gera sobre um `EmptyFlux2LatentImage`. O Workflow Router envia toda variação ou
edição com referência para `edit_flux2_multireference_v2`. O antigo Kontext continua
bloqueado e não participa de jobs novos.

### Finish Master (upscale generativo)

`GET /object_info/UltimateSDUpscale` devolve `{}` (vazio) — o custom node
`ComfyUI_UltimateSDUpscale` não está instalado. `4x-ClearRealityV1.pth` também não está
na lista de upscale models. `finish.ts` monta o grafo certo (fiel ao workflow original)
mas falha alto e claro, com instrução do que instalar, em vez de tentar um substituto
silencioso ou destravar sozinho.

**Pra destravar:** instalar `ComfyUI_UltimateSDUpscale` (custom node) e baixar
`4x-ClearRealityV1.pth` (ou trocar por um dos upscale models já instalados — ver
`model-registry.ts:upscale-ultrasharp-4x` como alternativa mais próxima).

---

## 2. VRAM: achado real de 08/09/2026

`system_stats` reportou o card como `RTX 4090`, `vram_total ~25.8GB`. O ComfyUI sobe
**sem** nenhuma das flags que o plano original recomendava
(`--use-sage-attention --fast --reserve-vram 0.6 --cache-lru 3` — `argv` confirmado via
`/system_stats` não traz nenhuma delas).

### O que foi medido (step a step, via WebSocket do ComfyUI)

Polling de `/history` não mostra progresso dentro de um node; o evento `progress` do
WebSocket mostra. Com isso dá pra separar "modelo carregando" de "sampling lento":

| Config | Resultado |
|---|---|
| 896×1120 (1,0 MP), 24 steps, modelo residente | **87s** — 1º step 29,6s, demais **1,92s constante** (23x sem variar) |
| 1088×1360 (1,48 MP), 10 steps, após troca de shape | **147s** — 1º step **108s**, demais ~2,7s constante |
| Ponta a ponta, modelo JÁ RESIDENTE na VRAM | **38,5s / 38,9s** (duas rodadas) |
| Ponta a ponta, modelo precisando (re)carregar | **500,0s / 500,8s** (duas rodadas) |

### A conclusão real

**O custo dominante não é resolução nem step count — é o modelo estar ou não residente
na VRAM.** Repare que 500s apareceu tanto em 0,26 MP quanto em 1,0 MP: 4× mais pixels,
mesmo tempo total. O que muda o patamar é o (re)load de ~460s. Com o modelo residente, o
tempo por step é rápido e absolutamente estável em qualquer uma das resoluções testadas.

Dois custos secundários, medidos e reais:
- **primeiro step depois de trocar a resolução** (108s em 1088×1360): alocar um shape de
  tensor novo com a VRAM perto do teto é caro. É por isso que o passe de refino só vale
  no `master`, não em toda imagem — ver `quality-profiles.ts`.
- **troca de família de modelo**: esta MESMA GPU roda os jobs de vídeo H3, que carregam
  outro conjunto de pesos e expulsam o FLUX.2 da VRAM. Intercalar Flux e H3 é o que gera
  o reload de ~460s. É exatamente o problema que a seção 26 do plano (Model Affinity
  Queue) descreve.

> ⚠️ Uma análise anterior desta sessão concluiu que ~1,0 MP era inviável (steps crescendo
> de forma errática, 7s→46s) e chegou a recalibrar os profiles pra 0,26 MP. **Isso estava
> errado e foi revertido.** Aquelas medições foram feitas com a GPU disputada — inclusive
> com um job real de vídeo de produção rodando em paralelo, descoberto depois na fila. Em
> estado limpo, 1,0 MP roda com step constante de 1,92s.

### Smoke test nativo de 09/09/2026

- Texto → imagem concluiu com o grafo oficial nativo, em 1232×816, 20 steps e
  seed reproduzível `20260909`.
- O primeiro envio multi-reference revelou que a versão instalada exige
  `resolution_steps` em `ImageScaleToTotalPixels`; o adaptador e o teste de contrato
  foram corrigidos.
- Após a correção, o ComfyUI aceitou e executou `LoadImage`, resize, `VAEEncode`,
  `ReferenceLatent`, encoder, loaders, scheduler e guider, chegando ao
  `SamplerCustomAdvanced`. A primeira tentativa foi interrompida pelo antigo limite de
  13 minutos; o limite passou para 20 minutos, abaixo do lock de 25 minutos.
- Na repetição, o host continuou acessível mas a porta do ComfyUI ficou indisponível
  durante o sampler. Portanto a compatibilidade estrutural está confirmada, mas a
  avaliação visual final de preservação multi-reference ainda precisa ser repetida
  depois de religar o processo no Pinokio.

### Recomendações (em ordem de retorno)

1. **Agrupar jobs por família de modelo** (Model Affinity Queue, seção 26 do plano) — é o
   que ataca o custo de ~460s de reload, que domina tudo o mais.
2. **Ligar as flags que este ComfyUI nunca teve** (`--cache-lru 3` pra manter modelos
   residentes, `--reserve-vram 0.6`, `--fast`, Sage Attention — nenhuma ativa hoje,
   confirmado via `argv` em `/system_stats`). `--cache-lru` ataca o mesmo custo do item 1.
3. Só depois disso vale mexer em resolução: ela não é o gargalo.

---

## 3. Grafos

Ver a tabela no topo. Cada arquivo é o grafo real que `comfyui-client.ts`/`finish.ts`/
`video-h3.ts` monta (node IDs iguais às chaves usadas no código, não números genéricos) -
gerado a partir do código, não escrito à mão, pra nunca divergir silenciosamente.

`1-texto-para-imagem.json` e `2-imagem-para-imagem.json` mostram o profile `standard`
como exemplo; `draft`/`master` mudam steps/resolução/denoise conforme
`nodes/studio-node/src/quality-profiles.ts` (`QUALITY_PROFILES` centraliza todos os
números — nunca hardcoded em mais de um lugar).

---

## 4. Robustez de orquestração (o que já está implementado)

- **Seeds nunca fixas em produção** (exceto "Regenerar exatamente") — sorteada por
  `generateImageViaComfyUI`/`generateVideoH3`, gravada em `studio_assets.metadata.seed`.
- **Idempotência de infraestrutura**: `processStudioJob` checa se `studio_jobs.status`
  já é `completed` antes de gerar de novo (retry do BullMQ não paga GPU duas vezes) -
  ver `nodes/studio-node/src/idempotency.ts` (`computeGenerationFingerprint`, gravado em
  `studio_assets.metadata.generation_fingerprint` pra auditoria/dedup futuro).
- **Validação de instalação na subida**: `nodes/studio-node/src/comfyui-validate.ts`
  confere todo `class_type` usado por qualquer workflow do registry e todo arquivo de
  modelo `enabled` contra `/object_info` real, loga gaps claros (não aborta a subida -
  já sabemos que `finish_master_v1` está bloqueado e isso é esperado).
- **Model Registry / Workflow Registry**: `nodes/studio-node/src/model-registry.ts` e
  `workflow-registry.ts` são a fonte única de nomes de arquivo/versão/capability -
  `isWorkflowAvailable()` deriva disponibilidade automaticamente (nenhum workflow fica
  "esquecido" marcado disponível quando o modelo que ele usa foi desabilitado).
- **Finish Router**: `finish.ts:selectFinishStrategy` decide FAST vs RESTORE vs MASTER
  por resolução de origem/destino + flag de QA (`detailInsufficient`), nunca roda upscale
  generativo numa imagem que já tem resolução e detalhe suficientes.
- **Fallback de decode**: se o decode de vídeo estourar VRAM, `VAEDecodeTiled` está
  confirmado instalado nesta GPU (`tile_size`, `overlap`, `temporal_size`,
  `temporal_overlap`) - não implementado no código ainda, documentado aqui como opção.
- **Licença**: MiniMax H3 comercial exige licença via Comfy (revendedora oficial) -
  FLUX.2 Dev segue a licença não-comercial da Black Forest Labs (mesma categoria do
  FLUX.1-dev que documentava isso antes).

---

## 5. Pendências reais (não implementadas nesta sessão)

- **Custo de residência do modelo (~460s de reload quando o FLUX.2 é expulso da VRAM)**:
  não é bug de código, é escalonamento. Ataca-se com Model Affinity Queue (seção 26 do
  plano, NÃO implementada) e/ou `--cache-lru` no ComfyUI. Ver seção 2.
- **Máscara de edição localizada**: o contrato reconhece uma referência `mask`, mas a
  aplicação da máscara no grafo ainda não está ligada. Sem máscara, a preservação é
  semântica e não pixel a pixel.
- **Finish Master**: grafo pronto, bloqueado no custom node ausente.
- **Motion QA real**: `video-router.ts` define o staging (Keyframe → Draft → Motion QA →
  Master) mas a avaliação real de flicker/coerência temporal sobre frames de vídeo não
  foi implementada - o gate é conservador (nunca promove sozinho sem aprovação explícita).
- **Visual QA**: implementado de verdade via visão do Claude
  (`nodes/studio-node/src/visual-qa.ts`), mas **não testado contra a API real** nesta
  sessão (sem `ANTHROPIC_API_KEY` disponível no ambiente onde foi escrito) nem wired no
  pipeline de job (`index.ts` ainda não chama `runVisualQA` automaticamente).
- **Model Affinity Queue / scheduler por família de modelo**: não implementado -
  `concurrency: 1` já evita a contenção de VRAM observada, mas não agrupa por família.
- **Sage Attention / `--fast` / benchmark de otimizações**: não instalado, não medido.
  Ver seção 2 - a GPU roda hoje sem nenhuma das flags recomendadas.
- **Frontend de referência**: já permite até dez arquivos e seleção de cenário, pessoa,
  produto, estilo, composição, logo ou máscara. Controle fino de fidelidade e posição
  da logo ainda é inferido pelo OTTO/prompt.

# OS Studio — Pipeline ComfyUI (RTX 4090 24 GB / 96 GB RAM)

Grafos em formato **API** (`/prompt`), prontos para orquestração programática.
Todos validados: JSON íntegro, nenhuma referência de nó pendente.

| Arquivo | Função | Tempo aprox. 4090 |
|---|---|---|
| `01_t2i_flux_editorial.json` | Texto → imagem, dois estágios (base + refino) | ~55–75 s |
| `02_i2i_flux_reference.json` | Imagem → imagem por denoise (variação de estilo) | ~40 s |
| `03_edit_flux_kontext.json` | Edição por instrução preservando a cena | ~35 s |
| `04_finish_upscale_refine.json` | Upscale + refino tiled + grão (entrega final) | ~2–4 min |
| `05_i2v_minimax_h3_quality.json` | Primeiro frame → vídeo 5,2 s com áudio estéreo | ~8–14 min |

---

## 1. Flags de inicialização (Pinokio)

Edite o script de start do ComfyUI no Pinokio e acrescente:

```
--use-sage-attention --fast --reserve-vram 0.6 --cache-lru 3
```

E no ambiente:

```
PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
```

Por quê:

- **`--use-sage-attention`** — segundo a documentação da Comfy, o Sage Attention pode aproximadamente **dobrar a velocidade de geração do H3 com perda mínima de qualidade**. É opcional, então instale o pacote antes: baixe o wheel de `SageAttention` que corresponde à sua versão de PyTorch/CUDA e instale com `pip install <wheel>` **usando o terminal do Pinokio** (senão vai para o Python errado). Mensagens de fallback de dtype no console são esperadas — algumas camadas do H3 rodam em outros dtypes e voltam para a atenção padrão.
- **`--fast`** — habilita acumulação fp16 e matmul fp8. A 4090 tem tensor cores fp8; combinado com `weight_dtype: fp8_e4m3fn_fast` no `UNETLoader`, é ganho grátis de velocidade.
- **`--reserve-vram 0.6`** — margem para o decode do VAE de vídeo, que é onde 124 frames a 768×1344 costumam estourar 24 GB.
- **`--cache-lru 3`** — com 96 GB de RAM, mantém três modelos residentes. Trocar entre Flux e H3 deixa de custar 40 s de disco.

---

## 2. Assets necessários

### Flux (imagem)

| Arquivo | Pasta | Observação |
|---|---|---|
| `flux1-dev.safetensors` | `models/unet/` | O **fp16 completo**. Carregue com `weight_dtype: fp8_e4m3fn_fast` — quantiza na hora, sem perder o T5. |
| `t5xxl_fp16.safetensors` | `models/text_encoders/` | O upgrade mais importante do pacote. |
| `clip_l.safetensors` | `models/text_encoders/` | |
| `ae.safetensors` | `models/vae/` | VAE do Flux, separado. |
| `flux1-dev-kontext_fp8_scaled.safetensors` | `models/unet/` | Só para o grafo 03. |
| `4x-ClearRealityV1.pth` | `models/upscale_models/` | Substitui o RealESRGAN. Alternativas: `4x_NMKD-Siax_200k`, `4xUltrasharp`. |

> **O ponto central:** o `flux1-dev-fp8.safetensors` que você usava é um checkpoint tudo-em-um com o **T5 já quantizado em fp8**. O T5 é o que interpreta o prompt. Trocar para `t5xxl_fp16` rodando na CPU (`device: "cpu"`) libera os 24 GB inteiros para o modelo de difusão e melhora aderência a prompt de forma bem visível — frases compostas, relações espaciais, contagem de objetos. Custa ~4 s por encode na CPU, e o Comfy faz cache do resultado quando o prompt não muda.

### MiniMax H3 (vídeo)

Os arquivos oficiais ficam em `Comfy-Org/MiniMax-H3` no Hugging Face:

| Arquivo | Pasta |
|---|---|
| `minimax_h3_fl2va_pruned_int8_convrot.safetensors` | `models/diffusion_models/` |
| `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | `models/text_encoders/` |
| `minimax_h3_video_vae_fp16.safetensors` | `models/vae/` |
| `minimax_h3_audio_vae_fp32.safetensors` | `models/vae/` |

Requer **ComfyUI 0.30.0 ou superior**.

Se quiser manter GGUF, troque só o nó `unet` por:

```json
"unet": {
  "class_type": "UnetLoaderGGUF",
  "inputs": { "unet_name": "MiniMax-H3-FL2VA-Q5_K_M.gguf" }
}
```

Suba de `Q3_K_M` para `Q5_K_M` ou `Q6_K`. Existem quants pruned de 8,9 GB a 21,6 GB — com o encoder de texto na CPU, a 4090 acomoda a faixa alta, e a diferença de Q3 para Q5 é bem perceptível em rostos, mãos e texto.

### Custom nodes

- `ComfyUI-GGUF` (city96) — só se usar a variante GGUF
- `ComfyUI_UltimateSDUpscale` — grafo 04
- `ComfyUI-KJNodes` — opcional, se preferir o nó `Patch Sage Attention` à flag global

---

## 3. Tabela de mudanças

### 01 — Texto para imagem

| Antes | Agora | Motivo |
|---|---|---|
| `CheckpointLoaderSimple` fp8 | `UNETLoader` + `DualCLIPLoader` + `VAELoader` | T5 em fp16, não fp8 |
| T5 na GPU | `device: "cpu"` | Libera 10 GB de VRAM |
| `1080x1350` | `896x1152` → refino `1120x1440` | Múltiplos de 16; 1,03 MP fica na faixa de treino |
| `CLIPTextEncode` vazio | `ConditioningZeroOut` | Elimina um encode inteiro do T5 |
| — | `ModelSamplingFlux` por estágio | Shift calibrado para a resolução real de cada passe |
| `guidance 3.5` | `2.8` base / `2.2` refino | Acima de ~3.2 o Flux endurece a pele e satura |
| `scheduler simple` | `beta` | Mais detalhe nas frequências médias |
| 28 steps, 1 passe | 30 + 16 @ denoise 0.45 | Hires-fix: o refino é onde nasce a micro-textura |
| Prompt em tags | Prosa descritiva | T5 é encoder de linguagem, não CLIP |
| `filename_prefix` fixo | `%date:yyyy-MM-dd%/` | Organização por data |

### 02 — Imagem para imagem

| Antes | Agora | Motivo |
|---|---|---|
| Sem resize | `ImageScaleToTotalPixels` 1.0 MP | Latente na grade correta, escala previsível |
| `denoise 0.8` | `0.55` | 0.8 apaga a referência |

Escala prática: **0.30–0.40** só recolore e ajusta luz; **0.50–0.60** troca cenário mantendo composição; **0.70+** é praticamente geração nova.

### 03 — Kontext (novo)

Denoise é a ferramenta errada para "muda X, preserva o resto" — ele degrada tudo uniformemente. O Kontext injeta a imagem como **tokens de contexto** via `ReferenceLatent`, então o que você não mencionou no prompt fica intacto. Escreva imperativo, e liste explicitamente o que preservar.

Detalhe do grafo: o `latent_image` do sampler vem do `VAEEncode` com `denoise: 1.0`. Isso é intencional — em denoise 1.0 o ruído sobrescreve o conteúdo por completo, então o encode serve apenas para carimbar as dimensões corretas do latente. O condicionamento da imagem vem inteiro pelo `ReferenceLatent`.

### 04 — Entrega final

| Antes | Agora | Motivo |
|---|---|---|
| `RealESRGAN_x4` | `4x-ClearRealityV1` | ESRGAN suaviza pele e tecido |
| Só upscale | `UltimateSDUpscale` denoise 0.22 | Upscaler interpola; difusão tiled **cria** detalhe |
| Sem downscale | `ImageScale` → 1080×1350 | 4× de 1080px = 4320px inútil |
| Sem pós | `ImageSharpen` + `ImageAddNoise` 0.025 | O grão é o que mata o aspecto plástico de IA |

O grão é o passo mais subestimado. Saída digital limpa lê como "IA"; 2–3% de ruído monocromático lê como filme. Se `ImageAddNoise` não existir na sua build, remova o nó e ligue `save.images` direto em `sharpen`.

### 05 — Vídeo

| Antes | Agora | Motivo |
|---|---|---|
| GGUF `Q3_K_M` | int8 pruned oficial | Q3 é o quant mais lossy da série |
| LoRA turbo 8 steps | **Sem LoRA**, 25 steps | O turbo troca qualidade de movimento **e de áudio** por velocidade |
| Primeiro frame cru | `ImageScale` → 768×1344 exatos | Sem isso, o frame estica |
| Negativas no prompt | Só forma afirmativa | Sem condicionamento negativo, listar "no zoom, no shake" pode induzir esses movimentos |
| Prompt sem áudio | Bloco de áudio explícito | O H3 gera áudio estéreo nativo num único forward pass; sem instrução ele improvisa |
| Prompt achatado | Cena → planos com tempo → câmera → áudio | Estrutura oficial do modelo |
| `length: 124` | `length: 124` ✅ | Já estava certo: a grade é 17k+5, e 17×7+5=124 (≈5,17 s) |

Mantenha o turbo como **modo rascunho**: adicione de volta o `LoraLoaderModelOnly` e baixe `scheduler.steps` para 8 para explorar seeds, depois refaça o keeper em 25 steps.

---

## 4. Regras de prompt para o H3

A estrutura que o modelo espera:

1. **Cena inteira primeiro** — local, sujeito, o que acontece, formato
2. **Planos com marcação de tempo** — `Shot 1, 0.0s to 2.5s: ...`
3. **Câmera dentro de cada plano** — em forma afirmativa: "static locked-off tripod framing", nunca "no camera shake"
4. **Áudio como bloco final** — diálogo, efeitos, música, e o que **não** deve ter ("No music, no speech" aqui é aceitável porque é instrução de mixagem, não de imagem)
5. **Continuidade explícita** — "lighting stays warm and continuous throughout" evita pulo de cor entre planos

Recursos extras que valem para um pipeline de estúdio:

- **Embeddings de estilo**: sintaxe padrão `embedding:nome` funciona nos prompts do H3. O repositório oficial hospeda 10 embeddings de estilo contribuídos pela comunidade (`minimaxh3_bullet_time`, `minimaxh3_truman_show`, `minimaxh3_spiral_ascent`, entre outros); o gatilho é o nome do arquivo sem extensão. Coloque em `models/embeddings/`.
- **`MiniMaxH3AddGuide`**: ancora um keyframe em **qualquer** frame, não só no primeiro e no último — inclusive com índice negativo contando do fim. Encadeie vários para controlar cenas multi-plano. Clipes ancorados são recortados para os comprimentos válidos (5, 22, 39... frames).
- **Máscaras de ruído**: o sampler aceita `denoise_mask` para vídeo e áudio, onde 0 preserva e 1 regenera. Serve para remoção de objeto, inpainting local ou estender um clipe mantendo o resto estável. Máscaras de vídeo encaixam na grade de patch 2×2, e as de áudio em frames latentes inteiros.
- **Referência**: para travar identidade de personagem entre clipes, o modo R2V usa pesos diferentes (`ref2va`, não `fl2va`) e aceita até 9 imagens, 3 vídeos e 3 áudios de referência. Referencie por tag (`<Picture 1>`) e **atribua uma função a cada referência** — dizer qual referência controla identidade, qual controla estilo e qual controla movimento funciona bem melhor que deixar implícito.

---

## 5. Robustez de orquestração

- **Nunca fixe seed em produção.** Sorteie, e grave a seed no registro do job. Sem isso não existe reprodução de aprovação de cliente.
- **Valide antes de enfileirar.** Faça `GET /object_info/{class_type}` na subida do serviço e confira que os nomes de input dos grafos batem com a build instalada. Atualização do ComfyUI renomeia inputs sem aviso, e é o modo de falha mais comum num pipeline automatizado.
- **Fixe a versão.** Anote o commit do ComfyUI que passou a validação. No Pinokio o botão de update é conveniente e quebra custom nodes.
- **Ordem da fila.** Não intercale jobs de Flux e H3. Cada troca descarrega e recarrega dezenas de GB. Agrupe por modelo.
- **Fallback de decode.** Se o decode de vídeo estourar VRAM, troque `VAEDecode` por `VAEDecodeTiled` com `tile_size: 256`, `overlap: 64`, `temporal_size: 32`, `temporal_overlap: 8`.
- **Licença.** Uso comercial de saídas geradas localmente com o H3 exige licença comercial da MiniMax, obtida através da Comfy, que é a revendedora oficial. Gerações na Comfy Cloud já incluem direitos comerciais. Flux.1-dev também é não-comercial; para trabalho pago o caminho é `flux1-schnell` (Apache 2.0) ou licença comercial da BFL.

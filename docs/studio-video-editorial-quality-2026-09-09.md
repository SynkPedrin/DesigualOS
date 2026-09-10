# Studio: referência editorial e produção por takes

## Referência observada

Vídeo fornecido por Pedro: `WhatsApp Video 2026-09-08 at 16.12.32.mp4`.
40,375 segundos, 576×1024, 24 fps, com faixa de áudio. Avaliação visual por quadros amostrados e extração de quadros específicos; não foi feita avaliação auditiva da trilha.

- Abertura em retratos, seguida por planos de ação e detalhes de raquete/bola.
- Luz dirigida, pele e tecido definidos, separação entre sujeito e fundo e contraste de materiais.
- Alternância entre estúdio escuro e cenas ambientais de quadra/clube.
- Trecho tipográfico: “Um outro ponto de vista”, “do esporte”, “da vida”.
- Assinatura gráfica: “top tennis club”. A assinatura dos testes foi recuperada do quadro final, não redesenhada pelo modelo. O arquivo de logo original em vetor/PNG continua preferível a essa extração de vídeo comprimido.

Esse material define a direção criativa, não uma garantia automática de equivalência. Não copiar personagens, locais ou a paleta azul como regra universal para outros clientes.

## Inspeção do código existente

Já existiam retomada de imagens por prompt_id, upload com novas tentativas e fonte real por contornos vetoriais. Essas alterações foram preservadas.

Gargalos encontrados: o storyboard de vídeo ficava fora da production_spec; o worker ignorava os prompts individuais dos slides e usava um único vídeo; qualquer referência podia virar o quadro inicial; faltavam retomada por take e montagem final. Não é possível atribuir cada alteração anterior a uma sessão do Claude apenas pelo worktree, que contém muitas mudanças não commitadas.

## Implementação desta rodada

- OTTO repassa os planos completos de vídeo e carrossel no metadata da fila.
- Planejamento com duração, prompt fotográfico, tipo de plano, continuidade e movimento por cena.
- Quadros-base FLUX.2 gerados em bloco antes dos takes H3, reduzindo trocas entre modelos.
- Quadros-base disponíveis como carrossel; takes separados e montagem MP4 final.
- Carrossel fotográfico usa prompts de cada slide, referência de continuidade e não sobrepõe títulos.
- H3 com canvas limitado à receita local 768×1344; takes curtos são cortados na montagem a partir de geração de pelo menos 5s, pois o nó instalado informa faixa treinada iniciando em 124 frames.
- Retomada de H3 por prompt_id, checkpoint de cada quadro/take e reutilização após falha de importação.
- FFmpeg local monta cortes secos, mantém áudio nativo dos takes, remove sobra de duração da grade H3 e exporta H.264/AAC com faststart.
- Texto real e logo de canvas compostos após a geração, evitando deformação temporal das letras. Isso NÃO garante marcas exatas integradas em roupas/objetos tridimensionais.
- Master exige `video_stage: master` e `draft_approved_for_master: true`; nenhuma aprovação visual é fabricada.

## Uso e limites

`metadata.video_plan` recebe o storyboard; `metadata.design: photographic` ou `takes` seleciona sequência fotográfica sem títulos. `metadata.video_text_overlays` recebe itens `{text,start_seconds,end_seconds}`; na ausência deles, os textos do video_plan são distribuídos pela duração. Logos com papel `logo` e posição `canvas_*` são compostos no vídeo.

Até 16 takes e 80s por sequência. Geração longa custa vários minutos por take; limitar resolução e evitar recargas não torna o motor instantâneo. Sem transições complexas, sincronização musical automática ou restauração garantida de faces/produtos. Carrosséis e vídeos continuam exigindo revisão visual; nitidez não prova fidelidade ao produto real.

O pacote `ffmpeg-static` é dependência do Studio; `STUDIO_FFMPEG_PATH` permite usar um binário administrado externamente. Os serviços precisam ser reiniciados com os builds atualizados para usar o novo fluxo. Nenhuma reinicialização de serviços de produção foi feita nesta rodada.

## Validação solicitada

Pedro solicitou quatro clipes: dois conceitos de tênis, duas variações cada, trocando rostos, cores e ambientes e preservando as escritas. Destino confirmado: cadastro “Clinica Teste Fase 7”.

Scripts locais de validação e importação estão em `nodes/studio-node/scripts/validate-tennis-video.ts` e `import-tennis-validation.ts`. Resultados, checkpoints e comprovante de importação ficam em `artifacts/tennis-video-validation-2026-09-09/`. O script de geração não cria clientes ou jobs fictícios no banco. A importação só aceita o cadastro exato conferido e todos os quatro MP4 concluídos.

## Referências técnicas

- [ComfyUI: MiniMax H3](https://docs.comfy.org/tutorials/video/minimax/minimax-h3): referências e controle por quadros, canvas e grade de resolução.
- [FFmpeg: filtros](https://ffmpeg.org/ffmpeg-filters.html): concatenação, trim e overlay na montagem.

Os parâmetros efetivos também foram conferidos no `object_info` do ComfyUI 0.33.4 instalado na RTX 4090. Resultados visuais e disponibilidade do ambiente são verificados separadamente dos testes de código.

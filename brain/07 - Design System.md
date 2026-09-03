---
tags: [design, frontend, desigual-os]
---

# Design System e Frontend

Fonte: prompt mestre, seção 11. Dark mode é a assinatura, não um tema alternativo.

## Assets recebidos (atualizado 2026-09-01)

- `assets/desigual-os.png`: logo 3D real da marca (substitui o wordmark fino antigo), "desigual" em branco/prata 3D, "OS" com o O em verde lima e o S em roxo, ambos com acabamento 3D brilhante. É a logo oficial, deve substituir qualquer "desigual OS" escrito como texto na UI.
- `assets/BENTO.png`, `assets/JARBAS.png`, `assets/SUSY.png`, `assets/STUDIO.png`: fotos/logo dos 4 agentes (300x300, já em uso no frontend como avatar).
- `assets/FUNDO.png`: textura de fundo oficial da marca. Fundo preto com fibras finas, formas 3D em curva na cor ametista/roxo (com o mesmo acabamento brilhante da logo) e traços diagonais em verde lima. **Resolve a pendência do hex do `--color-sinal`**: escaneei o arquivo pixel a pixel procurando o verde mais vibrante de verdade, achei `#E1F900` (225, 249, 0). É o valor real pra `--color-sinal`, substitui o `#C4F000` provisório na paleta abaixo.
- Pedido do usuário (2026-09-01): usar `FUNDO.png` como fundo nas telas de login/cadastro, e também em cards de conteúdo com texto por cima (referência visual: um hero banner estilo o mockup "ORVYN OS" que o usuário mandou de outro produto, mostrando um banner escuro com textura por trás e texto/botões por cima).

## Pendente

- Logo do Studio como agente: `STUDIO.png` já existe mas é um wordmark/logo, não uma foto de pessoa como os outros 3 (decisão do frontend: manter avatar de iniciais "St" pro Studio em vez de espremer o wordmark num círculo).
- Os dois mockups de dashboard citados no prompt mestre original (seção 11) nunca chegaram, mas `FUNDO.png` e `desigual-os.png` já dão material real suficiente pra fechar a identidade visual sem eles.

## Princípios

Roxo com peso e presença, nunca gradiente suave sobre branco. Assimetria intencional, hierarquia legível em 2 segundos, espaço negativo generoso. Motion guia, não decora (stagger reveal 80-120ms, hover scale 1.02-1.05, transições 200-300ms). Proibido: bounce, confetti, pulse infinito, spinners coloridos.

## Paleta (`--color-sinal` já é o valor real, extraído de `FUNDO.png`)

```css
:root {
  --color-ametista: #6B21A8;
  --color-roxo-eletrico: #9333EA;
  --color-carbono: #0F0F0F;
  --color-grafite: #1C1C1E;
  --color-nevoa: #A1A1AA;
  --color-violeta-sutil: #DDD6FE;
  --color-magenta-spark: #D946EF;
  --color-branco-cru: #FAFAF7;
  --color-sinal: #E1F900; /* real, extraído de assets/FUNDO.png em 2026-09-01 */
  --color-sucesso: #22C55E;
  --color-aviso: #F59E0B;
  --color-erro: #EF4444;
  --color-info: #8B5CF6;
  --radius-sm: 4px; --radius-md: 8px; --radius-lg: 12px;
  --shadow-card: 0 4px 24px rgba(107,33,168,0.15);
  --shadow-glow: 0 0 20px rgba(147,51,234,0.4);
}
```

## Tipografia (nunca Inter, Roboto, Arial, Helvetica, Poppins, Montserrat, Space Grotesk)

- Display / H1: BigShouldersDisplay, UPPERCASE, tracking negativo
- Heading: BricolageGrotesque
- Body / UI: WorkSans
- Dados / métricas / badges: JetBrainsMono
- Editorial / citação: InstrumentSerif

## Rotas do Desigual OS

Dashboard, Chat, Agents, Clients, Studio, Workflows, History, Knowledge, Analytics, Costs, Monitoramento, Admin.

## Checklist visual antes de entregar qualquer tela

Nenhuma fonte proibida, contraste WCAG AA, nenhum fundo branco puro, dark mode contemplado, sem layout SaaS genérico, sem stock photo, CSS variables para cor, nenhum travessão no texto.

Implementado na [[Fase 14 - Frontend]].

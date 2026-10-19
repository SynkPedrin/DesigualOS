# Mockup × tela real — o que falta, tela por tela

> **Estado em 09/10/2026, fim do dia.** A lista abaixo foi escrita ANTES da
> rodada de implementação e está mantida como registro do que faltava. O que
> foi entregue desde então está no quadro logo abaixo; o resto do documento
> continua valendo como lista do que não foi feito.
>
> | Tela | Estado | Commit |
> |---|---|---|
> | Hoje | entregue | `325a385` |
> | Tarefas | entregue | `a1bc03c` |
> | Visão geral | entregue | `847754a` |
> | Empresas | entregue | `700945f` |
> | Mídias | entregue | `bc4557a` |
> | Integrações | entregue | `1469757` |
> | Pipeline | entregue | `0c688c8` |
> | Automações | entregue | `1e82835`, `83d635f` |
> | Barra lateral | entregue | `8b9d650` |
>
> **O que continua valendo como decisão, não como pendência:** ROAS e CAC em
> Mídias, delta e mini-gráfico na maioria dos KPIs, e taxa de conversão no
> Pipeline. Os três exigem dado que o sistema não tem (receita, série
> histórica, e saber qual coluna significa ganho). Não entraram como zero nem
> como traço: não entraram.
>
> **Regra que passou a ser verificada sozinha:** nenhum cartão aparece cortado.
> O portão de captura mede isso nas 18 telas em três resoluções, e recusa a
> captura nomeando o bloco e o tamanho da sobra.

Comparação feita em 09/10/2026 entre `assets/TELASS - TUTORIAL/*.png` e capturas
do produto rodando com dado real, conta de QA, tema escuro, 1920×1080.

## Antes de ler: três limites desta comparação

Sem eles a lista abaixo engana.

**1. A conta de QA quase não tem dado.** Boa parte do que parece "falta tela" é
falta de conteúdo: a tela existe, está certa, e mostra o estado vazio porque não
há o que mostrar. Separei as duas coisas em cada seção — **estrutura** é o que
falta mesmo, **conteúdo** é o que a conta do Pedro provavelmente já preenche.

**2. Só o primeiro quadro foi fotografado.** O shell é `h-screen` com rolagem
interna, então `fullPage` devolve 1920×1080 e nada abaixo da dobra entrou em
nenhuma captura. O mesmo vale para os mockups, que também mostram um quadro —
para comparar serve; para dizer "a tela inteira está validada", não serve.

**3. Os mockups não são contrato em tudo.** Pelo menos um número deles não
fecha, e está anotado onde aparece.

---

## Integrações

Mockup: `tela-integrações.png` · Captura: `screenshots/integracoes-desktop.png`

### Estrutura que falta

| O que | No mockup | Hoje |
|---|---|---|
| Banner de topo | Título grande, subtítulo, arte à direita, botão "Ver documentação" | `h1` pequeno, sem banner |
| Abas por categoria | "Todas 12 · Inteligência 3 · Comunicação 3 · Gestão 4 · Mídia e Marketing 2" | ausentes |
| Ordenação | Seletor "Mais recentes" | ausente |
| Grade de cartões | 4 colunas, cartão compacto: ícone pequeno, badge de status, 3 linhas de detalhe, 2 botões | cartão alto com área de imagem grande, 1 por linha dentro da seção |
| Ícone do KPI | Círculo colorido por indicador | sem ícone |

### Onde eu não segui o mockup, de propósito

O mockup estampa **"Saúde das integrações: Excelente · 100% operacionais"** com
4 de 12 conectadas. Essa conta não fecha: 100% do quê? Se for das conectadas, é
tautologia — conectada está conectada.

A faixa entregue mede a fração das **conectáveis** que estão conectadas, e separa
o que falta configuração (depende de administrador) do que falta clicar. Neste
ambiente ela diz "Nada conectado · 0% das configuradas", que é a verdade.

Trocar isso pelo texto do mockup é decisão do Pedro, mas é escrever 100% onde não
é 100%, numa tela em que ninguém vai conferir. Commitado em `e41b33f` com o
raciocínio inteiro.

---

## Visão geral

Mockup: `tela-visão-geral.png` · Captura: `screenshots/visao-geral-desktop.png`

### Estrutura que falta

| O que | No mockup | Hoje |
|---|---|---|
| Cartão do Bento | "Bento analisou sua semana", com 2 linhas de leitura e seta | ausente |
| Delta nos KPIs | ↑+14%, +0%, ↑+32%, ↓−8% ao lado de cada número | ausente |
| Sparkline nos KPIs | Mini-gráfico dentro de cada cartão | ausente |
| Aviso de ClickUp | Ícone de alerta, botão "Corrigir agora", X para dispensar | só o texto e uma seta |
| Coluna direita | "Recomendações do Bento" (3 cartões + "Ver todas") | ausente |
| Números nas barras | "Quem a equipe aciona" mostra 1.842, 428, 312… | barras sem número |
| Saúde operacional | Delta e mini-gráfico por item | só o número |

**Nota sobre os deltas:** comparar com o período anterior exige série histórica.
Onde ela não existir, o lugar certo é não mostrar o delta — e não mostrar zero.

---

## Pipeline

Mockup: `tela-pipelines.png` · Captura: `screenshots/pipeline-desktop.png`

**É a tela mais próxima do mockup das sete.** Já tem banner com ações, faixa de
KPIs, seletor de quadro com escopo, busca, filtro por responsável, colunas com
barra colorida no topo, soma e contagem por coluna, e cartões com responsável,
valor, nota e tempo.

### Estrutura que falta

| O que | No mockup | Hoje |
|---|---|---|
| Quinto KPI | 5 cartões, com ícone, delta e barra de progresso | 4 cartões, sem ícone nem delta |
| Alternador de visão | Kanban / Lista / Tabela | só Kanban |
| Filtros | "Todos os status", "Mais filtros", "Mais recentes" | só "Todos os responsáveis" |
| Badges no cartão | Prioridade (Alta/Média/Baixa) e categoria (Website, Tráfego, Design) | ausentes |
| Coluna direita | "Insights do pipeline" + "Bento pode te ajudar" | ausente |
| Ação na coluna | "+ Adicionar cartão" no rodapé de cada coluna | só "Novo cartão" no topo |

---

## Atividade

Mockup: `tela-atividade.png` · Captura: `screenshots/atividade-desktop.png`

### Estrutura que falta

| O que | No mockup | Hoje |
|---|---|---|
| Faixa de KPIs | 5 cartões (Total 456 +12%, ClickUp, Bento, Claude, Outros), cada um com ícone e mini-gráfico de barras | 3 cartões com barra de proporção, sem ícone nem gráfico |
| Total | Cartão "Total de atividades" com delta vs. semana anterior | ausente |
| Busca e filtros | Campo de busca + 4 seletores (período, fonte, cliente, tipo) | só chips de fonte |
| Linha do tempo | Fio vertical com marcadores coloridos, ícone por tipo, badges de cliente e de tipo, "por X", menu ⋮ | hora + fonte + texto, sem ícone, badge ou menu |
| Contagem por dia | "Hoje 6 atividades" / "Ontem 12 atividades" | "Ontem" sem contagem |
| Coluna direita | Rosca "Visão geral do período" + "Principais clientes" com % + "Insights da operação" | "Clientes mais ativos" em barras, na coluna principal |
| Data e hora | No canto do banner | ausente |

---

## Hoje

Mockup: `tela-hoje.png` · Captura: `screenshots/hoje-desktop.png`

Esta é a tela que o Pedro apontou como "continua a mesma coisa", e vale separar
com cuidado o que é falta de dado do que é diferença de layout — porque **tem
diferença de layout real, independente de dado**.

### Estrutura que falta, e não depende de ter dado

| O que | No mockup | Hoje |
|---|---|---|
| Faixa da saudação | Ocupa a largura toda, com saudação à esquerda e cartão do Bento à direita | banner estreito, ~1/5 da largura, encostado à esquerda |
| Data | Logo abaixo da saudação, dentro da faixa | solta no canto direito, desligada de tudo |
| Briefing do Bento | Cartão "Bento AI · Seu briefing do dia" com 4 leituras e "Ver detalhes" | ausente |
| Ordem no KPI | Rótulo em cima, número embaixo, com sub-linha ("18 no prazo · 9 atrasadas") | número em cima, rótulo em versalete embaixo |
| Badge no KPI | "9 atrasadas" destacado dentro do cartão | ausente |
| Filtros das prioridades | Minhas / Hoje / Atrasadas / Bloqueadas / Equipe, com contador | ausentes |
| Tabela de prioridades | Checkbox, marcador de prioridade, tarefa, cliente, status, prazo, menu ⋮ | ausente |
| Tira da semana | SEX 9 · SÁB 10 · DOM 11… com navegação | ausente |
| Reunião no "Seu dia" | Horário, título, participantes e badge do canal (Online / Google Meet) | ausente |
| "+ Nova reunião" | Botão no rodapé do cartão | ausente |
| Saúde operacional | Painel com abas (Clientes em risco / Maior volume / Com tarefas atrasadas) e barras por cliente | ausente |
| Badges na navegação | Inbox 3, Chat 12 | ausentes |

### O que é só falta de dado

"Prioridades de hoje", "Conversas recentes", "Tarefas do dia" e "Aprovações
pendentes" aparecem vazios porque a conta de QA não tem nada. Os estados vazios
estão escritos e corretos. Na conta do Pedro esses quatro devem encher sozinhos.

---

## O que vale decidir antes de executar

**1. A coluna de insights do Bento aparece em quatro mockups** (visão geral,
pipeline, atividade, hoje) e não existe em nenhuma tela. É o item que mais pesa
na sensação de "a tela continua a mesma", e é o mais caro: precisa de alguém que
produza a leitura, não só de layout.

**2. Delta e mini-gráfico aparecem em quase todo KPI dos mockups.** Os dois
exigem série histórica. Onde ela não existir, o certo é omitir o delta, não
exibir 0%.

**3. Badges de prioridade e categoria nos cartões** (pipeline, atividade,
tarefas) dependem de os campos existirem no dado. Onde o ClickUp não traz
prioridade, o cartão não pode inventar "Média".

---

## Como refazer esta comparação

```bash
cd apps/web && pnpm exec playwright test --project=visual
```

As capturas vão para `docs/frontend-premium/screenshots/`. O portão recusa
imagem com overlay, com esqueleto de carregamento, com estouro horizontal ou com
conteúdo faltando — e, desde 09/10, falha apontando o AMBIENTE quando a API
devolve 429, em vez de culpar a tela.

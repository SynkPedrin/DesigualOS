# Dossiê Desigual OS — contexto para criação de landing page

> Documento de apoio criativo, compilado a partir do código-fonte e da documentação viva do projeto (`README.md`, `brain/`). Uso: dar contexto completo (produto, arquitetura, marca, tom) para quem for escrever copy e desenhar a LP.

---

## 1. O que é, em uma frase

**Desigual OS é o sistema operacional de IA da Agência Desigual** — não um chatbot, não uma ferramenta a mais: uma camada de orquestração que coordena um time de agentes de IA especializados, cada um rodando em hardware próprio, para executar o trabalho real de uma agência de marketing (estratégia, tráfego pago, social selling e criação de conteúdo).

O gancho central pra copy: **uma agência de marketing construiu a própria IA operacional, para si mesma, e agora ela roda a operação de verdade.** Não é uma ferramenta genérica adaptada pra marketing — nasceu de dentro de uma agência, pros problemas reais de uma agência.

---

## 2. O problema que resolve

Agências de marketing hoje vivem cercadas de ferramentas soltas: uma IA genérica pra copy, uma pra imagem, planilhas pra métrica, ClickUp pra projeto, WhatsApp pra cliente — nada conversa entre si, e cada ferramenta exige que um humano seja a cola. O resultado é retrabalho, contexto perdido entre etapas, e uma IA que "sabe de tudo em geral" mas não conhece o cliente, o histórico, o brand kit, a régua de aprovação.

Desigual OS resolve isso colocando **um Orchestrator central que entende o pedido, decide qual especialista deve tratar (ou uma sequência deles), e cada especialista já chega sabendo o contexto do cliente** — sem o usuário precisar montar prompt, trocar de ferramenta ou explicar tudo de novo a cada etapa.

---

## 3. Como funciona (em linguagem de LP, não de engenharia)

- **Orchestrator + Router com IA**: cada pedido do usuário é lido e roteado automaticamente para o agente certo (ou para uma sequência de agentes, quando a tarefa exige mais de um). O usuário não escolhe manualmente — pode digitar em "modo AUTO" e o sistema decide.
- **Agentes especializados, não um assistente genérico**: cada um tem papel, conhecimento e ferramentas próprias (ver seção 4).
- **Hardware dedicado por agente**: os agentes não são só "prompts diferentes" — cada um roda numa máquina física própria, com seu próprio conhecimento local (nunca centralizado, nunca vazado entre agentes). É infraestrutura real, não simulação.
- **Aprovação humana onde importa**: ações sensíveis (alterar orçamento de anúncio, publicar no Instagram) exigem confirmação explícita antes de executar — a IA propõe, o humano decide.
- **Rastreabilidade total**: toda execução relevante gera um registro auditável (`execution_id`, `audit_logs`) — nada acontece "no escuro".

---

## 4. O time de agentes (o coração da história)

Esse é provavelmente o melhor material pra LP: em vez de "recursos", o produto tem **personagens** — cada um com nome, especialidade e até personalidade de resposta.

### Bento — Institucional
> *"A inteligência institucional da agência: processos, clientes, SOPs, estratégias, histórico, conhecimento interno."*
Quem conhece a casa. Normalmente abre um projeto (briefing, persona, posicionamento, oferta) e fecha com revisão. É a memória viva da agência.

### Jarbas — Tráfego e Performance
> *"Meta Ads, Google Ads, Analytics, CPL, CPA, CTR, ROAS, criativos, relatórios."*
Cuida do dinheiro investido em mídia. Tem um traço deliberado de responsabilidade: **nunca mexe em orçamento sem aprovação humana antes.**

### Suzy — Social Selling
> *"Instagram, WhatsApp, leads, qualificação, follow-up, agendamento."*
A mais rápida do time — fila de resposta em tempo real, porque social selling não espera. Cuida da conversa que vira venda.

### Studio — Criação Multimídia
> *"Imagens, carrosséis, vídeos, reels, upscale."*
O único agente com GPU dedicada (RTX 5090) rodando local. Gera conteúdo visual de verdade — e não é só "desenhar uma imagem": junta copy de marketing (usando frameworks reais de posicionamento, funil e GTM) com geração visual, produzindo peças prontas pra postar, com legenda e texto sobreposto de qualidade profissional.

**Gancho de copy**: "4 especialistas, uma equipe, zero trocas de contexto."

---

## 5. Funcionalidades / telas principais

- **Dashboard** — visão executiva: execuções, tokens consumidos, custo real de IA em USD, agentes conectados, uso por agente, custo por usuário. Transparência total de custo — a IA não é uma caixa preta que gasta sem prestar contas.
- **Chat** — conversa direta com qualquer agente, ou modo AUTO deixando o roteador decidir.
- **Mensagens** — central de conversas.
- **Agentes** — painel de saúde do time: status online/offline, performance, tempo médio de resposta por agente.
- **Clientes** — todos os clientes sincronizados do ClickUp, com ficha completa por conta.
- **Studio** — geração de conteúdo (imagem, carrossel, vídeo, reels, upscale) com copy de marketing embutida.
- **Workflows** — automações multi-agente encadeadas.
- **Histórico** — trilha de tudo que já foi executado.
- **Conhecimento** — base de conhecimento por agente.
- **Analytics / Tokens & Custos** — métricas de uso e gasto real com IA.
- **Monitoramento** — saúde da infraestrutura (as máquinas físicas por trás dos agentes).
- **Admin** — controle de acesso, permissões, integrações.

---

## 6. Diferenciais (o que dá pra vender)

1. **Não é um wrapper de IA genérica** — é uma operação de agência real, automatizada. Nasceu de dentro, resolvendo dor real, não um produto pensado de fora pra dentro.
2. **Especialização de verdade, não personas de prompt** — cada agente roda em máquina própria, com conhecimento e permissões próprias. Isso é arquitetura, não teatro.
3. **Custo de IA visível e auditável** — dashboard financeiro nativo (USD real por execução, por agente, por cliente). Ninguém fica no escuro sobre quanto a IA está custando.
4. **Humano no controle das decisões que importam** — aprovação obrigatória antes de gastar em mídia paga ou publicar publicamente.
5. **Criação com noção de marketing de verdade** — o Studio não gera imagem bonita solta; gera peça com copy fundamentada em frameworks de posicionamento, funil de demanda e GTM.
6. **Modular por design** — o sistema foi desenhado desde o início pra crescer (adicionar um 5º agente é registrar node + capabilities, não reconstruir nada).

---

## 7. Identidade visual (referência pra quem for desenhar a LP)

**Princípio central**: dark mode é a assinatura da marca, não um tema alternativo. "Roxo com peso e presença, nunca gradiente suave sobre branco." Assimetria intencional, hierarquia legível em 2 segundos, espaço negativo generoso.

**Motion**: guia, nunca decora — stagger reveal de 80–120ms, hover scale 1.02–1.05, transições de 200–300ms. Proibido: bounce, confetti, pulse infinito, spinners coloridos.

### Paleta

```css
--color-ametista: #6B21A8;
--color-roxo-eletrico: #9333EA;
--color-carbono: #0F0F0F;      /* fundo base */
--color-grafite: #1C1C1E;      /* superfícies */
--color-nevoa: #A1A1AA;        /* texto secundário */
--color-violeta-sutil: #DDD6FE;
--color-magenta-spark: #D946EF;
--color-branco-cru: #FAFAF7;   /* texto principal */
--color-sinal: #E1F900;        /* verde-lima, cor de destaque/sinalização — extraída pixel a pixel do asset oficial FUNDO.png */
--color-sucesso: #22C55E;
--color-aviso: #F59E0B;
--color-erro: #EF4444;
```

### Tipografia

Nunca usar Inter, Roboto, Arial, Helvetica, Poppins, Montserrat ou Space Grotesk — é deliberadamente fora do padrão "SaaS genérico".

- **Display / H1**: Big Shoulders Display, sempre UPPERCASE, tracking negativo
- **Heading**: Bricolage Grotesque
- **Corpo / UI**: Work Sans
- **Dados / métricas / badges**: JetBrains Mono
- **Editorial / citação**: Instrument Serif

### Logo e assets de marca

- Logo oficial: **"desigualOS"** — "desigual" em branco/prata com acabamento 3D, "OS" com o **O em verde-lima** e o **S em roxo**, ambos com brilho 3D. Nunca escrever "desigual OS" como texto puro na UI — sempre a logo.
- Existe uma versão isolada só do símbolo "OS" (mark quadrado, fundo preto, acabamento neon 3D verde/roxo) usável como ícone/favicon/selo.
- Textura de marca oficial: fundo preto com fibras finas + formas curvas 3D em ametista/roxo + traços diagonais em verde-lima — usada como wallpaper em telas de login e em cards/banners de destaque (hero com textura atrás, conteúdo por cima).

---

## 8. Prova técnica (pra quem quiser uma seção "tecnologia por trás")

- Orchestrator: Node.js + TypeScript, Fastify, WebSocket, BullMQ + Redis, Postgres (Supabase) via Drizzle ORM.
- Frontend: Next.js + React + TypeScript, Tailwind.
- Infraestrutura física real: 3 Mac Minis dedicados (um por agente conversacional) + 1 PC com RTX 5090 dedicado à geração de mídia — comunicação só por rede privada (Tailscale), nenhuma máquina exposta publicamente.
- Cada execução é auditada; toda chave de API vive só no servidor, nunca no frontend.

Gancho de copy possível: **"Não é IA na nuvem genérica — é infraestrutura dedicada, rodando hardware real, para um time de verdade."**

---

## 9. Estado atual do projeto

Sistema em construção ativa, por fases numeradas (17 fases no plano mestre, cobrindo desde o core/banco de dados até produção). Já funcionando: geração real de imagem e carrossel (com copy de marketing e texto sobreposto), dashboard de custos, chat com roteamento automático, gestão de clientes. Em desenvolvimento: geração real de vídeo/reels (a infraestrutura e a interface já existem; falta conectar o modelo de vídeo).

Se a LP for para captação/apresentação institucional, o enquadramento honesto é **"em evolução ativa, já em uso real na operação"**, não "produto pronto e fechado" — isso inclusive reforça a autenticidade da história (é uma ferramenta viva, construída junto com o uso real).

---

## 10. Público-alvo

- Primário: a própria Agência Desigual e o time interno (uso operacional).
- Secundário (se a LP for pensada como vitrine/prova de capacidade): outras agências de marketing, ou clientes/prospects avaliando a maturidade tecnológica da Desigual como agência — "essa agência constrói a própria infraestrutura de IA" é, em si, um argumento de venda para quem contrata a agência.

---

## 11. Tom de voz sugerido

Direto, técnico sem ser hermético, seguro de si sem exagero — o mesmo tom dos textos internos do produto ("Regras de ouro invioláveis", "nunca... sem aprovação", "não é teatro, é arquitetura"). Evitar clichê de "IA revolucionária mágica"; preferir concretude ("cada agente roda em máquina própria", "todo gasto é auditado em USD real") — a credibilidade vem do detalhe técnico real, não da promessa vaga.

---

## 12. Possíveis ganchos de headline

- "A agência que automatizou a si mesma."
- "Quatro especialistas. Uma operação. Zero retrabalho."
- "IA que conhece o cliente — porque nunca esquece o contexto."
- "Cada agente, sua própria máquina. Cada ação, sua própria trilha."
- "Marketing rodado por um sistema operacional, não por um monte de abas abertas."

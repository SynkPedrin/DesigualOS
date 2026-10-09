# Transformação premium do frontend — inventário e acompanhamento

Arquivo de continuidade: se o contexto da sessão for compactado, retome por aqui.
Sessão responsável: desigualos-f9. Iniciado em 09/10/2026.

## O que a descoberta mudou na premissa

**O design system já existe e já é o dos mockups.** `apps/web/src/styles/tokens.css`
tem carbono `#0f0f0f`, grafite, roxo elétrico `#9333ea`, sinal `#e1f900`, sombras com
glow roxo, escala de raio, tokens de motion (120/180ms) e ainda uma camada de marca
para white-label. Não há sistema a construir — há sistema a APLICAR.

Isso reduz a missão de "criar uma plataforma premium" para "elevar telas específicas
ao nível que o sistema já permite", que é um trabalho diferente e muito mais seguro.

## Mockups encontrados

`assets/TELASS - TUTORIAL/` — 8 arquivos:
atividade · automação · criar/editar automação · hoje · integrações · pipelines ·
tarefas · visão-geral

Citados pelo Pedro mas AUSENTES da pasta: Empresas, Equipe, Conhecimento.

**Nem todo mockup é alvo.** Dois tipos foram encontrados:

- `tela-visão-geral.png` mostra os números REAIS de produção (58 clientes ativos,
  saúde 20%, agentes 1/5, "3 pessoas sem vínculo com o ClickUp"). É captura do app
  atual, não design a perseguir. A tela já está nesse nível.
- `tela-pipelines.png` usa clientes FICTÍCIOS (NeoClinica, Vila Real Imóveis, Studio
  Bella, Tropical Foods, Clínica Saúde+, Barros Store, Agência Lumina, Fino
  Construction, Rede FarmaVida, Mercado Urbano, EcoBrás, Solar Tech). É alvo de
  design, e a distância até o que existe é grande.

Antes de tratar um mockup como meta, conferir de qual tipo ele é. Perseguir uma
captura do próprio app é trabalho que não entrega nada.

## Dependência que restringe o redesenho

Existe um **tutorial de primeiro acesso em produção** (commit 594bd74, sessão 7f) que
ensina as telas usando ESTES mockups como verdade — vídeo Remotion, abre uma vez por
conta, volta pelo botão Tutorial.

Consequência: aproximar uma tela do mockup mantém o tutorial correto e o melhora.
DIVERGIR do mockup faz o tutorial ensinar uma tela que não existe mais, que é pior que
não ter tutorial. Toda mudança de tela precisa de ajuste na cena correspondente de
`apps/web/src/components/tutorial/roteiro.ts`.

## Assets

- `assets/logos clientes/` — 22 arquivos
- `apps/web/public/logos/clientes/` — 21 arquivos
- **Falta 1, e é deliberado:** `logo-clinica-sao-jose.png` não corresponde a cliente
  nenhum do cadastro (existe "Clínica Santa Maria", não "São José"). A sessão 50 deixou
  de fora pra não associar logo por semelhança de nome — que é a regra certa. Só entra
  se alguém disser qual cliente é.

## Território entre sessões (09/10, três sessões ativas)

| Dono | Arquivos |
|---|---|
| **f9 (esta)** | `(shell)/pipeline`, `(shell)/integrations`, `(shell)/automations`, `(shell)/activity`, `(shell)/analytics` |
| **7f** (driver de deploy) | `entity-avatar.tsx`, `lib/client-logos.ts`, `(shell)/clients`, `Dockerfile.prod`, `docker-compose.prod.yml`, `tool-gateway/google-ads-*` |
| **50** | `PageHeader`, `(shell)/calendar`, `(shell)/today`, `(shell)/people` |

Deploy é da 7f. Nenhuma sessão sobe nada por conta própria.

## Estado por tela

| Tela | Mockup | Tipo | Status |
|---|---|---|---|
| Pipeline | sim | alvo | EM ANDAMENTO |
| Integrações | sim | **NÃO é espelho** | o mockup mostra Claude/OpenAI/Gemini/MCP; a tela real tem ClickUp, Notion, WhatsApp, Meta, Google Ads, Microsoft. Não perseguir. |
| Automações | sim | a conferir | pendente |
| Atividade | sim | a conferir | pendente — cabeçalho já migrado pela 50 (aecfd64) |
| Visão geral | sim | espelho do app | provável PASS sem obra (confirmado pela 7f) |

## Avatares e logos — não duplicar

A cadeia é da sessão 7f (`entity-avatar.tsx`, `lib/client-logos.ts`). Eu CONSUMO.
Já está no ar: logo de cliente sem moldura nem fundo branco (a moldura anulava a
marca), iniciais com cor determinística pelo nome, lista ordenando com-logo primeiro,
e o mapa casando por nome normalizado — "Colpar" e "Colpar Brasil" precisam de
entradas separadas, e a logo da John Deere aponta para "D. Carvalho" porque a
concessionária é o cliente.

## Achados que não são de design

- `/memory` renderiza 312 mil caracteres e 1724 elementos, 5,3s até aparecer. A API
  limita em 300 registros e existem 456; a tela despeja o conteúdo inteiro de cada um.
  É a tela mais pesada do sistema por uma ordem de grandeza. Precisa de recorte com
  prévia, não de mais estilo.

## Instável conhecido, não corrigido de propósito

`packages/otto-motion/src/pipeline.versioning.test.ts` falha de vez em quando com
`RENDER_FAILED` quando roda junto com a suíte inteira. Não é timeout — os tetos já são
de 5 minutos. É o Chrome headless do Remotion falhando sob disputa de CPU, fazendo
webpack, render e encode de verdade, duas vezes.

Não pus retry: retry aqui esconderia falha real de render, que é justamente o que este
teste existe pra pegar. Isolado passa em 10s; na segunda rodada da suíte completa deu
20/20. Se virar incômodo, o caminho é baixar a concorrência do render no teste, não
repetir até passar.

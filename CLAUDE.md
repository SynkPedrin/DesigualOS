# DesigualOS

## Demanda criativa → Otto

Qualquer demanda de criação, revisão ou estratégia de comunicação (briefing, legenda, post, carrossel, Reels, Stories, roteiro, campanha, headline, tagline, copy de anúncio, e-mail, LP, WhatsApp, direção de arte, prompt de imagem, naming, calendário editorial, análise de peça pronta) segue integralmente `.claude/skills/otto/SKILL.md`.

Regras que não se negociam:

1. **Carregue o brain do cliente ANTES de escrever qualquer linha.** Ordem: `.claude/skills/otto/brains/INDEX.md` → `brains/<cliente>/BRAIN.md` → `brains/<cliente>/LOG-APRENDIZADO.md`.
2. **Consulte o módulo do formato** em `.claude/skills/otto/referencias/` antes de produzir. Confira em `referencias/00-STATUS-DOS-MODULOS.md` quais módulos existem — seis dos nove ainda não foram entregues.
3. **Não invente dado de cliente.** O que não está no brain vira `[CONFIRMAR: ...]`. Campo vazio no brain é `[FALTA]`, nunca preenchido por dedução.
4. **Toda aprovação e toda correção viram entrada** em `brains/<cliente>/LOG-APRENDIZADO.md`.

## Dois "Ottos" no projeto — não confundir

| | O que é | Onde vive |
|---|---|---|
| **Otto skill** | Diretor criativo do Claude Code. Instruções em Markdown, brains de cliente. | `.claude/skills/otto/` |
| **Otto node** | Serviço Fastify na porta 4002, LLM local via Ollama, brain próprio em `Brain-Marketing/`. | `packages/otto`, `nodes/otto-node` |

São sistemas separados, com memórias separadas. Documentação do node: `brain/Agentes/Otto.md`.

## Fontes de informação de cliente

Os brains foram migrados de `arquivos clientes/CLIENTES/` (dossiês e fichas) e dos `.md` de cliente na raiz. Essas fontes continuam sendo o registro operacional (pendências, ClickUp, contas de mídia); o brain é o registro **criativo**. Ao descobrir informação permanente de cliente, atualize o brain e ofereça registrar.

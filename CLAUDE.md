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

### Como os dois registros chegam aos agentes

O Otto node e o Bento não leem o repositório: leem a tabela `memories`, kind
`client.profile`. Cada cliente tem até dois registros, que **não se substituem**:

| Registro | Fonte | Subject | Importador |
|---|---|---|---|
| Criativo | `.claude/skills/otto/brains/<cliente>/BRAIN.md` | `cliente:<id>:brain` | `scripts/sync-brains.mts` |
| Operacional | vault `brain-desigual/02-clientes/` | `cliente:<id>:dossie` | `scripts/sync-dossies.mts` |
| Aprendido | o que a equipe ensina no chat | `cliente:<id>:aprendizado:<aspecto>` | automático, a cada turno |

```bash
pnpm --filter @desigual-os/worker exec tsx scripts/sync-brains.mts --aplicar
pnpm --filter @desigual-os/worker exec tsx scripts/sync-dossies.mts --raiz <vault> --aplicar
```

Os importadores são idempotentes: reimportar **atualiza** o registro, não
empilha. Sem `--aplicar` é simulação. Editou um BRAIN.md ou um dossiê? Rode o
importador, ou o agente continua com a versão velha.

### Ensinar o agente durante o trabalho

As duas primeiras fontes congelam entre importações, e toda ficha tem lacuna
declarada. A terceira fonte fecha esse ciclo: o que for dito **com verbo de
registro** vira conhecimento permanente na hora.

> Anota que o decisor da Colormaq é a Marina.
> Corrige que a praça da Elite agora é Birigui e Penápolis.

Vale "anota", "registra", "corrige", "guarda", "atualiza", "lembra", "para
constar". Sem um desses, nada é gravado — contar de passagem não é pedir para
gravar, e dossiê errado é pior que dossiê vazio. Pergunta não conta: *"anota
quem é o decisor?"* está pedindo o dado, não entregando.

Regras que valem a pena conhecer:

- **O nome citado manda.** "anota no brain da Colormaq" grava na Colormaq mesmo
  com outro cliente selecionado no chat. Nome que não existe na carteira faz o
  fato ser descartado, nunca gravado por aproximação.
- **Corrigir substitui.** Fatos do mesmo aspecto (decisor, praça, público,
  restrição...) se aposentam; o último vale. Fato solto, sem aspecto conhecido,
  acumula em vez de apagar o anterior.
- **A procedência fica visível.** O que foi ensinado no chat chega ao turno
  rotulado como REGISTRO APRENDIDO, separado das fichas curadas, e por vir por
  último corrige o que elas disserem.

**O vault de dossiês não mora no repositório.** Ele tem ID de conta de mídia, ID
de membro do ClickUp e dado comercial, e este repositório é público. Vale a mesma
regra que o `.gitignore` já aplica a `arquivos clientes/` e `brain/`. Por isso o
`--raiz` é obrigatório em vez de um caminho fixo.

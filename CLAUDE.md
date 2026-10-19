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

### E um terceiro: o Otto Motion Engine

`packages/otto-motion` é uma feature ISOLADA do chat do Otto: pedido de motion
vira projeto Remotion escrito pelo Claude Opus 5.5, renderizado, revisado quadro
a quadro e devolvido como MP4 no chat. Atrás de `OTTO_MOTION_ENABLED` (default
`false`, e desligado o Otto se comporta exatamente como antes).

Não confunda com o Otto skill (que escreve copy) nem com o Otto node (Ollama
local). O Motion Engine não escreve legenda e não fala com o otto-node.

- Manual: `packages/otto-motion/README.md`
- Decisões e o que foi medido: `docs/architecture/otto-motion-engine.md`
- Regra que não se negocia: o motion é gerado por `claude-opus-5-5` e **não
  existe fallback**. Sem ele, o Otto avisa em vez de entregar peça pior.

## Fontes de informação de cliente

Os brains foram migrados de `arquivos clientes/CLIENTES/` (dossiês e fichas) e dos `.md` de cliente na raiz. Essas fontes continuam sendo o registro operacional (pendências, ClickUp, contas de mídia); o brain é o registro **criativo**. Ao descobrir informação permanente de cliente, atualize o brain e ofereça registrar.

### Como os registros chegam aos agentes

O Otto node e o Bento não leem o repositório: leem a tabela `memories`, kind
`client.profile`. Cada cliente tem até quatro registros, que **não se substituem**:

| Registro | Fonte | Subject | Importador |
|---|---|---|---|
| Criativo | `.claude/skills/otto/brains/<cliente>/BRAIN.md` | `cliente:<id>:brain` | `scripts/sync-brains.mts` |
| Operacional | vault `brain-desigual/02-clientes/` | `cliente:<id>:dossie` | `scripts/sync-dossies.mts` |
| Vault (nota solta) | o resto do vault Obsidian, fora de `02-clientes/` | `cliente:<id>:vault:<arquivo>` | `scripts/sync-obsidian-vault.mts` |
| Aprendido | o que a equipe ensina no chat | `cliente:<id>:aprendizado:<aspecto>` | automático, a cada turno |

```bash
pnpm --filter @desigual-os/worker exec tsx scripts/sync-brains.mts --aplicar
pnpm --filter @desigual-os/worker exec tsx scripts/sync-dossies.mts --raiz <vault> --aplicar
pnpm --filter @desigual-os/worker exec tsx scripts/sync-obsidian-vault.mts --raiz <vault> --aplicar
```

O registro "Vault" é deliberadamente separado do Operacional: cobre nota
solta, ata de reunião, briefing avulso — qualquer `.md` do mesmo vault que
não seja um dossiê de `02-clientes/` (esse já tem dono, o importador acima).
Casa arquivo com cliente pela mesma regra do dossiê — sem casar, o arquivo
fica de fora, nunca entra no cliente errado. Isto substitui, com casamento
explícito, a busca de texto livre que `nodes/desigual-node` fazia ao vivo no
vault por `context_refs` (sem saber qual arquivo é de qual cliente — já
causou alucinação documentada). Essa busca ao vivo continua existindo por uma
regra de ouro própria (nunca sincronizar o vault pro servidor central); este
importador é a via *explícita e consentida* pra o que vale a pena virar
memória permanente.

Os importadores são idempotentes: reimportar **atualiza** o registro, não
empilha. Sem `--aplicar` é simulação. Editou um BRAIN.md, um dossiê ou uma
nota do vault? Rode o importador correspondente, ou o agente continua com a
versão velha.

Para não depender de lembrar: `scripts/sincronizar-fichas.sh` roda os três,
e `infra/launchd/com.desigualos.fichas.plist` o agenda todo dia às 06:30 na
máquina onde o vault mora (instruções no próprio plist). O Bento vê a data de
cada ficha no cabeçalho do registro e é avisado quando ela passa de 90 dias.

### Ensinar o agente durante o trabalho

As fontes importadas (brain, dossiê, vault) congelam entre importações, e toda
ficha tem lacuna declarada. O que a equipe ensina no chat fecha esse ciclo: o
que for dito **com verbo de registro** vira conhecimento permanente na hora.

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

**O vault (dossiês ou notas soltas) não mora no repositório.** Ele tem ID de
conta de mídia, ID de membro do ClickUp e dado comercial, e este repositório é
público. Vale a mesma regra que o `.gitignore` já aplica a `arquivos
clientes/` e `brain/`. Por isso o `--raiz` é obrigatório nos dois
importadores (`sync-dossies.mts`, `sync-obsidian-vault.mts`) em vez de um
caminho fixo.
